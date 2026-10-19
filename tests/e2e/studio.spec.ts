import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import example from '../../examples/general-knowledge.json' with { type: 'json' }
import manifest from '../../package.json' with { type: 'json' }

let application: ElectronApplication | undefined
let page: Page
let directory: string
let bankFile: string
const fixture = { ...example, id: 'integration-bank', title: 'Integration question bank', questions: example.questions.slice(0, 2) }
async function launch() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({
    ...(process.env.MCQ_STUDIO_TEST_EXE ? { executablePath: process.env.MCQ_STUDIO_TEST_EXE, args: [] } : { args: [resolve('.')] }),
    env: { ...env, MCQ_STUDIO_DATA_DIR: directory }, timeout: 30_000
  })
  page = await application.firstWindow()
  await expect(page.getByRole('heading', { name: 'Your library.' })).toBeVisible()
}
async function importFile(path = bankFile) { await page.getByTestId('file-input').setInputFiles(path); await expect(page.getByRole('heading', { name: fixture.title, exact: true })).toBeVisible() }
async function setup() { await page.getByRole('button', { name: 'Start studying' }).click(); await expect(page.getByRole('dialog', { name: 'Make this session yours' })).toBeVisible() }
async function choose(name: string) {
  const radio = page.getByRole('radio', { name, exact: true })
  await radio.click()
  // Selection is acknowledged after the main process has saved it to disk.
  await expect(radio).toBeChecked()
  await expect(radio).toBeEnabled()
}
async function finish() { await page.getByRole('button', { name: 'Submit quiz', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Submit quiz', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Session complete.' })).toBeVisible() }
async function dropFiles(files: { name: string; raw: string }[]) {
  await page.evaluate((files) => {
    const dataTransfer = new DataTransfer()
    for (const { name, raw } of files) dataTransfer.items.add(new File([raw], name, { type: 'application/json' }))
    document.querySelector('.app')!.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }))
  }, files)
}
async function writeBank(name: string, changes: Partial<typeof fixture> = {}) {
  const path = join(directory, name)
  await fs.writeFile(path, JSON.stringify({ ...fixture, ...changes }))
  return path
}

test.beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'mcq-studio-e2e-'))
  bankFile = join(directory, 'bank.json'); await fs.writeFile(bankFile, JSON.stringify(fixture)); await launch()
})
test.afterEach(async () => {
  await application?.close(); application = undefined
  if (!basename(directory).startsWith('mcq-studio-e2e-')) throw new Error('Unexpected test directory')
  await fs.rm(directory, { recursive: true, force: true })
})

test('practice: import, check, restart, resume, submit, review and retry missed questions', async ({}, testInfo) => {
  await page.screenshot({ path: testInfo.outputPath('01-empty-library.png') })
  await importFile(); await page.screenshot({ path: testInfo.outputPath('02-library.png') })
  await setup(); await page.getByRole('button', { name: 'Start practice', exact: true }).click()
  await choose('B Mars')
  await page.getByRole('button', { name: 'Check answer' }).click()
  await expect(page.getByText('That’s right. Nicely done.')).toBeVisible()
  await expect(page.getByRole('radio').first()).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('03-practice.png') })
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await choose('B O₂')
  await application!.close(); application = undefined; await launch()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'What is the chemical formula for water?' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'B O₂', exact: true })).toBeChecked()
  await page.getByRole('button', { name: 'Go to question 1, answered' }).click()
  await expect(page.getByRole('radio', { name: 'B Mars', exact: true })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'B Mars', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'Check answer' }).click()
  await expect(page.getByText('A good moment to learn.')).toBeVisible()
  await finish()
  await expect(page.getByLabel('Quiz results')).toContainText('1 of 2 correct')
  await page.screenshot({ path: testInfo.outputPath('04-results.png'), fullPage: true })
  await page.getByRole('button', { name: 'Retry 1 missed' }).click()
  await expect(page.getByRole('spinbutton', { name: 'Questions', exact: true })).toHaveValue('1')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Back to history' }).click()
  await expect(page.locator('.history-card')).toHaveCount(1)
})

test('exam: keep feedback hidden, change answers, submit and retain history after bank replacement', async () => {
  await importFile(); await setup(); await page.getByRole('button', { name: 'Exam', exact: true }).click(); await page.getByRole('button', { name: 'Start exam' }).click()
  await choose('A Venus')
  await choose('B Mars')
  await expect(page.getByRole('button', { name: 'Check answer' })).toHaveCount(0)
  await expect(page.locator('.answer-feedback')).toHaveCount(0)
  await expect(page.getByText('Iron oxides on the surface', { exact: false })).toHaveCount(0)
  await finish()
  await expect(page.getByLabel('Quiz results')).toContainText('1 of 2 correct')
  await expect(page.getByLabel('Quiz results')).toContainText('1Unanswered')
  await page.getByRole('navigation').getByRole('button', { name: /Library/ }).click()
  const updatedFile = join(directory, 'updated.json')
  await fs.writeFile(updatedFile, JSON.stringify({ ...fixture, title: 'Updated bank', questions: [{ ...fixture.questions[0], prompt: 'A new prompt' }] }))
  await page.getByTestId('file-input').setInputFiles(updatedFile)
  await page.getByRole('button', { name: 'Replace bank', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Updated bank' })).toBeVisible()
  await page.getByRole('navigation').getByRole('button', { name: /History/ }).click()
  await page.locator('.history-card').click()
  await expect(page.getByRole('heading', { name: fixture.questions[0].prompt })).toBeVisible()
})

test('expired exam submits on reopening, with saved answers and one history entry', async () => {
  await importFile(); await setup(); await page.getByRole('button', { name: 'Exam', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Time limit', exact: true }).fill('1')
  await page.getByRole('button', { name: 'Start exam' }).click(); await choose('B Mars')
  await expect(page.getByRole('timer')).toBeVisible(); await application!.close(); application = undefined
  const path = join(directory, 'state.json'); const state = JSON.parse(await fs.readFile(path, 'utf8')); state.activeSession.deadline = Date.now() - 1000; await fs.writeFile(path, JSON.stringify(state))
  await launch(); await page.getByRole('navigation').getByRole('button', { name: /History/ }).click()
  await expect(page.locator('.history-card')).toHaveCount(1); await page.locator('.history-card').click()
  await expect(page.getByText('Time ended. Your exam was submitted automatically', { exact: false })).toBeVisible()
  await expect(page.getByLabel('Quiz results')).toContainText('1 of 2 correct')
})

test('a running exam expires in the open window and dismisses the submission dialog', async () => {
  await importFile(); await setup(); await page.getByRole('button', { name: 'Exam', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Time limit', exact: true }).fill('1')
  await page.getByRole('button', { name: 'Start exam' }).click(); await choose('B Mars')
  await application!.close(); application = undefined
  const path = join(directory, 'state.json'); const state = JSON.parse(await fs.readFile(path, 'utf8'))
  state.activeSession.deadline = Date.now() + 5000; await fs.writeFile(path, JSON.stringify(state))
  await launch(); await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.getByRole('button', { name: 'Submit quiz', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Ready to finish?' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Session complete.' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Quiz results')).toContainText('1 of 2 correct')
})

test('drag-and-drop, unfinished-session choices and deletion retain the active snapshot', async () => {
  await page.evaluate((raw) => {
    const dataTransfer = new DataTransfer(); dataTransfer.items.add(new File([raw], 'bank.json', { type: 'application/json' }))
    document.querySelector('.app')!.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }))
  }, JSON.stringify(fixture))
  await expect(page.getByRole('heading', { name: fixture.title, exact: true })).toBeVisible()
  await setup(); await page.getByRole('button', { name: 'Start practice', exact: true }).click(); await choose('B Mars')
  await page.getByRole('button', { name: /Back to library/ }).click(); await setup()
  await page.getByRole('button', { name: 'Start practice', exact: true }).click()
  await page.getByRole('button', { name: 'Resume existing', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'B Mars', exact: true })).toBeChecked()
  await page.getByRole('button', { name: /Back to library/ }).click(); await setup()
  await page.getByRole('button', { name: 'Start practice', exact: true }).click(); await page.getByRole('button', { name: 'Discard & start', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'B Mars', exact: true })).not.toBeChecked()
  await page.getByRole('button', { name: /Back to library/ }).click()
  await page.getByRole('button', { name: `Delete ${fixture.title}`, exact: true }).click(); await page.getByRole('button', { name: 'Remove bank', exact: true }).click()
  await expect(page.locator('.bank-card')).toHaveCount(0)
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(page.getByRole('heading', { name: fixture.questions[0].prompt, exact: true })).toBeVisible()
})

test('invalid imports explain the problem without adding a bank', async () => {
  const invalid = join(directory, 'invalid.json'); await fs.writeFile(invalid, JSON.stringify({ ...fixture, schemaVersion: 2 }))
  await page.getByTestId('file-input').setInputFiles(invalid)
  await expect(page.getByRole('alert')).toContainText('schemaVersion')
  await expect(page.getByRole('heading', { name: 'Your next chapter starts here' })).toBeVisible()
  const oversized = join(directory, 'oversized.json'); await fs.writeFile(oversized, ' '.repeat(10 * 1024 * 1024 + 1))
  await page.getByTestId('file-input').setInputFiles(oversized)
  await expect(page.getByRole('alert')).toContainText('10 MiB')
})

test('multiple dropped banks remain separate and persist after restarting', async ({}, testInfo) => {
  const banks = [fixture, { ...fixture, id: 'second', title: 'Second bank' }, { ...fixture, id: 'third', title: 'Third bank' }]
  await dropFiles(banks.map((bank, index) => ({ name: `bank-${index}.json`, raw: JSON.stringify(bank) })))
  const summary = page.getByLabel('Import results')
  await expect(summary).toContainText('3 added · 0 replaced · 0 skipped · 0 failed')
  await expect(page.locator('.bank-card')).toHaveCount(3)
  await page.screenshot({ path: testInfo.outputPath('multiple-banks.png') })
  await application!.close(); application = undefined; await launch()
  for (const bank of banks) await expect(page.getByRole('heading', { name: bank.title, exact: true })).toBeVisible()
  const loaded = await page.evaluate(() => window.studio.load())
  expect(loaded.ok && loaded.value.state.banks.every(({ bank }) => bank.questions.length === 2)).toBe(true)
})

test('multiple input files save valid banks and name every failed file', async () => {
  const second = await writeBank('second.json', { id: 'second', title: 'Second bank' })
  const malformed = join(directory, 'malformed.json'); await fs.writeFile(malformed, '{')
  const unsupported = await writeBank('unsupported.json', { schemaVersion: 2 })
  const oversized = join(directory, 'oversized.json'); await fs.writeFile(oversized, ' '.repeat(10 * 1024 * 1024 + 1))
  const selection = [bankFile, malformed, unsupported, oversized, second]
  await page.getByTestId('file-input').setInputFiles(selection)
  const summary = page.getByRole('alert', { name: 'Import results' })
  await expect(summary).toContainText('2 added · 0 replaced · 0 skipped · 3 failed')
  await expect(summary).toContainText('malformed.json: This file is not valid JSON')
  await expect(summary).toContainText('unsupported.json: schemaVersion')
  await expect(summary).toContainText('oversized.json: This file exceeds the 10 MiB limit')
  await expect(page.locator('.bank-card')).toHaveCount(2)
  // The input is reset after every selection, including partially failed imports.
  await page.getByTestId('file-input').setInputFiles(selection)
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('second.json')
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(summary).toContainText('0 added · 0 replaced · 2 skipped · 3 failed')
  await page.getByRole('button', { name: 'Dismiss import results' }).click()
  await expect(summary).toHaveCount(0)
  await expect(page.locator('.bank-card')).toHaveCount(2)
})

test('native picker enables multiple selections and continues past unreadable files; cancellation keeps the results', async () => {
  const second = await writeBank('second.json', { id: 'second', title: 'Second native bank' })
  const malformed = join(directory, 'broken.json'); await fs.writeFile(malformed, '{')
  const paths = [bankFile, join(directory, 'missing.json'), malformed, second]
  await application!.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async (_window, options?) => {
      ;(globalThis as any).__bankDialogOptions = options
      return { canceled: false, filePaths: paths }
    }
  }, paths)
  await page.getByRole('button', { name: 'Import question banks', exact: true }).click()
  const summary = page.getByLabel('Import results')
  await expect(summary).toContainText('2 added · 0 replaced · 0 skipped · 2 failed')
  await expect(summary).toContainText('missing.json: This file could not be read')
  await expect(summary).toContainText('broken.json: This file is not valid JSON')
  expect(await application!.evaluate(() => (globalThis as any).__bankDialogOptions.properties)).toEqual(['openFile', 'multiSelections'])
  await application!.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
  const previous = await summary.textContent()
  await page.getByRole('button', { name: 'Import question banks', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Import question banks', exact: true })).toBeEnabled()
  expect(await summary.textContent()).toBe(previous)
  await expect(page.locator('.bank-card')).toHaveCount(2)
  expect(await page.evaluate(() => window.studio.chooseBanks())).toEqual({ ok: true, value: null })
})

test('batch duplicates offer Replace, Skip, Escape, and Close, ignore overlapping drops, and continue in order', async ({}, testInfo) => {
  const replacement = await writeBank('replace.json', { title: 'Replacement bank' })
  const skip = await writeBank('skip.json', { title: 'Skipped bank' })
  const escape = await writeBank('escape.json', { title: 'Escape bank' })
  const close = await writeBank('close.json', { title: 'Closed bank' })
  const last = await writeBank('last.json', { id: 'last', title: 'Last bank' })
  await page.getByTestId('file-input').setInputFiles([bankFile, replacement, skip, escape, close, last])
  const dialog = page.getByRole('dialog', { name: 'Replace this question bank?' })
  await expect(dialog).toContainText('replace.json')
  await expect(page.getByLabel('Import progress')).toContainText('Importing file 2 of 6')
  await expect(page.getByRole('button', { name: 'Import question banks', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Start studying' })).toBeDisabled()
  await expect(page.getByRole('button', { name: `Delete ${fixture.title}` })).toBeDisabled()
  await dropFiles([{ name: 'overlap.json', raw: JSON.stringify({ ...fixture, id: 'overlap', title: 'Overlapping bank' }) }])
  await expect(dialog).toContainText('replace.json')
  await page.screenshot({ path: testInfo.outputPath('batch-replacement.png') })
  await dialog.getByRole('button', { name: 'Replace bank', exact: true }).click()
  await expect(dialog).toContainText('skip.json')
  await expect(dialog).toContainText('Replacement bank')
  await dialog.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(dialog).toContainText('escape.json')
  await page.keyboard.press('Escape')
  await expect(dialog).toContainText('close.json')
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByLabel('Import results')).toContainText('2 added · 1 replaced · 3 skipped · 0 failed')
  await expect(page.locator('.bank-card')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: 'Replacement bank', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Last bank', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Overlapping bank', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Import question banks', exact: true })).toBeEnabled()
})

test('batch replacements preserve both completed results and the unfinished quiz snapshot', async () => {
  await importFile(); await setup(); await page.getByRole('button', { name: 'Start practice', exact: true }).click()
  await choose('B Mars'); await finish()
  await page.getByRole('navigation').getByRole('button', { name: /Library/ }).click()
  await setup(); await page.getByRole('button', { name: 'Start practice', exact: true }).click(); await choose('A Venus')
  await page.getByRole('button', { name: /Back to library/ }).click()
  const before = await page.evaluate(() => window.studio.load())
  if (!before.ok) throw new Error(before.error)
  const updated = await writeBank('updated.json', { title: 'Updated bank', questions: [{ ...fixture.questions[0], prompt: 'Changed question' }] })
  const second = await writeBank('second.json', { id: 'second', title: 'Second bank' })
  await page.getByTestId('file-input').setInputFiles([updated, second])
  await page.getByRole('button', { name: 'Replace bank', exact: true }).click()
  await expect(page.getByLabel('Import results')).toContainText('1 added · 1 replaced · 0 skipped · 0 failed')
  const after = await page.evaluate(() => window.studio.load())
  if (!after.ok) throw new Error(after.error)
  expect(after.value.state.activeSession).toEqual(before.value.state.activeSession)
  expect(after.value.state.attempts).toEqual(before.value.state.attempts)
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(page.getByRole('heading', { name: fixture.questions[0].prompt, exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'A Venus', exact: true })).toBeChecked()
})

test('an exam can expire while a batch awaits replacement without losing the prompt or remaining imports', async () => {
  await importFile(); await setup(); await page.getByRole('button', { name: 'Exam', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Time limit', exact: true }).fill('1')
  await page.getByRole('button', { name: 'Start exam' }).click(); await choose('B Mars')
  await application!.close(); application = undefined
  const statePath = join(directory, 'state.json')
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'))
  state.activeSession.deadline = Date.now() + 6000
  await fs.writeFile(statePath, JSON.stringify(state)); await launch()
  const updated = { ...fixture, title: 'Updated bank', questions: [{ ...fixture.questions[0], prompt: 'Changed question' }] }
  await dropFiles([
    { name: 'updated.json', raw: JSON.stringify(updated) },
    { name: 'next.json', raw: JSON.stringify({ ...fixture, id: 'next', title: 'Next bank' }) }
  ])
  const dialog = page.getByRole('dialog', { name: 'Replace this question bank?' })
  await expect(dialog).toBeVisible()
  await expect.poll(async () => JSON.parse(await fs.readFile(statePath, 'utf8')).attempts.length).toBe(1)
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Replace bank', exact: true }).click()
  await expect(page.getByLabel('Import results')).toContainText('1 added · 1 replaced · 0 skipped · 0 failed')
  const saved = JSON.parse(await fs.readFile(statePath, 'utf8'))
  expect(saved.activeSession).toBeNull()
  expect(saved.attempts[0].reason).toBe('expired')
  expect(saved.attempts[0].session.questions).toEqual(fixture.questions)
  expect(saved.attempts[0].session.answers).toEqual({ [fixture.questions[0].id]: 'b' })
  expect(saved.banks).toHaveLength(2)
})

test('app updates show the real version and explain unavailable updates without blocking study', async () => {
  await page.getByRole('button', { name: 'App updates', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'App updates' })
  await expect(dialog).toContainText(`MCQ Studio · Version ${manifest.version}`)
  const result = await page.evaluate(() => window.studio.getUpdateState())
  if (!result.ok) throw new Error(result.error)
  const check = dialog.getByRole('button', { name: 'Check for updates', exact: true })
  if (result.value.phase === 'disabled') {
    await expect(check).toBeDisabled()
    await expect(dialog).toContainText(result.value.message!)
  } else await expect(check).toBeEnabled()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await importFile()
})

test('native import, example export, offline restrictions and Unicode plain text', async () => {
  await application!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, bankFile)
  await page.getByRole('button', { name: 'Import question banks', exact: true }).click()
  await expect(page.getByRole('heading', { name: fixture.title, exact: true })).toBeVisible()
  const exported = join(directory, 'exported-example.json')
  await application!.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, exported)
  await page.getByRole('button', { name: 'File format & help' }).click()
  await page.getByRole('button', { name: 'Save example JSON', exact: true }).click()
  await expect.poll(async () => { try { return JSON.parse(await fs.readFile(exported, 'utf8')).id } catch { return null } }).toBe(example.id)
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  const unicode = join(directory, 'unicode.json')
  await fs.writeFile(unicode, JSON.stringify({ ...fixture, id: 'unicode', title: 'العربية', questions: [{ ...fixture.questions[0], prompt: 'سؤال بالعربية\n<script>window.injected = true</script>' }] }))
  await page.getByTestId('file-input').setInputFiles(unicode)
  await expect(page.getByRole('heading', { name: 'العربية', exact: true })).toBeVisible()
  await page.locator('.bank-card').filter({ has: page.getByRole('heading', { name: 'العربية', exact: true }) }).getByRole('button', { name: 'Start studying' }).click()
  await page.getByRole('button', { name: 'Start practice', exact: true }).click()
  await expect(page.locator('.question-prompt')).toHaveCSS('direction', 'rtl')
  expect(await page.evaluate(() => 'injected' in window)).toBe(false)
  expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined')
  expect(await page.evaluate(async () => { try { await fetch('https://example.com'); return 'online' } catch { return 'blocked' } })).toBe('blocked')
})
