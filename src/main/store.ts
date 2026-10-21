import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import Store from 'electron-store'
import { z } from 'zod'
import {
  bankSchema, emptyState, mixDraftSchema, sampleMix, selectedAnswer, settingsSchema, shuffled, startSchema, stateSchema, summarize,
  type AppSettings, type AppState, type MixDraft, type Question, type QuestionBank, type QuestionOrigin, type QuizSession, type StartConfig
} from '../shared/model'

export class StateStore {
  private state: AppState = emptyState()
  private tail: Promise<void> = Promise.resolve()
  private storage!: Store<AppState>
  private backupStorage!: Store<AppState>
  notice: string | null = null
  readonly primary: string
  readonly backup: string

  constructor(readonly directory: string, private readonly now = Date.now) {
    this.primary = join(directory, 'state.json')
    this.backup = join(directory, 'state.backup.json')
  }

  async initialize(): Promise<void> {
    this.storage = await this.openStore('state')
    this.backupStorage = await this.openStore('state.backup')
    const primary = this.storage.store
    const backup = this.backupStorage.store
    const hasPrimary = Object.keys(primary).length > 0
    const hasBackup = Object.keys(backup).length > 0
    if (hasPrimary) {
      this.state = stateSchema.parse(primary)
    } else if (hasBackup) {
      this.state = stateSchema.parse(backup)
      this.notice = 'Your saved data was recovered from a backup. The damaged file, if any, has been kept in the application data folder.'
    } else if (this.notice) {
      this.notice = 'Your saved data could not be read. Damaged files have been preserved in the application data folder. A fresh library is ready to use.'
    }
    if (!hasPrimary) this.storage.store = this.state
    if (!hasBackup) this.backupStorage.store = this.state
  }

  private async openStore(name: string): Promise<Store<AppState>> {
    const open = () => new Store<AppState>({
      cwd: this.directory,
      name,
      accessPropertiesByDotNotation: false,
      clearInvalidConfig: false,
      serialize: (value) => JSON.stringify(value),
      deserialize: (raw) => stateSchema.parse(JSON.parse(raw))
    })
    try { return open() } catch (error) {
      // Preserve damaged files before opening a fresh store. Disk/permission
      // errors must propagate rather than being treated as corrupt data.
      if (!(error instanceof SyntaxError || error instanceof z.ZodError)) throw error
      const path = join(this.directory, `${name}.json`)
      await fs.rename(path, `${path}.corrupt-${this.now()}-${randomUUID().slice(0, 6)}`)
      this.notice = 'A damaged saved data file was preserved. Your available library and progress were kept.'
      return open()
    }
  }

  private persist(state: AppState): void {
    // Each assignment is one atomic electron-store write, retaining the same
    // filenames and root shape used by earlier versions of MCQ Studio.
    this.backupStorage.store = this.state
    this.storage.store = state
  }

  snapshot(): AppState { return structuredClone(this.state) }
  get activeDeadline(): number | null { return this.state.activeSession?.deadline ?? null }
  flush(): Promise<void> { return this.tail }
  private transaction(change: (draft: AppState) => boolean | void): Promise<AppState> {
    const operation = this.tail.then(async () => {
      const draft = this.snapshot()
      const changed = change(draft)
      if (changed !== false) {
        stateSchema.parse(draft)
        this.persist(draft)
        this.state = draft
      }
      return this.snapshot()
    })
    this.tail = operation.then(() => undefined, () => undefined)
    return operation
  }

  saveBank(input: QuestionBank, replace: boolean): Promise<AppState> {
    const bank = bankSchema.parse(input)
    return this.transaction((draft) => {
      const index = draft.banks.findIndex((entry) => entry.bank.id === bank.id)
      if (index >= 0 && !replace) throw new Error('A bank with this ID already exists. Choose Replace to update it.')
      const entry = { bank, importedAt: this.now() }
      if (index >= 0) draft.banks[index] = entry
      else draft.banks.unshift(entry)
    })
  }

  removeBank(id: string): Promise<AppState> {
    return this.transaction((draft) => { draft.banks = draft.banks.filter((entry) => entry.bank.id !== id) })
  }

  updateSettings(input: AppSettings): Promise<AppState> {
    const settings = settingsSchema.parse(input)
    return this.transaction((draft) => { draft.settings = settings })
  }

  saveMix(input: MixDraft): Promise<AppState> {
    const mix = mixDraftSchema.parse(input)
    return this.transaction((draft) => {
      if (mix.id) {
        const index = draft.mixes.findIndex((entry) => entry.id === mix.id)
        if (index < 0) throw new Error('This saved mix is no longer available.')
        draft.mixes[index] = { ...mix, id: mix.id }
      } else draft.mixes.unshift({ ...mix, id: randomUUID() })
    })
  }

  removeMix(id: string): Promise<AppState> {
    return this.transaction((draft) => { draft.mixes = draft.mixes.filter((mix) => mix.id !== id) })
  }

  start(input: StartConfig): Promise<AppState> {
    const config = startSchema.parse(input)
    return this.transaction((draft) => {
      this.expire(draft)
      if (draft.activeSession && !config.discardActive) throw new Error('You have an unfinished quiz. Resume it or discard it before starting another.')
      let questions: Question[]
      let questionOrigins: Record<string, QuestionOrigin> | undefined
      let bankId: string
      let bankTitle: string
      if (config.source.kind === 'bank') {
        const bank = draft.banks.find((entry) => entry.bank.id === config.source.id)?.bank
        if (!bank) throw new Error('This question bank is no longer in your library.')
        questions = bank.questions; bankId = bank.id; bankTitle = bank.title
      } else if (config.source.kind === 'mix') {
        const mix = draft.mixes.find((entry) => entry.id === config.source.id)
        if (!mix) throw new Error('This saved mix is no longer available.')
        if (config.questionCount !== mix.sources.reduce((sum, source) => sum + source.questionCount, 0)) throw new Error('The question count must match the saved mix. Edit the mix to change its counts.')
        const sample = sampleMix(mix)
        questions = sample.questions; questionOrigins = sample.questionOrigins
        bankId = mix.id; bankTitle = mix.title
      } else {
        const attempt = draft.attempts.find((entry) => entry.id === config.source.id)
        if (!attempt) throw new Error('This result is no longer available.')
        questions = config.source.missedOnly
          ? attempt.session.questions.filter((q) => selectedAnswer(attempt.session, q.id) !== q.correctOptionId)
          : attempt.session.questions
        bankId = attempt.session.bankId; bankTitle = attempt.session.bankTitle
        questionOrigins = attempt.session.questionOrigins
      }
      if (config.questionCount > questions.length) throw new Error('The question count exceeds the available questions.')
      const chosen = (config.shuffleQuestions ? shuffled(questions) : questions).slice(0, config.questionCount)
      const startedAt = this.now()
      draft.activeSession = {
        id: randomUUID(), bankId, bankTitle,
        questions: chosen.map((q) => ({ ...q, options: config.shuffleOptions ? shuffled(q.options) : [...q.options] })),
        ...(questionOrigins ? { questionOrigins: Object.fromEntries(chosen.map((q) => [q.id, questionOrigins![q.id]])) } : {}),
        mode: config.mode, answers: {}, checkedIds: [], currentIndex: 0, startedAt,
        deadline: config.mode === 'exam' && config.timeLimitMinutes !== null ? startedAt + config.timeLimitMinutes * 60_000 : null
      }
    })
  }

  answer(questionId: string, optionId: string): Promise<AppState> {
    return this.transaction((draft) => {
      if (this.expire(draft)) return
      const session = this.active(draft)
      const question = session.questions.find((q) => q.id === questionId)
      if (!question?.options.some((o) => o.id === optionId)) throw new Error('This answer is not part of the quiz.')
      if (session.checkedIds.includes(questionId)) throw new Error('This answer has already been checked and is locked.')
      session.answers = { ...session.answers, [questionId]: optionId }
    })
  }

  check(questionId: string): Promise<AppState> {
    return this.transaction((draft) => {
      if (this.expire(draft)) return
      const session = this.active(draft)
      if (session.mode !== 'practice') throw new Error('Answers are revealed after you submit an exam.')
      if (selectedAnswer(session, questionId) === undefined) throw new Error('Choose an answer first.')
      if (!session.checkedIds.includes(questionId)) session.checkedIds.push(questionId)
    })
  }

  navigate(index: number): Promise<AppState> {
    return this.transaction((draft) => {
      if (this.expire(draft)) return
      const session = this.active(draft)
      if (!Number.isInteger(index) || index < 0 || index >= session.questions.length) throw new Error('That question is not available.')
      if (session.currentIndex === index) return false
      session.currentIndex = index
    })
  }

  submit(): Promise<AppState> {
    return this.transaction((draft) => {
      if (!draft.activeSession) return false
      const expired = this.isExpired(draft.activeSession)
      this.complete(draft, expired ? 'expired' : 'manual')
    })
  }

  discard(): Promise<AppState> {
    return this.transaction((draft) => { if (!draft.activeSession) return false; draft.activeSession = null })
  }

  expireIfNeeded(): Promise<AppState> {
    return this.transaction((draft) => this.expire(draft))
  }

  private active(draft: AppState): QuizSession {
    if (!draft.activeSession) throw new Error('There is no unfinished quiz. Start one from your library.')
    return draft.activeSession
  }
  private isExpired(session: QuizSession): boolean { return session.deadline !== null && this.now() >= session.deadline }
  private expire(draft: AppState): boolean {
    if (!draft.activeSession || !this.isExpired(draft.activeSession)) return false
    this.complete(draft, 'expired')
    return true
  }
  private complete(draft: AppState, reason: 'manual' | 'expired'): void {
    const session = this.active(draft)
    if (!draft.attempts.some((attempt) => attempt.id === session.id)) {
      draft.attempts.unshift({ id: session.id, session, submittedAt: this.now(), reason, summary: summarize(session) })
    }
    draft.activeSession = null
  }
}
