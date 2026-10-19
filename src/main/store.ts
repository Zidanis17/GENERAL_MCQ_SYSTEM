import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  bankSchema, emptyState, selectedAnswer, shuffled, startSchema, stateSchema, summarize,
  type AppState, type QuestionBank, type QuizSession, type StartConfig
} from '../shared/model'

export class StateStore {
  private state: AppState = emptyState()
  private tail: Promise<void> = Promise.resolve()
  notice: string | null = null
  readonly primary: string
  readonly backup: string

  constructor(readonly directory: string, private readonly now = Date.now) {
    this.primary = join(directory, 'state.json')
    this.backup = join(directory, 'state.backup.json')
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true })
    const primary = await this.readFile(this.primary)
    if (primary) { this.state = primary; return }
    const backup = await this.readFile(this.backup)
    if (backup) {
      this.state = backup
      this.notice = 'Your saved data was recovered from a backup. The damaged file, if any, has been kept in the application data folder.'
    } else if (this.notice) {
      this.notice = 'Your saved data could not be read. Damaged files have been preserved in the application data folder. A fresh library is ready to use.'
    }
    await this.persist(this.state)
  }

  private async readFile(path: string): Promise<AppState | null> {
    let raw: string
    try { raw = await fs.readFile(path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    try { return stateSchema.parse(JSON.parse(raw)) } catch {
      await fs.rename(path, `${path}.corrupt-${this.now()}-${randomUUID().slice(0, 6)}`)
      this.notice = 'A saved data file was damaged.'
      return null
    }
  }

  private async persist(state: AppState): Promise<void> {
    const temp = `${this.primary}.tmp`
    await fs.writeFile(temp, JSON.stringify(state), 'utf8')
    const handle = await fs.open(temp, 'r+')
    try { await handle.sync() } finally { await handle.close() }
    try {
      await fs.copyFile(this.primary, `${this.backup}.tmp`)
      await fs.rename(`${this.backup}.tmp`, this.backup)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await fs.rename(temp, this.primary)
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
        await this.persist(draft)
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

  start(input: StartConfig): Promise<AppState> {
    const config = startSchema.parse(input)
    return this.transaction((draft) => {
      this.expire(draft)
      if (draft.activeSession && !config.discardActive) throw new Error('You have an unfinished quiz. Resume it or discard it before starting another.')
      let questions
      let bankId: string
      let bankTitle: string
      if (config.source.kind === 'bank') {
        const bank = draft.banks.find((entry) => entry.bank.id === config.source.id)?.bank
        if (!bank) throw new Error('This question bank is no longer in your library.')
        questions = bank.questions; bankId = bank.id; bankTitle = bank.title
      } else {
        const attempt = draft.attempts.find((entry) => entry.id === config.source.id)
        if (!attempt) throw new Error('This result is no longer available.')
        questions = config.source.missedOnly
          ? attempt.session.questions.filter((q) => selectedAnswer(attempt.session, q.id) !== q.correctOptionId)
          : attempt.session.questions
        bankId = attempt.session.bankId; bankTitle = attempt.session.bankTitle
      }
      if (config.questionCount > questions.length) throw new Error('The question count exceeds the available questions.')
      const chosen = (config.shuffleQuestions ? shuffled(questions) : questions).slice(0, config.questionCount)
      const startedAt = this.now()
      draft.activeSession = {
        id: randomUUID(), bankId, bankTitle,
        questions: chosen.map((q) => ({ ...q, options: config.shuffleOptions ? shuffled(q.options) : [...q.options] })),
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
