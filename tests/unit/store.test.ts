import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StateStore } from '../../src/main/store'
import { bankSchema, type StartConfig } from '../../src/shared/model'
import example from '../../examples/general-knowledge.json'

let directory: string
let clock: number
let store: StateStore
const bank = bankSchema.parse(example)
const config = (changes: Partial<StartConfig> = {}): StartConfig => ({ source: { kind: 'bank', id: bank.id }, mode: 'practice', questionCount: 3, shuffleQuestions: false, shuffleOptions: false, timeLimitMinutes: null, discardActive: false, ...changes })
beforeEach(async () => { directory = await fs.mkdtemp(join(tmpdir(), 'mcq-studio-unit-')); clock = 1_000_000; store = new StateStore(directory, () => clock); await store.initialize(); await store.saveBank(bank, false) })
afterEach(async () => { await store.flush(); if (!basename(directory).startsWith('mcq-studio-unit-')) throw new Error('Unexpected test directory'); await fs.rm(directory, { recursive: true, force: true }) })

describe('bank and session storage', () => {
  it('persists imported banks and a resumed session with exact question order and checked state', async () => {
    await store.start(config({ shuffleQuestions: true, shuffleOptions: true }))
    const q = store.snapshot().activeSession!.questions[0]
    await store.answer(q.id, q.correctOptionId); await store.check(q.id); await store.navigate(1)
    const expected = store.snapshot()
    const reopened = new StateStore(directory); await reopened.initialize()
    expect(reopened.snapshot()).toEqual(expected)
  })
  it('requires confirmation before replacing a bank', async () => {
    await expect(store.saveBank({ ...bank, title: 'Updated' }, false)).rejects.toThrow('already exists')
    await store.saveBank({ ...bank, title: 'Updated' }, true)
    expect(store.snapshot().banks).toHaveLength(1)
    expect(store.snapshot().banks[0].bank.title).toBe('Updated')
  })
  it('retains active and result snapshots when the source is replaced or removed', async () => {
    await store.start(config()); const original = store.snapshot().activeSession
    await store.saveBank({ ...bank, title: 'Different bank', questions: [{ ...bank.questions[0], prompt: 'Changed!' }] }, true)
    expect(store.snapshot().activeSession).toEqual(original)
    await store.submit(); await store.removeBank(bank.id)
    expect(store.snapshot().attempts[0].session).toEqual(original)
    const attempt = store.snapshot().attempts[0]
    await store.start(config({ source: { kind: 'attempt', id: attempt.id, missedOnly: true } }))
    expect(store.snapshot().activeSession!.questions).toEqual(original!.questions)
  })
  it('permits one active quiz and explicitly discards it before starting another', async () => {
    await store.start(config()); const id = store.snapshot().activeSession!.id
    await expect(store.start(config())).rejects.toThrow('unfinished quiz')
    await store.start(config({ discardActive: true }))
    expect(store.snapshot().activeSession!.id).not.toBe(id)
    expect(store.snapshot().attempts).toHaveLength(0)
  })
  it('serializes concurrent changes so neither answer nor navigation is lost', async () => {
    await store.start(config())
    await Promise.all([store.answer('mars', 'b'), store.navigate(1), store.answer('water', 'c')])
    expect(store.snapshot().activeSession).toMatchObject({ currentIndex: 1, answers: { mars: 'b', water: 'c' } })
  })
  it('rejects invalid answers, navigation, question counts and timer values', async () => {
    await expect(store.start(config({ questionCount: 999 }))).rejects.toThrow('question count')
    expect(() => store.start(config({ timeLimitMinutes: 0 }))).toThrow()
    await store.start(config())
    await expect(store.answer('missing', 'a')).rejects.toThrow('not part')
    await expect(store.answer('mars', 'invalid')).rejects.toThrow('not part')
    await expect(store.navigate(-1)).rejects.toThrow('not available')
    await expect(store.navigate(99)).rejects.toThrow('not available')
  })
})

describe('practice, exams, expiry, and retries', () => {
  it('requires an answer before checking and locks checked answers', async () => {
    await store.start(config())
    await expect(store.check('mars')).rejects.toThrow('Choose an answer')
    await store.answer('mars', 'b'); await store.check('mars')
    await expect(store.answer('mars', 'a')).rejects.toThrow('locked')
    expect(store.snapshot().activeSession!.answers.mars).toBe('b')
  })
  it('allows changing exam answers but never checks them before submission', async () => {
    await store.start(config({ mode: 'exam' }))
    await store.answer('mars', 'a'); await store.answer('mars', 'b')
    await expect(store.check('mars')).rejects.toThrow('after you submit')
    expect(store.snapshot().activeSession!.checkedIds).toEqual([])
  })
  it('grades unchecked practice answers and records one attempt for repeated submissions', async () => {
    await store.start(config()); await store.answer('mars', 'b'); await store.answer('water', 'a')
    await Promise.all([store.submit(), store.submit(), store.submit()])
    expect(store.snapshot().attempts).toHaveLength(1)
    expect(store.snapshot().attempts[0].summary).toEqual({ total: 3, correct: 1, incorrect: 1, unanswered: 1, percentage: 33 })
  })
  it('submits expired exams on reopening, retaining saved answers', async () => {
    await store.start(config({ mode: 'exam', timeLimitMinutes: 1 })); await store.answer('mars', 'b')
    clock += 60_001
    const reopened = new StateStore(directory, () => clock); await reopened.initialize(); await reopened.expireIfNeeded()
    expect(reopened.snapshot().activeSession).toBeNull()
    expect(reopened.snapshot().attempts[0]).toMatchObject({ reason: 'expired', summary: { correct: 1 } })
    await reopened.expireIfNeeded(); await reopened.submit()
    expect(reopened.snapshot().attempts).toHaveLength(1)
  })
  it('prevents a late answer after the deadline', async () => {
    await store.start(config({ mode: 'exam', timeLimitMinutes: 1 }))
    clock += 60_000; await store.answer('mars', 'b')
    expect(store.snapshot().activeSession).toBeNull()
    expect(store.snapshot().attempts[0].summary.correct).toBe(0)
  })
  it('keeps untimed exams and practice resumable', async () => {
    await store.start(config({ mode: 'practice', timeLimitMinutes: 10 })); clock += 100_000_000
    await store.expireIfNeeded()
    expect(store.snapshot().activeSession!.deadline).toBeNull()
    await store.start(config({ mode: 'exam', discardActive: true })); clock += 100_000_000
    await store.expireIfNeeded()
    expect(store.snapshot().activeSession!.deadline).toBeNull()
  })
  it('retries only incorrect and unanswered snapshot questions', async () => {
    await store.start(config()); await store.answer('mars', 'b'); await store.answer('water', 'a'); await store.submit()
    const attempt = store.snapshot().attempts[0]
    await store.start(config({ source: { kind: 'attempt', id: attempt.id, missedOnly: true }, questionCount: 2 }))
    expect(store.snapshot().activeSession!.questions.map((q) => q.id)).toEqual(['water', 'photosynthesis'])
  })
})

describe('recovery', () => {
  it('recovers a backup and preserves the corrupt primary', async () => {
    await store.start(config()); await fs.writeFile(store.primary, 'broken JSON')
    const recovered = new StateStore(directory); await recovered.initialize()
    expect(recovered.snapshot().banks[0].bank.id).toBe(bank.id)
    expect(recovered.notice).toContain('recovered')
    expect((await fs.readdir(directory)).some((name) => name.startsWith('state.json.corrupt-'))).toBe(true)
  })
  it('recovers if the primary is missing but its backup exists', async () => {
    await store.start(config()); await fs.unlink(store.primary)
    const recovered = new StateStore(directory); await recovered.initialize()
    expect(recovered.snapshot().banks).toHaveLength(1)
    expect(recovered.notice).toContain('recovered')
  })
  it('preserves both corrupt files and starts fresh if neither is valid', async () => {
    await fs.writeFile(store.primary, '{}'); await fs.writeFile(store.backup, 'broken')
    const recovered = new StateStore(directory); await recovered.initialize()
    expect(recovered.snapshot().banks).toEqual([])
    expect(recovered.notice).toContain('fresh library')
    expect((await fs.readdir(directory)).filter((name) => name.includes('.corrupt-'))).toHaveLength(2)
  })
})
