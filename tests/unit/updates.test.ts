import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateController } from '../../src/main/updates'
import { updateDisabledReason } from '../../src/shared/updates'

class Backend extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = true
  allowPrerelease = true
  allowDowngrade = true
  checkForUpdates = vi.fn<() => Promise<{ downloadPromise?: Promise<string[]> } | null>>().mockResolvedValue(null)
  quitAndInstall = vi.fn()
}
const controllers: UpdateController[] = []
function create(reason: string | null = null, flush = vi.fn(async () => {})) {
  const backend = new Backend()
  const publish = vi.fn()
  const controller = new UpdateController(backend, '1.1.0', reason, publish, flush)
  controllers.push(controller)
  return { backend, controller, publish, flush }
}
afterEach(() => { controllers.splice(0).forEach((controller) => controller.dispose()); vi.useRealTimers() })

describe('update behavior', () => {
  it('enables background stable downloads without downgrades or automatic installation', () => {
    const { backend } = create()
    expect(backend).toMatchObject({ autoDownload: true, autoInstallOnAppQuit: false, allowPrerelease: false, allowDowngrade: false })
  })
  it('does not check disabled builds', async () => {
    vi.useFakeTimers()
    const { backend, controller } = create('Not configured')
    controller.start(); await controller.check(); await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000)
    expect(backend.checkForUpdates).not.toHaveBeenCalled()
    expect(controller.snapshot()).toMatchObject({ phase: 'disabled', message: 'Not configured' })
  })
  it('checks after startup and every six hours, and stops on disposal', async () => {
    vi.useFakeTimers()
    const { backend, controller } = create()
    controller.start(); controller.start()
    await vi.advanceTimersByTimeAsync(9999); expect(backend.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1); expect(backend.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000); expect(backend.checkForUpdates).toHaveBeenCalledTimes(2)
    controller.dispose(); await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(backend.checkForUpdates).toHaveBeenCalledTimes(2)
  })
  it('coalesces simultaneous checks and reports no newer release', async () => {
    const { backend, controller } = create()
    let finish!: () => void
    backend.checkForUpdates.mockImplementation(() => new Promise((resolve) => { finish = () => { backend.emit('update-not-available'); resolve(null) } }))
    const first = controller.check(); const second = controller.check()
    expect(backend.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(controller.snapshot().phase).toBe('checking')
    finish(); await Promise.all([first, second])
    expect(controller.snapshot().phase).toBe('up-to-date')
  })
  it('publishes progress and waits for an explicit install after download', async () => {
    const { backend, controller, publish } = create()
    backend.emit('update-available', { version: '1.1.1' })
    backend.emit('download-progress', { percent: 42.8 })
    expect(controller.snapshot()).toMatchObject({ phase: 'downloading', availableVersion: '1.1.1', progress: 42 })
    const events = publish.mock.calls.length
    backend.emit('download-progress', { percent: 42.9 }); expect(publish.mock.calls).toHaveLength(events)
    backend.emit('download-progress', { percent: 500 }); expect(controller.snapshot().progress).toBe(100)
    backend.emit('update-downloaded', { version: '1.1.1' })
    expect(controller.snapshot()).toMatchObject({ phase: 'ready', progress: 100 })
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
    await controller.check(); expect(backend.checkForUpdates).not.toHaveBeenCalled()
  })
  it('waits for queued saves before restarting and prevents repeated installation', async () => {
    let save!: () => void
    const flush = vi.fn(() => new Promise<void>((resolve) => { save = resolve }))
    const { backend, controller } = create(null, flush)
    backend.emit('update-downloaded', { version: '1.1.1' })
    const installing = controller.install()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
    await expect(controller.install()).rejects.toThrow('finish downloading')
    save(); await installing
    expect(backend.quitAndInstall).toHaveBeenCalledWith(true, true)
  })
  it('does not install if progress could not be saved and allows retrying', async () => {
    const flush = vi.fn<() => Promise<void>>(async () => { throw new Error('Disk full') })
    const { backend, controller } = create(null, flush)
    backend.emit('update-downloaded', { version: '1.1.1' })
    await expect(controller.install()).rejects.toThrow('Disk full')
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
    expect(controller.snapshot().phase).toBe('ready')
    flush.mockResolvedValue(undefined); await controller.install()
    expect(backend.quitAndInstall).toHaveBeenCalledTimes(1)
  })
  it('rejects installation before a download is ready', async () => {
    const { backend, controller } = create()
    await expect(controller.install()).rejects.toThrow('finish downloading')
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
  })
  it('recovers from an offline check without disrupting the application', async () => {
    const { backend, controller } = create()
    backend.checkForUpdates.mockRejectedValueOnce(new Error('offline'))
    expect(await controller.check()).toMatchObject({ phase: 'error', message: expect.stringContaining('internet connection') })
    expect((await controller.check()).phase).toBe('up-to-date')
  })
  it('handles background download rejection and backend errors', async () => {
    const { backend, controller } = create()
    let fail!: (error: Error) => void
    const downloadPromise = new Promise<string[]>((_resolve, reject) => { fail = reject })
    backend.checkForUpdates.mockImplementation(async () => { backend.emit('update-available', { version: '1.1.1' }); return { downloadPromise } })
    await controller.check(); fail(new Error('Download failed')); await Promise.resolve()
    expect(controller.snapshot()).toMatchObject({ phase: 'error', message: expect.stringContaining('downloaded') })
    backend.emit('error', new Error('Download failed'))
    expect(controller.snapshot().message).toContain('downloaded')
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
  })
  it('ignores late notifications after disposal', () => {
    const { backend, controller, publish } = create()
    controller.dispose(); backend.emit('update-downloaded', { version: '1.1.1' })
    expect(publish).not.toHaveBeenCalled()
    expect(controller.snapshot().phase).toBe('idle')
  })
  it('distinguishes development, portable, unconfigured, and installed editions', () => {
    expect(updateDisabledReason(false, false, false)).toContain('installed app')
    expect(updateDisabledReason(true, true, true)).toContain('portable')
    expect(updateDisabledReason(true, false, false)).toContain('repository')
    expect(updateDisabledReason(true, false, true)).toBeNull()
  })
})

describe('GitHub release configuration', () => {
  async function fixture() {
    const directory = await fs.mkdtemp(join(tmpdir(), 'mcq-studio-release-'))
    const manifest = { name: 'test-app', version: '1.1.0', build: { appId: 'com.mcqstudio.desktop' } }
    await fs.writeFile(join(directory, 'package.json'), JSON.stringify(manifest))
    return { directory, manifest }
  }
  async function cleanup(directory: string) {
    if (!basename(directory).startsWith('mcq-studio-release-')) throw new Error('Unexpected test folder')
    await fs.rm(directory, { recursive: true, force: true })
  }
  function configure(directory: string, args: string[], env: Record<string, string> = {}) {
    return execFileSync(process.execPath, [resolve('scripts/configure-updates.mjs'), ...args], { cwd: directory, encoding: 'utf8', env: { ...process.env, ...env }, stdio: 'pipe' })
  }
  it('configures explicit public release coordinates without credentials', async () => {
    const { directory } = await fixture()
    try {
      configure(directory, ['example-owner/mcq-studio'])
      const saved = JSON.parse(await fs.readFile(join(directory, 'package.json'), 'utf8'))
      expect(saved.build.publish).toEqual({ provider: 'github', owner: 'example-owner', repo: 'mcq-studio', releaseType: 'draft', publishAutoUpdate: true })
      expect(saved.build.appId).toBe('com.mcqstudio.desktop')
      expect(saved.build.publish).not.toHaveProperty('token')
    } finally { await cleanup(directory) }
  })
  it('rejects malformed repository names before writing', async () => {
    const { directory, manifest } = await fixture()
    try {
      for (const value of ['', 'https://github.com/user/repo', 'user/../repo', 'user/..']) expect(() => configure(directory, [value])).toThrow()
      expect(JSON.parse(await fs.readFile(join(directory, 'package.json'), 'utf8'))).toEqual(manifest)
    } finally { await cleanup(directory) }
  })
  it('requires a matching tag and public repository in CI', async () => {
    const { directory } = await fixture()
    const env = { GITHUB_REPOSITORY: 'example-owner/mcq-studio', GITHUB_REF_NAME: 'v1.1.0', RELEASE_REPOSITORY_VISIBILITY: 'public' }
    try {
      expect(() => configure(directory, ['--ci'], { ...env, GITHUB_REF_NAME: 'v9.9.9' })).toThrow('release tag')
      expect(() => configure(directory, ['--ci'], { ...env, RELEASE_REPOSITORY_VISIBILITY: 'private' })).toThrow('public')
      configure(directory, ['--ci'], env)
      expect(JSON.parse(await fs.readFile(join(directory, 'package.json'), 'utf8')).build.publish.repo).toBe('mcq-studio')
    } finally { await cleanup(directory) }
  })
})

describe('release asset verification', () => {
  async function fixture() {
    const directory = await fs.mkdtemp(join(tmpdir(), 'mcq-studio-publish-'))
    await fs.mkdir(join(directory, 'release'))
    await fs.writeFile(join(directory, 'package.json'), JSON.stringify({ version: '1.1.1', build: { publish: { provider: 'github', owner: 'test-owner', repo: 'test-app' } } }))
    const installer = Buffer.from('A test installer payload; never executed.')
    await fs.writeFile(join(directory, 'release/MCQ-Studio-Setup-1.1.1.exe'), installer)
    await fs.writeFile(join(directory, 'release/MCQ-Studio-Portable-1.1.1.exe'), 'test portable')
    await fs.writeFile(join(directory, 'release/MCQ-Studio-Setup-1.1.1.exe.blockmap'), 'test blockmap')
    await fs.writeFile(join(directory, 'release/latest.yml'), `version: 1.1.1\npath: MCQ-Studio-Setup-1.1.1.exe\nsha512: ${createHash('sha512').update(installer).digest('base64')}\n`)
    return directory
  }
  function publish(directory: string, omit = false) {
    try {
      return execFileSync('powershell.exe', ['-NoProfile', '-File', resolve('tests/fixtures/publish-release.ps1'), '-Workspace', directory, '-PublisherScript', resolve('scripts/Publish-Release.ps1'), '-Journal', join(directory, 'calls.log'), ...(omit ? ['-OmitMetadata'] : [])], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' })
    } catch (error) {
      throw new Error(String((error as { stdout?: string }).stdout || (error as Error).message))
    }
  }
  async function cleanup(directory: string) {
    if (!basename(directory).startsWith('mcq-studio-publish-')) throw new Error('Unexpected test folder')
    await fs.rm(directory, { recursive: true, force: true })
  }
  it('creates one draft and uploads all four assets before publishing', async () => {
    const directory = await fixture()
    try {
      publish(directory)
      const calls = (await fs.readFile(join(directory, 'calls.log'), 'utf8')).trim().split(/\r?\n/)
      expect(calls.filter((line) => line.startsWith('release|create|'))).toHaveLength(1)
      expect(calls.filter((line) => line.startsWith('release|upload|'))).toHaveLength(4)
      expect(calls.at(-1)).toContain('release|edit|v1.1.1')
      expect(calls.at(-2)).toContain('release|view|v1.1.1')
      expect(calls.filter((line) => line.startsWith('release|upload|')).at(-1)).toContain('latest.yml')
    } finally { await cleanup(directory) }
  })
  it('does not publish if GitHub is missing an uploaded asset', async () => {
    const directory = await fixture()
    try {
      expect(() => publish(directory, true)).toThrow('missing or incomplete')
      expect(await fs.readFile(join(directory, 'calls.log'), 'utf8')).not.toContain('release|edit|')
    } finally { await cleanup(directory) }
  })
  it('rejects mismatched metadata before contacting GitHub', async () => {
    const directory = await fixture()
    try {
      await fs.writeFile(join(directory, 'release/latest.yml'), 'version: 1.1.1\npath: MCQ-Studio-Setup-1.1.1.exe\nsha512: invalid\n')
      expect(() => publish(directory)).toThrow('checksum')
      expect(await fs.readdir(directory)).not.toContain('calls.log')
    } finally { await cleanup(directory) }
  })
})
