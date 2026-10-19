import { describe, expect, it } from 'vitest'
import { bankSchema, MAX_IMPORT_BYTES, parseBank, shuffled, summarize, type QuizSession } from '../../src/shared/model'
import example from '../../examples/general-knowledge.json'

const bank = () => structuredClone(example)
describe('question bank import', () => {
  it('accepts the bundled example, Unicode and an optional UTF-8 BOM', () => {
    const imported = parseBank('\uFEFF' + JSON.stringify(example))
    expect(imported.questions[5].prompt).toBe('ما عاصمة مصر؟')
    expect(imported.questions).toHaveLength(8)
  })
  it('allows omitted descriptions and explanations, and strips extra fields', () => {
    const input = { ...bank(), description: undefined, extra: 'ignored' }
    const imported = parseBank(JSON.stringify(input))
    expect(imported).not.toHaveProperty('extra')
    expect(imported).not.toHaveProperty('description')
  })
  it.each(['{', '{} trailing', '{"questions":[],}'])('explains malformed JSON: %s', (raw) => {
    expect(() => parseBank(raw)).toThrow('not valid JSON')
  })
  it('rejects unsupported versions', () => {
    expect(() => parseBank(JSON.stringify({ ...bank(), schemaVersion: 2 }))).toThrow('schemaVersion')
  })
  it.each(['id', 'title'] as const)('rejects blank %s', (field) => {
    expect(() => parseBank(JSON.stringify({ ...bank(), [field]: ' \t\n' }))).toThrow('Must not be blank')
  })
  it('requires at least one question and two options', () => {
    expect(bankSchema.safeParse({ ...bank(), questions: [] }).success).toBe(false)
    const input = bank(); input.questions[0].options = input.questions[0].options.slice(0, 1)
    expect(() => parseBank(JSON.stringify(input))).toThrow('questions[0].options')
  })
  it('reports duplicate question IDs', () => {
    const input = bank(); input.questions[1].id = input.questions[0].id
    expect(() => parseBank(JSON.stringify(input))).toThrow('questions[1].id: Duplicate question ID')
  })
  it('reports duplicate option IDs', () => {
    const input = bank(); input.questions[0].options[1].id = input.questions[0].options[0].id
    expect(() => parseBank(JSON.stringify(input))).toThrow('Option IDs must be unique')
  })
  it('rejects absent or nonmatching correct answers', () => {
    const input = bank(); input.questions[0].correctOptionId = 'missing'
    expect(() => parseBank(JSON.stringify(input))).toThrow('questions[0].correctOptionId')
    expect(bankSchema.safeParse({ ...input, questions: [{ ...input.questions[0], correctOptionId: undefined }] }).success).toBe(false)
  })
  it('limits UTF-8 bytes, including multibyte content', () => {
    expect(() => parseBank('x'.repeat(MAX_IMPORT_BYTES + 1))).toThrow('10 MiB')
    expect(() => parseBank('م'.repeat(MAX_IMPORT_BYTES / 2 + 1))).toThrow('10 MiB')
  })
  it('keeps markup as literal text', () => {
    const input = bank(); input.questions[0].prompt = '<script>alert(1)</script>'
    expect(parseBank(JSON.stringify(input)).questions[0].prompt).toBe('<script>alert(1)</script>')
  })
})

describe('scoring and shuffling', () => {
  function session(): QuizSession {
    return { id: 'test', bankId: example.id, bankTitle: example.title, questions: example.questions.slice(0, 3), mode: 'exam', answers: { mars: 'b', water: 'a' }, checkedIds: [], currentIndex: 0, startedAt: 1, deadline: null }
  }
  it('counts correct, wrong, and unanswered questions without penalties', () => {
    expect(summarize(session())).toEqual({ total: 3, correct: 1, incorrect: 1, unanswered: 1, percentage: 33 })
  })
  it('scores by stable IDs after options are shuffled', () => {
    const quiz = session(); quiz.questions = quiz.questions.map((q) => ({ ...q, options: shuffled(q.options, () => 0) }))
    expect(summarize(quiz).correct).toBe(1)
  })
  it('shuffles without mutating or losing values', () => {
    const values = [1, 2, 3, 4]
    const result = shuffled(values, () => 0)
    expect(result).not.toEqual(values)
    expect([...result].sort()).toEqual(values)
    expect(values).toEqual([1, 2, 3, 4])
  })
  it('does not treat inherited property names as selected answers', () => {
    const quiz = session(); quiz.questions = [{ ...quiz.questions[0], id: 'toString' }]; quiz.answers = {}
    expect(summarize(quiz).unanswered).toBe(1)
  })
})
