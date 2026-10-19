import { z } from 'zod'
import type { AppUpdateState } from './updates'

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
const text = z.string().refine((value) => value.trim().length > 0, 'Must not be blank')
export const optionSchema = z.object({ id: text, text })
export const questionSchema = z.object({
  id: text,
  prompt: text,
  options: z.array(optionSchema).min(2, 'At least two options are required'),
  correctOptionId: text,
  explanation: z.string().optional()
}).superRefine((question, ctx) => {
  const ids = question.options.map((option) => option.id)
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Option IDs must be unique within this question' })
  if (!ids.includes(question.correctOptionId)) ctx.addIssue({ code: 'custom', path: ['correctOptionId'], message: 'Must match one of this question’s option IDs' })
})
export const questionsSchema = z.array(questionSchema).min(1, 'At least one question is required').superRefine((questions, ctx) => {
  const seen = new Set<string>()
  questions.forEach((question, index) => {
    if (seen.has(question.id)) ctx.addIssue({ code: 'custom', path: [index, 'id'], message: `Duplicate question ID: ${question.id}` })
    seen.add(question.id)
  })
})
export const bankSchema = z.object({
  schemaVersion: z.literal(1),
  id: text,
  title: text,
  description: z.string().optional(),
  questions: questionsSchema
})
export type Question = z.infer<typeof questionSchema>
export type QuestionBank = z.infer<typeof bankSchema>
export const modeSchema = z.enum(['practice', 'exam'])
export const sessionSchema = z.object({
  id: text,
  bankId: text,
  bankTitle: text,
  questions: questionsSchema,
  mode: modeSchema,
  answers: z.record(z.string(), z.string()),
  checkedIds: z.array(z.string()),
  currentIndex: z.number().int().nonnegative(),
  startedAt: z.number().finite().nonnegative(),
  deadline: z.number().finite().nonnegative().nullable()
}).superRefine((session, ctx) => {
  if (session.currentIndex >= session.questions.length) ctx.addIssue({ code: 'custom', path: ['currentIndex'], message: 'Question index is outside the quiz' })
  for (const [id, option] of Object.entries(session.answers)) {
    const question = session.questions.find((q) => q.id === id)
    if (!question?.options.some((o) => o.id === option)) ctx.addIssue({ code: 'custom', path: ['answers', id], message: 'Invalid saved answer' })
  }
  if (new Set(session.checkedIds).size !== session.checkedIds.length || session.checkedIds.some((id) => !Object.hasOwn(session.answers, id))) ctx.addIssue({ code: 'custom', path: ['checkedIds'], message: 'Invalid checked answers' })
  if (session.mode === 'practice' && session.deadline !== null) ctx.addIssue({ code: 'custom', path: ['deadline'], message: 'Practice sessions cannot have a deadline' })
})
export type QuizSession = z.infer<typeof sessionSchema>
export const summarySchema = z.object({
  total: z.number().int().positive(), correct: z.number().int().nonnegative(),
  incorrect: z.number().int().nonnegative(), unanswered: z.number().int().nonnegative(), percentage: z.number().min(0).max(100)
})
export type Summary = z.infer<typeof summarySchema>
export const attemptSchema = z.object({
  id: text, session: sessionSchema, submittedAt: z.number().finite().nonnegative(),
  reason: z.enum(['manual', 'expired']), summary: summarySchema
})
export type Attempt = z.infer<typeof attemptSchema>
export const stateSchema = z.object({
  version: z.literal(1),
  banks: z.array(z.object({ bank: bankSchema, importedAt: z.number() })),
  activeSession: sessionSchema.nullable(),
  attempts: z.array(attemptSchema)
}).superRefine((state, ctx) => {
  if (new Set(state.banks.map(({ bank }) => bank.id)).size !== state.banks.length) ctx.addIssue({ code: 'custom', path: ['banks'], message: 'Duplicate bank IDs' })
  if (new Set(state.attempts.map((a) => a.id)).size !== state.attempts.length) ctx.addIssue({ code: 'custom', path: ['attempts'], message: 'Duplicate attempts' })
})
export type AppState = z.infer<typeof stateSchema>
export const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bank'), id: text }),
  z.object({ kind: z.literal('attempt'), id: text, missedOnly: z.boolean() })
])
export type QuizSource = z.infer<typeof sourceSchema>
export const startSchema = z.object({
  source: sourceSchema, mode: modeSchema,
  questionCount: z.number().int().positive(),
  shuffleQuestions: z.boolean(), shuffleOptions: z.boolean(),
  timeLimitMinutes: z.number().int().min(1).max(1440).nullable(),
  discardActive: z.boolean()
})
export type StartConfig = z.infer<typeof startSchema>
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
export type LoadedState = { state: AppState; notice: string | null }
export interface StudioAPI {
  load(): Promise<Result<LoadedState>>
  chooseBank(): Promise<Result<QuestionBank | null>>
  parseBank(raw: string): Promise<Result<QuestionBank>>
  saveBank(bank: QuestionBank, replace: boolean): Promise<Result<AppState>>
  removeBank(id: string): Promise<Result<AppState>>
  start(config: StartConfig): Promise<Result<AppState>>
  answer(questionId: string, optionId: string): Promise<Result<AppState>>
  check(questionId: string): Promise<Result<AppState>>
  navigate(index: number): Promise<Result<AppState>>
  submit(): Promise<Result<AppState>>
  discard(): Promise<Result<AppState>>
  exportExample(): Promise<Result<boolean>>
  getUpdateState(): Promise<Result<AppUpdateState>>
  checkForUpdates(): Promise<Result<AppUpdateState>>
  installUpdate(): Promise<Result<AppUpdateState>>
  onUpdateState(callback: (state: AppUpdateState) => void): () => void
  onState(callback: (state: AppState) => void): () => void
  onError(callback: (message: string) => void): () => void
}

export function parseBank(raw: string): QuestionBank {
  if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_BYTES) throw new Error('This file exceeds the 10 MiB limit.')
  let value: unknown
  try { value = JSON.parse(raw.replace(/^\uFEFF/, '')) } catch { throw new Error('This file is not valid JSON. Check commas, quotation marks, and brackets.') }
  const result = bankSchema.safeParse(value)
  if (!result.success) throw new Error(formatValidation(result.error))
  return result.data
}
export function formatValidation(error: z.ZodError): string {
  return error.issues.slice(0, 5).map((issue) => `${issue.path.map((part, i) => typeof part === 'number' ? `[${part}]` : `${i ? '.' : ''}${String(part)}`).join('') || 'File'}: ${issue.message}`).join('\n')
}
export function emptyState(): AppState { return { version: 1, banks: [], activeSession: null, attempts: [] } }
export function selectedAnswer(session: QuizSession, id: string): string | undefined { return Object.hasOwn(session.answers, id) ? session.answers[id] : undefined }
export function summarize(session: QuizSession): Summary {
  const correct = session.questions.filter((q) => selectedAnswer(session, q.id) === q.correctOptionId).length
  const unanswered = session.questions.filter((q) => selectedAnswer(session, q.id) === undefined).length
  return { total: session.questions.length, correct, unanswered, incorrect: session.questions.length - correct - unanswered, percentage: Math.round(correct / session.questions.length * 100) }
}
export function shuffled<T>(values: T[], random = Math.random): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
