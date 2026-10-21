import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StateStore } from '../../src/main/store'
import {
  bankSchema, DEFAULT_SETTINGS, mixDraftSchema, mixedQuestionId, sampleMix, sessionSchema, settingsSchema, stateSchema,
  type MixDraft, type SavedMix, type StartConfig
} from '../../src/shared/model'
import example from '../../examples/general-knowledge.json'

const first = bankSchema.parse({ ...example, id: 'first', title: 'First bank' })
const second = bankSchema.parse({ ...example, id: 'second', title: 'Second bank' })
const draft = (): MixDraft => ({ title: 'Revision', sources: [{ bank: structuredClone(first), questionCount: 3 }, { bank: structuredClone(second), questionCount: 2 }] })
const config = (id: string, changes: Partial<StartConfig> = {}): StartConfig => ({ source: { kind: 'mix', id }, mode: 'exam', questionCount: 5, shuffleQuestions: false, shuffleOptions: false, timeLimitMinutes: null, discardActive: false, ...changes })
let directory: string
let store: StateStore
beforeEach(async () => { directory = await fs.mkdtemp(join(tmpdir(), 'mcq-studio-features-')); store = new StateStore(directory, () => 1_000_000); await store.initialize() })
afterEach(async () => { await store.flush(); if (!basename(directory).startsWith('mcq-studio-features-')) throw new Error('Unexpected test directory'); await fs.rm(directory, { recursive: true, force: true }) })

describe('settings and compatibility', () => {
  it('opens a legacy state without rewriting or losing banks, answers, or history', async () => {
    await store.saveBank(first, false)
    const single: StartConfig = { ...config(first.id), source: { kind: 'bank', id: first.id } }
    await store.start(single); await store.answer('mars', 'b'); await store.submit(); await store.start(single); await store.answer('water', 'c')
    const { settings: _settings, mixes: _mixes, ...legacy } = store.snapshot()
    const raw = JSON.stringify(legacy)
    await fs.writeFile(store.primary, raw); await fs.writeFile(store.backup, raw)
    const reopened = new StateStore(directory); await reopened.initialize()
    expect(reopened.snapshot()).toEqual({ ...legacy, settings: DEFAULT_SETTINGS, mixes: [] })
    expect(await fs.readFile(store.primary, 'utf8')).toBe(raw)
    await reopened.updateSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })
    expect(JSON.parse(await fs.readFile(store.backup, 'utf8')).activeSession).toEqual(legacy.activeSession)
    expect(reopened.snapshot().attempts).toEqual(legacy.attempts)
  })

  it('persists preferences, resets them, and recovers them with mixes from the previous backup', async () => {
    await store.updateSettings({ ...DEFAULT_SETTINGS, theme: 'dark', studyTextSize: 'extra-large', defaultMode: 'exam', timeLimitMinutes: 45, shuffleQuestions: true, shuffleOptions: true })
    await store.saveMix(draft())
    const expected = store.snapshot()
    const reopened = new StateStore(directory); await reopened.initialize(); expect(reopened.snapshot()).toEqual(expected)
    await store.updateSettings(DEFAULT_SETTINGS)
    expect(store.snapshot().settings).toEqual(DEFAULT_SETTINGS)
    await fs.writeFile(store.primary, 'broken JSON')
    const recovered = new StateStore(directory); await recovered.initialize(); expect(recovered.snapshot()).toEqual(expected)
  })

  it.each([{ theme: 'neon' }, { studyTextSize: 'tiny' }, { defaultMode: 'review' }, { timeLimitMinutes: 0 }, { timeLimitMinutes: 1441 }, { timeLimitMinutes: 1.5 }])('rejects invalid settings %j', (change) => {
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...change }).success).toBe(false)
  })

  it('keeps saved settings and mixes intact after a write failure and permits retry', async () => {
    await store.saveMix(draft())
    const expected = store.snapshot(), preserved = `${store.primary}.preserved`
    await fs.rename(store.primary, preserved); await fs.mkdir(store.primary)
    await expect(store.updateSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })).rejects.toThrow()
    await expect(store.saveMix(draft())).rejects.toThrow()
    expect(store.snapshot()).toEqual(expected)
    await fs.rmdir(store.primary); await fs.rename(preserved, store.primary)
    await store.updateSettings({ ...DEFAULT_SETTINGS, theme: 'dark' }); expect(store.snapshot().settings.theme).toBe('dark')
  })
})

describe('frozen saved mixes', () => {
  it('validates names, distinct banks, and positive quotas bounded by the frozen pools', () => {
    const valid = draft()
    for (const invalid of [
      { ...valid, title: '   ' }, { ...valid, sources: valid.sources.slice(0, 1) },
      { ...valid, sources: [valid.sources[0], valid.sources[0]] },
      { ...valid, sources: [{ ...valid.sources[0], questionCount: 0 }, valid.sources[1]] },
      { ...valid, sources: [{ ...valid.sources[0], questionCount: 999 }, valid.sources[1]] }
    ]) expect(mixDraftSchema.safeParse(invalid).success).toBe(false)
    expect(mixDraftSchema.parse({ ...valid, title: ' Revision ' }).title).toBe('Revision')
  })

  it('draws exact quotas without replacement, preserves bank order, and supports fresh samples', () => {
    const mix: SavedMix = { ...draft(), id: 'mix' }
    const before = structuredClone(mix)
    const a = sampleMix(mix, () => 0), b = sampleMix(mix, () => 0.99)
    expect(a.questions).toHaveLength(5)
    expect(new Set(a.questions.map((q) => q.id)).size).toBe(5)
    expect(Object.values(a.questionOrigins).map((origin) => origin.bankId)).toEqual(['first', 'first', 'first', 'second', 'second'])
    expect(a.questions.map((q) => q.id)).not.toEqual(b.questions.map((q) => q.id))
    for (const bank of [first, second]) {
      const indices = a.questions.filter((q) => a.questionOrigins[q.id].bankId === bank.id).map((q) => bank.questions.findIndex((original) => original.id === a.questionOrigins[q.id].questionId))
      expect(indices).toEqual([...indices].sort((x, y) => x - y))
    }
    expect(mix).toEqual(before)
    expect(mixedQuestionId('a,b', 'c')).not.toBe(mixedQuestionId('a', 'b,c'))
  })

  it('keeps full frozen pools independent of caller changes and library replacement/deletion', async () => {
    await store.saveBank(first, false); await store.saveBank(second, false)
    const input = draft(); await store.saveMix(input); input.sources[0].bank.questions[0].prompt = 'Mutated!'
    const mix = store.snapshot().mixes[0]
    expect(mix.sources[0].bank.questions).toHaveLength(first.questions.length)
    await store.saveBank({ ...first, questions: [{ ...first.questions[0], prompt: 'Replacement!' }] }, true)
    await store.removeBank(first.id); await store.removeBank(second.id)
    const reopened = new StateStore(directory); await reopened.initialize(); await reopened.start(config(mix.id))
    expect(reopened.snapshot().activeSession!.questions.every((q) => q.prompt !== 'Replacement!' && q.prompt !== 'Mutated!')).toBe(true)
    expect(reopened.snapshot().mixes[0]).toEqual(mix)
  })

  it('scores overlapping IDs independently, shuffles safely, and retries exact missed snapshots after deletion', async () => {
    const input = draft(); input.sources.forEach((source) => { source.questionCount = source.bank.questions.length })
    await store.saveMix(input); const mix = store.snapshot().mixes[0]
    await store.start(config(mix.id, { questionCount: 16, shuffleQuestions: true, shuffleOptions: true }))
    const session = store.snapshot().activeSession!
    expect(new Set(session.questions.map((q) => q.id)).size).toBe(16)
    const firstMars = mixedQuestionId(first.id, 'mars'), secondMars = mixedQuestionId(second.id, 'mars')
    await store.answer(firstMars, 'b'); await store.answer(secondMars, 'a'); await store.submit()
    const attempt = store.snapshot().attempts[0]
    expect(attempt.summary).toMatchObject({ total: 16, correct: 1, incorrect: 1, unanswered: 14 })
    await store.removeMix(mix.id)
    await store.start(config(mix.id, { source: { kind: 'attempt', id: attempt.id, missedOnly: true }, questionCount: 15 }))
    const retry = store.snapshot().activeSession!
    expect(retry.questions).toEqual(session.questions.filter((q) => q.id !== firstMars))
    expect(Object.keys(retry.questionOrigins!)).toHaveLength(15)
    expect(sessionSchema.safeParse(retry).success).toBe(true)
    const changed = structuredClone(retry); delete changed.questionOrigins![secondMars]
    expect(sessionSchema.safeParse(changed).success).toBe(false)
  })

  it('enforces mix totals and preserves active snapshots when a mix changes or is deleted', async () => {
    await store.saveMix(draft()); const mix = store.snapshot().mixes[0]
    await expect(store.start(config(mix.id, { questionCount: 4 }))).rejects.toThrow('must match')
    await store.start(config(mix.id)); const session = store.snapshot().activeSession
    await store.saveMix({ ...mix, title: 'Edited', sources: mix.sources.map((source) => ({ ...source, questionCount: 1 })) })
    expect(store.snapshot().activeSession).toEqual(session)
    await store.removeMix(mix.id); expect(store.snapshot().activeSession).toEqual(session)
    await store.submit(); expect(store.snapshot().attempts[0].session).toEqual(session)
    expect(stateSchema.safeParse(store.snapshot()).success).toBe(true)
    await expect(store.saveMix(mix)).rejects.toThrow('no longer available')
    await expect(store.start(config(mix.id))).rejects.toThrow('no longer available')
  })

  it('requires explicit active-session replacement and expires mixed exams with retained origins', async () => {
    await store.saveMix(draft()); const mix = store.snapshot().mixes[0]
    await store.start(config(mix.id)); await expect(store.start(config(mix.id))).rejects.toThrow('unfinished quiz')
    await store.start(config(mix.id, { discardActive: true, timeLimitMinutes: 1 }))
    const session = store.snapshot().activeSession!, question = session.questions[0]
    await store.answer(question.id, question.correctOptionId)
    const reopened = new StateStore(directory, () => 1_060_001); await reopened.initialize(); await reopened.expireIfNeeded()
    const attempt = reopened.snapshot().attempts[0]
    expect(attempt.reason).toBe('expired'); expect(attempt.summary.correct).toBe(1)
    expect(attempt.session.questionOrigins).toEqual(session.questionOrigins)
  })
})
