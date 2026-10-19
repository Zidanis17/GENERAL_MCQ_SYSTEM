import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, StudioAPI } from '../shared/model'
import type { AppUpdateState } from '../shared/updates'

const api: StudioAPI = {
  load: () => ipcRenderer.invoke('studio:load'),
  chooseBanks: () => ipcRenderer.invoke('studio:chooseBanks'),
  parseBank: (raw) => ipcRenderer.invoke('studio:parseBank', raw),
  saveBank: (bank, replace) => ipcRenderer.invoke('studio:saveBank', bank, replace),
  removeBank: (id) => ipcRenderer.invoke('studio:removeBank', id),
  start: (config) => ipcRenderer.invoke('studio:start', config),
  answer: (id, option) => ipcRenderer.invoke('studio:answer', id, option),
  check: (id) => ipcRenderer.invoke('studio:check', id),
  navigate: (index) => ipcRenderer.invoke('studio:navigate', index),
  submit: () => ipcRenderer.invoke('studio:submit'),
  discard: () => ipcRenderer.invoke('studio:discard'),
  exportExample: () => ipcRenderer.invoke('studio:exportExample'),
  getUpdateState: () => ipcRenderer.invoke('studio:getUpdateState'),
  checkForUpdates: () => ipcRenderer.invoke('studio:checkForUpdates'),
  installUpdate: () => ipcRenderer.invoke('studio:installUpdate'),
  onUpdateState: (callback) => {
    const listener = (_event: unknown, state: AppUpdateState) => callback(state)
    ipcRenderer.on('studio:update', listener)
    return () => { ipcRenderer.removeListener('studio:update', listener) }
  },
  onState: (callback) => {
    const listener = (_event: unknown, state: AppState) => callback(state)
    ipcRenderer.on('studio:state', listener)
    return () => { ipcRenderer.removeListener('studio:state', listener) }
  },
  onError: (callback) => {
    const listener = (_event: unknown, message: string) => callback(message)
    ipcRenderer.on('studio:error', listener)
    return () => { ipcRenderer.removeListener('studio:error', listener) }
  }
}
contextBridge.exposeInMainWorld('studio', api)
