import type { QuestionBank } from '../shared/model'

export type BankImportSource = { name: string; read: () => Promise<QuestionBank> }
export type BankImportSummary = { added: number; replaced: number; skipped: number; failures: { name: string; error: string }[] }
type ImportCallbacks = {
  findBank: (id: string) => QuestionBank | undefined
  confirmReplace: (name: string, existing: QuestionBank, incoming: QuestionBank) => Promise<boolean>
  saveBank: (bank: QuestionBank, replace: boolean) => Promise<void>
  onProgress: (current: number, total: number, name: string) => void
}

export async function importBanks(sources: BankImportSource[], callbacks: ImportCallbacks): Promise<BankImportSummary> {
  const summary: BankImportSummary = { added: 0, replaced: 0, skipped: 0, failures: [] }
  for (const [index, source] of sources.entries()) {
    callbacks.onProgress(index + 1, sources.length, source.name)
    try {
      const bank = await source.read()
      const existing = callbacks.findBank(bank.id)
      if (existing && !await callbacks.confirmReplace(source.name, existing, bank)) {
        summary.skipped++
        continue
      }
      await callbacks.saveBank(bank, Boolean(existing))
      if (existing) summary.replaced++
      else summary.added++
    } catch (error) {
      summary.failures.push({ name: source.name, error: error instanceof Error ? error.message : 'This file could not be imported. Please try again.' })
    }
  }
  return summary
}
