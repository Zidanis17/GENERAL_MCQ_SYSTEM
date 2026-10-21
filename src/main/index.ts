import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, session } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { bankSchema, formatValidation, parseBank, startSchema, type Result } from '../shared/model'
import { readBankFiles } from './import-banks'
import example from '../../examples/general-knowledge.json'
import { StateStore } from './store'
import electronUpdater from 'electron-updater'
import { UpdateController } from './updates'
import { updateDisabledReason } from '../shared/updates'

const here = dirname(fileURLToPath(import.meta.url))
const rendererRoot = resolve(here, '../renderer')
const devURL = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
app.setName('MCQ Studio')
app.setAppUserModelId('com.mcqstudio.desktop')
app.setPath('userData', process.env.MCQ_STUDIO_DATA_DIR || join(app.getPath('appData'), app.isPackaged ? 'MCQ Studio' : 'MCQ Studio Development'))
let window: BrowserWindow | null = null
let store: StateStore
let updates: UpdateController
let timer: ReturnType<typeof setInterval> | undefined
let quitting = false

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus() })
  app.whenReady().then(async () => {
    store = new StateStore(app.getPath('userData'))
    await store.initialize()
    nativeTheme.themeSource = store.snapshot().settings.theme
    await store.expireIfNeeded()
    updates = new UpdateController(
      electronUpdater.autoUpdater,
      app.getVersion(),
      updateDisabledReason(app.isPackaged, Boolean(process.env.PORTABLE_EXECUTABLE_DIR), existsSync(join(process.resourcesPath, 'app-update.yml'))),
      (state) => { if (window && !window.isDestroyed()) window.webContents.send('studio:update', state) },
      () => store.flush()
    )
    protocol.handle('app', async (request) => {
      const url = new URL(request.url)
      if (url.hostname !== 'bundle') return new Response('Not found', { status: 404 })
      let path: string
      try { path = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`) } catch { return new Response('Invalid path', { status: 400 }) }
      const rel = relative(rendererRoot, path)
      if (rel.startsWith('..') || isAbsolute(rel)) return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(path).toString())
    })
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    if (app.isPackaged) session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }))
    registerHandlers()
    createWindow()
    updates.start()
    timer = setInterval(async () => {
      const deadline = store.activeDeadline
      if (deadline !== null && deadline <= Date.now()) {
        try { window?.webContents.send('studio:state', await store.expireIfNeeded()) }
        catch { window?.webContents.send('studio:error', 'Progress could not be saved. Check that your disk has free space, then try again.') }
      }
    }, 1000)
  }).catch((error: unknown) => {
    dialog.showErrorBox('MCQ Studio could not start', error instanceof Error ? error.message : String(error))
    app.quit()
  })
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1200, height: 840, minWidth: 880, minHeight: 640,
    title: 'MCQ Studio', backgroundColor: nativeTheme.shouldUseDarkColors ? '#111824' : '#f7f8fa', autoHideMenuBar: true,
    icon: join(here, '../../build/icon.png'),
    webPreferences: { preload: join(here, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false }
  })
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  if (devURL) void window.loadURL(devURL)
  else void window.loadURL('app://bundle/index.html')
  window.on('closed', () => { window = null })
}

nativeTheme.on('updated', () => { window?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#111824' : '#f7f8fa') })

function handle(channel: string, operation: (...args: any[]) => unknown): void {
  ipcMain.handle(`studio:${channel}`, async (event, ...args): Promise<Result<unknown>> => {
    try {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Access denied.')
      const url = new URL(event.senderFrame.url)
      if (devURL ? url.origin !== new URL(devURL).origin : url.protocol !== 'app:' || url.hostname !== 'bundle') throw new Error('Access denied.')
      return { ok: true, value: await operation(...args) }
    } catch (error) {
      const message = error instanceof z.ZodError ? formatValidation(error) : error instanceof Error ? error.message : 'Something went wrong. Please try again.'
      return { ok: false, error: message }
    }
  })
}

function registerHandlers(): void {
  handle('getUpdateState', () => updates.snapshot())
  handle('checkForUpdates', () => updates.check())
  handle('installUpdate', () => updates.install())
  handle('load', async () => ({ state: await store.expireIfNeeded(), notice: store.notice }))
  handle('chooseBanks', async () => {
    const result = await dialog.showOpenDialog(window!, { title: 'Import question banks', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Question banks (JSON)', extensions: ['json'] }] })
    if (result.canceled || result.filePaths.length === 0) return null
    return readBankFiles(result.filePaths)
  })
  handle('parseBank', (raw) => parseBank(z.string().parse(raw)))
  handle('saveBank', (bank, replace) => store.saveBank(bankSchema.parse(bank), z.boolean().parse(replace)))
  handle('removeBank', (id) => store.removeBank(z.string().min(1).parse(id)))
  handle('updateSettings', async (settings) => {
    const state = await store.updateSettings(settings)
    nativeTheme.themeSource = state.settings.theme
    return state
  })
  handle('saveMix', (mix) => store.saveMix(mix))
  handle('removeMix', (id) => store.removeMix(z.string().min(1).parse(id)))
  handle('start', (config) => store.start(startSchema.parse(config)))
  handle('answer', (id, option) => store.answer(z.string().parse(id), z.string().parse(option)))
  handle('check', (id) => store.check(z.string().parse(id)))
  handle('navigate', (index) => store.navigate(z.number().int().parse(index)))
  handle('submit', () => store.submit())
  handle('discard', () => store.discard())
  handle('exportExample', async () => {
    const result = await dialog.showSaveDialog(window!, { title: 'Save example question bank', defaultPath: 'mcq-studio-example.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return false
    await fs.writeFile(result.filePath, JSON.stringify(example, null, 2), 'utf8')
    return true
  })
}

app.on('window-all-closed', () => app.quit())
app.on('before-quit', (event) => {
  if (quitting || !store) return
  event.preventDefault()
  quitting = true
  updates?.dispose()
  if (timer) clearInterval(timer)
  void store.flush().finally(() => app.quit())
})
