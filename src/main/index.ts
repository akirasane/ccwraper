import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import {
  IpcChannels,
  PermissionModeSchema,
  PermissionReplySchema,
  SessionSendSchema,
  SessionStartSchema
} from '../shared/ipc'
import type { SessionEventPayload } from '../shared/ipc'
import { SessionManager } from './services/session-manager'

let win: BrowserWindow | null = null

const manager = new SessionManager((localId, event) => {
  const payload: SessionEventPayload = { localId, event }
  win?.webContents.send(IpcChannels.sessionEvent, payload)
})

function registerIpc(): void {
  ipcMain.handle(IpcChannels.sessionStart, (_e, raw: unknown) => manager.start(SessionStartSchema.parse(raw)))
  ipcMain.handle(IpcChannels.sessionSend, (_e, raw: unknown) => {
    const a = SessionSendSchema.parse(raw)
    manager.send(a.localId, a.text)
  })
  ipcMain.handle(IpcChannels.sessionInterrupt, (_e, id: unknown) => manager.interrupt(String(id)))
  ipcMain.handle(IpcChannels.sessionClose, (_e, id: unknown) => manager.close(String(id)))
  ipcMain.handle(IpcChannels.sessionSetModel, (_e, id: unknown, model: unknown) =>
    manager.setModel(String(id), String(model))
  )
  ipcMain.handle(IpcChannels.sessionSetPermissionMode, (_e, id: unknown, mode: unknown) =>
    manager.setPermissionMode(String(id), PermissionModeSchema.parse(mode))
  )
  ipcMain.handle(IpcChannels.sessionPermissionReply, (_e, raw: unknown) =>
    manager.permissionReply(PermissionReplySchema.parse(raw))
  )
  ipcMain.handle(IpcChannels.pickDirectory, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 780,
    backgroundColor: '#0A0A0C',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) void win.loadURL(url)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

void app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => manager.closeAll())
app.on('window-all-closed', () => {
  manager.closeAll()
  if (process.platform !== 'darwin') app.quit()
})
