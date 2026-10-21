import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import example from '../../examples/general-knowledge.json' with { type: 'json' }

let application: ElectronApplication | undefined
let page: Page
let directory: string
const first = { ...example, schemaVersion: 1 as const, id: 'mix-first', title: 'Anatomy', questions: example.questions.slice(0, 2) }
const second = { ...example, schemaVersion: 1 as const, id: 'mix-second', title: 'Physiology', questions: example.questions.slice(0, 2) }
async function launch() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({ ...(process.env.MCQ_STUDIO_TEST_EXE ? { executablePath: process.env.MCQ_STUDIO_TEST_EXE, args: [] } : { args: [resolve('.')] }), env: { ...env, MCQ_STUDIO_DATA_DIR: directory }, timeout: 30_000 })
  page = await application.firstWindow()
  await expect(page.getByRole('heading', { name: 'Your library.' })).toBeVisible()
}
async function state() { const result = await page.evaluate(() => window.studio.load()); if (!result.ok) throw new Error(result.error); return result.value.state }
async function importBanks() {
  const paths = [join(directory, 'first.json'), join(directory, 'second.json')]
  await fs.writeFile(paths[0], JSON.stringify(first)); await fs.writeFile(paths[1], JSON.stringify(second))
  await page.getByTestId('file-input').setInputFiles(paths)
  await expect(page.getByRole('heading', { name: 'Anatomy', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Physiology', exact: true })).toBeVisible()
}
async function createMix() {
  await page.getByRole('button', { name: 'Create mix', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create a mix' })
  await dialog.getByLabel('Mix name').fill('Combined revision')
  await dialog.getByRole('checkbox', { name: /Anatomy/ }).check()
  await dialog.getByRole('spinbutton', { name: 'Questions from Anatomy', exact: true }).fill('1')
  await expect(dialog.getByRole('button', { name: 'Save mix' })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /Physiology/ }).check()
  await dialog.getByRole('spinbutton', { name: 'Questions from Physiology', exact: true }).fill('2')
  await expect(dialog.getByText('3 questions total', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Save mix' }).click()
  await expect(dialog).not.toBeVisible()
}
async function startMix(exam = false) {
  await page.getByRole('button', { name: 'Start mix', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Make this session yours' })
  await expect(dialog.getByRole('spinbutton', { name: 'Questions', exact: true })).toHaveAttribute('readonly', '')
  if (exam) await dialog.getByRole('button', { name: 'Exam', exact: true }).click()
  await dialog.getByRole('button', { name: exam ? 'Start exam' : 'Start practice', exact: true }).click()
}
async function answerFirst() {
  const session = (await state()).activeSession!, question = session.questions[0]
  const radio = page.getByRole('radio').nth(question.options.findIndex((option) => option.id === question.correctOptionId))
  await radio.click(); await expect(radio).toBeChecked(); await expect(radio).toBeEnabled()
  return session
}
test.beforeEach(async () => { directory = await fs.mkdtemp(join(tmpdir(), 'mcq-studio-features-e2e-')); await launch() })
test.afterEach(async () => {
  await application?.close(); application = undefined
  if (!basename(directory).startsWith('mcq-studio-features-e2e-')) throw new Error('Unexpected test directory')
  await fs.rm(directory, { recursive: true, force: true })
})

test('appearance follows the system, saves study defaults, and leaves active sessions intact', async ({}, testInfo) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(17, 24, 36)')
  await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(247, 248, 250)')
  const themes = page.getByRole('group', { name: 'Theme', exact: true })
  await themes.getByRole('button', { name: /Dark/ }).click(); await expect(themes.getByRole('button', { name: /Dark/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(17, 24, 36)')
  await page.getByRole('button', { name: 'Extra large', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-study-text-size', 'extra-large')
  await page.getByRole('group', { name: 'Default study mode' }).getByRole('button', { name: 'Exam', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Exam', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('checkbox', { name: /Shuffle questions/ }).check(); await expect(page.getByRole('checkbox', { name: /Shuffle questions/ })).toBeEnabled()
  await page.getByRole('checkbox', { name: /Shuffle answer choices/ }).check(); await expect(page.getByRole('checkbox', { name: /Shuffle answer choices/ })).toBeEnabled()
  const timer = page.getByRole('spinbutton', { name: 'Default exam time limit', exact: true })
  await timer.fill('1441'); await timer.press('Tab'); expect((await state()).settings.timeLimitMinutes).toBeNull()
  await timer.fill('45'); await timer.press('Enter'); await expect.poll(async () => (await state()).settings.timeLimitMinutes).toBe(45)
  await page.screenshot({ path: testInfo.outputPath('settings-dark.png'), fullPage: true })
  await application!.close(); application = undefined; await launch()
  expect((await state()).settings).toMatchObject({ theme: 'dark', studyTextSize: 'extra-large', defaultMode: 'exam', shuffleQuestions: true, shuffleOptions: true, timeLimitMinutes: 45 })
  await importBanks()
  await page.locator('.bank-card').filter({ has: page.getByRole('heading', { name: 'Anatomy', exact: true }) }).getByRole('button', { name: 'Start studying' }).click()
  const setup = page.getByRole('dialog', { name: 'Make this session yours' })
  await expect(setup.getByRole('button', { name: 'Exam', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(setup.getByRole('spinbutton', { name: 'Time limit', exact: true })).toHaveValue('45')
  await expect(setup.getByRole('checkbox', { name: /Shuffle questions/ })).toBeChecked()
  await setup.getByRole('button', { name: 'Start exam', exact: true }).click()
  const session = (await state()).activeSession!
  await expect(page.locator('.question-prompt')).toHaveCSS('font-size', '24.7px')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Default exam time limit', exact: true }).fill('30')
  await page.getByRole('button', { name: 'Reset settings', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system')
  expect((await state()).settings.timeLimitMinutes).toBeNull()
  expect((await state()).activeSession).toEqual(session)
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(880, 640))
  await page.getByRole('button', { name: 'Extra large', exact: true }).focus(); await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Extra large', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('settings-minimum-window.png'), fullPage: true })
})

test('frozen mixes survive bank deletion, resume, score overlapping IDs, and retry after mix deletion', async ({}, testInfo) => {
  await importBanks(); await createMix()
  await application!.close(); application = undefined; await launch()
  for (const title of ['Anatomy', 'Physiology']) {
    await page.getByRole('button', { name: `Delete ${title}`, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Remove bank', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  expect((await state()).banks).toHaveLength(0)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('group', { name: 'Theme', exact: true }).getByRole('button', { name: /Dark/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Extra large', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-study-text-size', 'extra-large')
  await page.getByRole('navigation').getByRole('button', { name: /Library/ }).click()
  await startMix(true); const session = await answerFirst()
  await expect(page.locator('.question-source')).toContainText('Anatomy')
  await expect(page.getByRole('button', { name: 'Check answer', exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('mixed-exam-dark.png'), fullPage: true })
  await application!.close(); application = undefined; await launch()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  expect((await state()).activeSession!.questions).toEqual(session.questions)
  await page.getByRole('button', { name: 'Submit quiz', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit quiz', exact: true }).click()
  await expect(page.getByLabel('Quiz results')).toContainText('1 of 3 correct')
  await expect(page.locator('.review-card .question-source')).toHaveCount(3)
  await page.screenshot({ path: testInfo.outputPath('mixed-results.png'), fullPage: true })
  await page.getByRole('navigation').getByRole('button', { name: /Library/ }).click()
  await page.getByRole('button', { name: 'Delete mix Combined revision', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete mix', exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: /History/ }).click()
  await page.locator('.history-card').click()
  await page.getByRole('button', { name: 'Retry 2 missed', exact: true }).click()
  await page.getByRole('button', { name: 'Start practice', exact: true }).click()
  const retry = (await state()).activeSession!
  expect(retry.questions).toEqual(session.questions.slice(1))
  await expect(page.locator('.question-source')).toContainText('Physiology')
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(880, 640))
  await answerFirst(); await page.getByRole('button', { name: 'Check answer', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Nicely done.' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('mixed-practice-dark-minimum.png'), fullPage: true })
})

test('editing validates quotas, retains frozen sources, and refreshes a bank only when reselected', async ({}, testInfo) => {
  await importBanks(); await createMix()
  const original = (await state()).mixes[0]
  const replaced = await page.evaluate((bank) => window.studio.saveBank(bank, true), { ...first, title: 'Updated anatomy', questions: [{ ...first.questions[0], prompt: 'Updated question?' }] })
  expect(replaced.ok).toBe(true)
  await application!.close(); application = undefined; await launch()
  await page.getByRole('button', { name: 'Edit Combined revision', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit saved mix' })
  await expect(dialog.getByRole('checkbox', { name: /Anatomy.*Saved copy/ })).toBeChecked()
  const quota = dialog.getByRole('spinbutton', { name: 'Questions from Anatomy', exact: true })
  await quota.fill('9'); await expect(dialog.getByRole('button', { name: 'Save mix' })).toBeDisabled()
  await quota.fill('2'); await dialog.getByLabel('Mix name').fill('Updated revision')
  await dialog.getByRole('button', { name: 'Save mix' }).click(); await expect(dialog).not.toBeVisible()
  expect((await state()).mixes[0].sources[0].bank).toEqual(original.sources[0].bank)
  await page.getByRole('button', { name: 'Edit Updated revision', exact: true }).click()
  await dialog.getByRole('checkbox', { name: /Anatomy.*Saved copy/ }).click()
  await expect(dialog.getByRole('checkbox', { name: /Updated anatomy/ })).not.toBeChecked()
  await dialog.getByRole('checkbox', { name: /Updated anatomy/ }).check()
  await page.screenshot({ path: testInfo.outputPath('mix-editor.png'), fullPage: true })
  await dialog.getByRole('button', { name: 'Save mix' }).click(); await expect(dialog).not.toBeVisible()
  expect((await state()).mixes[0].sources.find((source) => source.bank.id === first.id)!.bank.questions[0].prompt).toBe('Updated question?')
})

test('a timed mixed exam expires on reopening and keeps its source labels and saved answer', async () => {
  await importBanks(); await createMix()
  await page.getByRole('button', { name: 'Start mix', exact: true }).click()
  await page.getByRole('button', { name: 'Exam', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Time limit', exact: true }).fill('1')
  await page.getByRole('button', { name: 'Start exam', exact: true }).click()
  await answerFirst(); await application!.close(); application = undefined
  const path = join(directory, 'state.json'), saved = JSON.parse(await fs.readFile(path, 'utf8'))
  saved.activeSession.deadline = Date.now() - 1000; await fs.writeFile(path, JSON.stringify(saved))
  await launch(); await page.getByRole('navigation').getByRole('button', { name: /History/ }).click()
  await page.locator('.history-card').click()
  await expect(page.getByLabel('Quiz results')).toContainText('1 of 3 correct')
  await expect(page.getByText('Time ended. Your exam was submitted automatically', { exact: false })).toBeVisible()
  await expect(page.locator('.review-card .question-source')).toHaveCount(3)
})
