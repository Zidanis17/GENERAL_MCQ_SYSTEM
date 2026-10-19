import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, expect } from '@playwright/test'

const executable = resolve(process.argv[2] || 'release/MCQ-Studio-Portable-1.0.0.exe')
const directory = await mkdtemp(join(tmpdir(), 'mcq-studio-portable-'))
const env = { ...process.env, MCQ_STUDIO_DATA_DIR: directory }
delete env.ELECTRON_RUN_AS_NODE
let child, browser, exited
async function launch() {
  child = spawn(executable, ['--remote-debugging-port=9224'], { env, stdio: 'ignore', windowsHide: true })
  exited = once(child, 'exit')
  for (let i = 0; i < 100; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9224', { timeout: 1000 }); break }
    catch { await delay(250) }
  }
  if (!browser) throw new Error('Portable app did not expose its test connection.')
  const page = browser.contexts()[0].pages()[0]
  await expect(page.getByRole('heading', { name: 'Your library.' })).toBeVisible()
  return page
}
async function close(page) {
  await page.close(); await browser.close(); browser = undefined
  let timeout
  try {
    await Promise.race([exited, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Portable launcher did not close cleanly.')), 10_000) })])
  } finally { clearTimeout(timeout) }
  child = undefined
}
try {
  await mkdir('.cache', { recursive: true })
  let page = await launch()
  await page.getByTestId('file-input').setInputFiles(resolve('examples/general-knowledge.json'))
  await expect(page.getByRole('heading', { name: 'A little of everything', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start studying' }).click()
  await page.getByRole('button', { name: 'Start practice', exact: true }).click()
  const answer = page.getByRole('radio', { name: 'B Mars', exact: true })
  await answer.click(); await expect(answer).toBeChecked()
  await page.getByRole('button', { name: 'Check answer', exact: true }).click()
  await expect(page.getByText('That’s right. Nicely done.')).toBeVisible()
  await close(page)
  page = await launch()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'B Mars', exact: true })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'B Mars', exact: true })).toBeDisabled()
  expect(await page.evaluate(async () => { try { await fetch('https://example.com'); return 'online' } catch { return 'offline' } })).toBe('offline')
  await page.getByRole('button', { name: 'Submit quiz', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Submit quiz', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Session complete.' })).toBeVisible()
  await expect(page.getByLabel('Quiz results')).toContainText('1 of 8 correct')
  await page.getByRole('button', { name: 'File format & help' }).click()
  await expect(page.getByRole('button', { name: 'Save example JSON', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.screenshot({ path: '.cache/portable-smoke.png' })
  await close(page)
  console.log('Portable app verified: independent launch, import, practice, restart/resume, results, offline operation, and example-export action.')
} finally {
  await browser?.close().catch(() => {})
  if (child?.pid) {
    const cleanup = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    await once(cleanup, 'exit')
  }
  if (!basename(directory).startsWith('mcq-studio-portable-')) throw new Error('Unexpected test folder')
  await rm(directory, { recursive: true, force: true })
}
