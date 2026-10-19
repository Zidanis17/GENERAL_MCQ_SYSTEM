import type { AppUpdater } from 'electron-updater'
import type { AppUpdateState } from '../shared/updates'

type UpdateBackend = Pick<AppUpdater,
  'autoDownload' | 'autoInstallOnAppQuit' | 'allowPrerelease' | 'allowDowngrade' |
  'checkForUpdates' | 'quitAndInstall'> & {
    on(event: Parameters<AppUpdater['on']>[0], listener: (...args: any[]) => void): unknown
    removeListener(event: Parameters<AppUpdater['on']>[0], listener: (...args: any[]) => void): unknown
  }

export class UpdateController {
  private state: AppUpdateState
  private pendingCheck: Promise<AppUpdateState> | null = null
  private startupTimer?: ReturnType<typeof setTimeout>
  private interval?: ReturnType<typeof setInterval>
  private listeners: Array<() => void> = []
  private disposed = false

  constructor(
    private readonly backend: UpdateBackend,
    currentVersion: string,
    disabledReason: string | null,
    private readonly publish: (state: AppUpdateState) => void,
    private readonly beforeInstall: () => Promise<void>
  ) {
    this.state = { currentVersion, phase: disabledReason ? 'disabled' : 'idle', availableVersion: null, progress: null, message: disabledReason }
    backend.autoDownload = true
    backend.autoInstallOnAppQuit = false
    backend.allowPrerelease = false
    backend.allowDowngrade = false
    const listen = (event: Parameters<AppUpdater['on']>[0], listener: (...args: any[]) => void) => {
      backend.on(event, listener)
      this.listeners.push(() => backend.removeListener(event, listener))
    }
    listen('checking-for-update', () => this.change({ phase: 'checking', message: null, progress: null }))
    listen('update-not-available', () => this.change({ phase: 'up-to-date', availableVersion: null, progress: null, message: null }))
    listen('update-available', (info: { version: string }) => this.change({ phase: 'downloading', availableVersion: info.version, progress: 0, message: null }))
    listen('download-progress', (info: { percent: number }) => {
      const progress = Number.isFinite(info.percent) ? Math.max(0, Math.min(100, Math.floor(info.percent))) : 0
      if (progress !== this.state.progress) this.change({ phase: 'downloading', progress })
    })
    listen('update-downloaded', (info: { version: string }) => this.change({ phase: 'ready', availableVersion: info.version, progress: 100, message: null }))
    listen('error', () => this.failed())
  }

  snapshot(): AppUpdateState { return { ...this.state } }

  start(): void {
    if (this.state.phase === 'disabled' || this.startupTimer || this.disposed) return
    this.startupTimer = setTimeout(() => { void this.check() }, 10_000)
    this.interval = setInterval(() => { void this.check() }, 6 * 60 * 60 * 1000)
    this.startupTimer.unref?.()
    this.interval.unref?.()
  }

  async check(): Promise<AppUpdateState> {
    if (this.disposed || ['disabled', 'downloading', 'ready', 'installing'].includes(this.state.phase)) return this.snapshot()
    if (this.pendingCheck) return this.pendingCheck
    this.change({ phase: 'checking', availableVersion: null, progress: null, message: null })
    this.pendingCheck = (async () => {
      try {
        const result = await this.backend.checkForUpdates()
        // The download continues after the update check has returned.
        void result?.downloadPromise?.catch(() => this.failed())
        if (this.state.phase === 'checking') this.change({ phase: 'up-to-date' })
      } catch { this.failed() }
      return this.snapshot()
    })()
    try { return await this.pendingCheck } finally { this.pendingCheck = null }
  }

  async install(): Promise<AppUpdateState> {
    if (this.state.phase !== 'ready') throw new Error('An update must finish downloading before you can install it.')
    this.change({ phase: 'installing', message: null })
    try {
      await this.beforeInstall()
      this.backend.quitAndInstall(true, true)
    } catch (error) {
      this.change({ phase: 'ready', message: 'The update could not be installed. Your progress is kept. Please try again.' })
      throw error
    }
    return this.snapshot()
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.startupTimer)
    clearInterval(this.interval)
    this.listeners.forEach((remove) => remove())
    this.listeners = []
  }

  private change(patch: Partial<AppUpdateState>): void {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    this.publish(this.snapshot())
  }

  private failed(): void {
    const message = this.state.phase === 'installing'
      ? 'The update could not be installed. Your progress is kept. Please try again.'
      : this.state.availableVersion
        ? 'The update could not be downloaded. Check your internet connection and try again.'
        : 'Updates could not be checked. Check your internet connection and try again.'
    this.change({ phase: 'error', progress: null, message })
  }
}
