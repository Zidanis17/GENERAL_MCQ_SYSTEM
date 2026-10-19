import { _electron as electron, expect } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile, rm, unlink, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const setup = resolve(`release/MCQ-Studio-Setup-${version}.exe`)
const executable = resolve('release/win-unpacked/MCQ Studio.exe')
const configPath = resolve('release/win-unpacked/resources/app-update.yml')
const directory = await mkdtemp(join(tmpdir(), 'mcq-studio-update-smoke-'))
const cacheName = `update-test-${randomUUID()}`
const nextVersion = version.replace(/\d+$/, (patch) => String(Number(patch) + 1))
let originalConfig, application, server, configChanged = false
try {
  try { originalConfig = await readFile(configPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(setup)) hash.update(chunk)
  const checksum = hash.digest('base64')
  const setupSize = (await stat(setup)).size
  const metadata = JSON.stringify({ version: nextVersion, files: [{ url: basename(setup), sha512: checksum, size: setupSize }], path: basename(setup), sha512: checksum, releaseDate: new Date().toISOString() })
  let unavailable = true
  server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    if (unavailable) { response.writeHead(503); response.end('Unavailable'); return }
    if (path === '/latest.yml') { response.writeHead(200, { 'Content-Type': 'application/yaml' }); response.end(metadata); return }
    if (path === `/${basename(setup)}`) {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': setupSize })
      if (request.method === 'HEAD') { response.end(); return }
      createReadStream(setup).pipe(response)
      return
    }
    response.writeHead(404); response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  await writeFile(configPath, `provider: generic\nurl: ${url}\nupdaterCacheDirName: ${cacheName}\n`)
  configChanged = true
  const env = { ...process.env, MCQ_STUDIO_DATA_DIR: join(directory, 'data'), LOCALAPPDATA: join(directory, 'local') }
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({ executablePath: executable, args: [], env, timeout: 30_000 })
  const page = await application.firstWindow()
  await expect(page.getByRole('heading', { name: 'Your library.' })).toBeVisible()
  await page.getByTestId('file-input').setInputFiles(resolve('examples/general-knowledge.json'))
  await page.getByRole('button', { name: 'Start studying' }).click()
  await page.getByRole('button', { name: 'Start practice', exact: true }).click()
  await page.getByRole('radio', { name: 'B Mars', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'B Mars', exact: true })).toBeChecked()
  await page.getByRole('button', { name: 'App updates', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'App updates' })
  await dialog.getByRole('button', { name: 'Check for updates', exact: true }).click()
  await expect(dialog).toContainText('Updates could not be checked.')
  unavailable = false
  await dialog.getByRole('button', { name: 'Check for updates', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: `Version ${nextVersion} is ready`, exact: true })).toBeVisible({ timeout: 90_000 })
  const downloaded = join(directory, 'local', cacheName, 'pending', basename(setup))
  expect(createHash('sha512').update(await readFile(downloaded)).digest('base64')).toBe(checksum)
  await dialog.getByRole('button', { name: 'Restart to update', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Save & restart now', exact: true })).toBeVisible()
  await expect(dialog).toContainText('unfinished quiz will be saved')
  await dialog.getByRole('button', { name: 'Later', exact: true }).click()
  const saved = await page.evaluate(() => window.studio.load())
  expect(saved.ok && saved.value.state.activeSession?.answers.mars).toBe('b')
  expect(await page.evaluate(async () => { try { await fetch('https://example.com'); return 'online' } catch { return 'blocked' } })).toBe('blocked')
  await mkdir('.cache', { recursive: true })
  await page.screenshot({ path: '.cache/update-smoke.png' })
  await application.close(); application = undefined
  console.log('Packaged updater verified: real feed requests, failure/retry, installer download and checksum, restart confirmation, retained quiz, and blocked renderer network.')
  console.log('The fixture uses a higher metadata version to exercise downloading; no installer is executed.')
} finally {
  await application?.close().catch(() => {})
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
  if (configChanged) {
    if (originalConfig) await writeFile(configPath, originalConfig)
    else await unlink(configPath)
  }
  if (!basename(directory).startsWith('mcq-studio-update-smoke-')) throw new Error('Unexpected update test directory')
  await rm(directory, { recursive: true, force: true })
}
