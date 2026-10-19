import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import exampleJSON from '../../examples/general-knowledge.json'
import { bankSchema, MAX_IMPORT_BYTES, type QuestionBank } from '../../src/shared/model'
import { readBankFiles } from '../../src/main/import-banks'
import { importBanks, type BankImportSource } from '../../src/renderer/import-banks'

const example = bankSchema.parse(exampleJSON)
const source = (name: string, bank: QuestionBank = example): BankImportSource => ({ name, read: async () => bank })

describe('sequential bank imports', () => {
  it('checks the latest library for every file and preserves earlier imports on Skip', async () => {
    const library = new Map<string, QuestionBank>()
    const first = { ...example, title: 'First' }
    const replacement = { ...example, title: 'Replacement' }
    const other = { ...example, id: 'other' }
    const confirmReplace = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const onProgress = vi.fn()
    const summary = await importBanks([
      source('first.json', first), source('replacement.json', replacement),
      source('skip.json', example), source('other.json', other)
    ], {
      findBank: (id) => library.get(id), confirmReplace, onProgress,
      saveBank: async (bank) => { library.set(bank.id, bank) }
    })
    expect(summary).toEqual({ added: 2, replaced: 1, skipped: 1, failures: [] })
    expect([...library.values()]).toEqual([replacement, other])
    expect(confirmReplace.mock.calls).toEqual([
      ['replacement.json', first, replacement], ['skip.json', replacement, example]
    ])
    expect(onProgress.mock.calls).toEqual([
      [1, 4, 'first.json'], [2, 4, 'replacement.json'], [3, 4, 'skip.json'], [4, 4, 'other.json']
    ])
  })

  it('waits for a duplicate decision before reading or saving the next file', async () => {
    let decide!: (replace: boolean) => void
    const nextRead = vi.fn(async () => ({ ...example, id: 'next' }))
    const saveBank = vi.fn(async () => {})
    const confirmReplace = vi.fn(() => new Promise<boolean>((resolve) => { decide = resolve }))
    const pending = importBanks([source('duplicate.json'), { name: 'next.json', read: nextRead }], {
      findBank: (id) => id === example.id ? example : undefined,
      confirmReplace, saveBank, onProgress: () => {}
    })
    await vi.waitFor(() => expect(confirmReplace).toHaveBeenCalledOnce())
    expect(nextRead).not.toHaveBeenCalled()
    expect(saveBank).not.toHaveBeenCalled()
    decide(false)
    expect(await pending).toMatchObject({ added: 1, skipped: 1 })
    expect(nextRead).toHaveBeenCalledOnce()
    expect(saveBank).toHaveBeenCalledExactlyOnceWith({ ...example, id: 'next' }, false)
  })

  it('continues after read, parse, and save errors, counting only successful saves', async () => {
    const saved: string[] = []
    const summary = await importBanks([
      { name: 'unreadable.json', read: async () => { throw new Error('Cannot read file') } },
      { name: 'invalid.json', read: async () => { throw new Error('Invalid JSON') } },
      source('save-failed.json', { ...example, id: 'save-failed' }),
      source('good.json', { ...example, id: 'good' })
    ], {
      findBank: () => undefined, confirmReplace: async () => true, onProgress: () => {},
      saveBank: async (bank) => {
        if (bank.id === 'save-failed') throw new Error('Disk is full')
        saved.push(bank.id)
      }
    })
    expect(saved).toEqual(['good'])
    expect(summary).toEqual({ added: 1, replaced: 0, skipped: 0, failures: [
      { name: 'unreadable.json', error: 'Cannot read file' },
      { name: 'invalid.json', error: 'Invalid JSON' },
      { name: 'save-failed.json', error: 'Disk is full' }
    ] })
  })

  it('continues after a failed replacement without counting it as replaced', async () => {
    const summary = await importBanks([source('duplicate.json'), source('next.json', { ...example, id: 'next' })], {
      findBank: (id) => id === example.id ? example : undefined,
      confirmReplace: async () => true, onProgress: () => {},
      saveBank: async (_bank, replace) => { if (replace) throw new Error('Save failed') }
    })
    expect(summary).toEqual({ added: 1, replaced: 0, skipped: 0, failures: [{ name: 'duplicate.json', error: 'Save failed' }] })
  })
})

describe('native bank file reads', () => {
  let directory: string | undefined
  afterEach(async () => {
    if (!directory) return
    if (!basename(directory).startsWith('mcq-studio-imports-')) throw new Error('Unexpected test directory')
    await fs.rm(directory, { recursive: true, force: true })
    directory = undefined
  })

  it('returns named results in selection order despite invalid, oversized, missing, and folder inputs', async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'mcq-studio-imports-'))
    const names = ['first.json', 'broken.json', 'schema.json', 'large.json', 'missing.json', 'folder', 'last.json']
    const paths = names.map((name) => join(directory!, name))
    await Promise.all([
      fs.writeFile(paths[0], '\uFEFF' + JSON.stringify(example)),
      fs.writeFile(paths[1], '{'),
      fs.writeFile(paths[2], JSON.stringify({ ...example, schemaVersion: 2 })),
      fs.writeFile(paths[3], Buffer.alloc(MAX_IMPORT_BYTES + 1, ' ')),
      fs.mkdir(paths[5]),
      fs.writeFile(paths[6], JSON.stringify({ ...example, id: 'last' }))
    ])
    const results = await readBankFiles(paths)
    expect(results.map(({ name }) => name)).toEqual(names)
    expect(results.map(({ result }) => result.ok)).toEqual([true, false, false, false, false, false, true])
    expect(results[0].result).toEqual({ ok: true, value: example })
    const errors = results.slice(1, 6).map(({ result }) => !result.ok ? result.error : '')
    expect(errors[0]).toContain('not valid JSON')
    expect(errors[1]).toContain('schemaVersion')
    expect(errors[2]).toContain('10 MiB')
    expect(errors[3]).toContain('could not be read')
    expect(errors[4]).toContain('Folders cannot be imported')
    expect(results[6].result).toEqual({ ok: true, value: { ...example, id: 'last' } })
  })
})
