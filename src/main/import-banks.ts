import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import { MAX_IMPORT_BYTES, parseBank, type BankImportResult } from '../shared/model'

export async function readBankFiles(paths: string[]): Promise<BankImportResult[]> {
  const files: BankImportResult[] = []
  for (const path of paths) {
    try {
      const info = await fs.stat(path)
      if (!info.isFile()) throw new Error('Folders cannot be imported. Choose JSON files.')
      if (info.size > MAX_IMPORT_BYTES) throw new Error('This file exceeds the 10 MiB limit.')
      files.push({ name: basename(path), result: { ok: true, value: parseBank(await fs.readFile(path, 'utf8')) } })
    } catch (error) {
      const message = error instanceof Error && 'code' in error
        ? 'This file could not be read. Check that it still exists and you have permission to open it.'
        : error instanceof Error ? error.message : 'This file could not be read.'
      files.push({ name: basename(path), result: { ok: false, error: message } })
    }
  }
  return files
}
