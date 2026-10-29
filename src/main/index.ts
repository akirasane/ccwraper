import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { IpcChannels } from '../shared/ipc'
import type { SessionEventPayload } from '../shared/ipc'
import { registerIpc } from './ipc'
import { SessionManager } from './services/session-manager'

let win: BrowserWindow | null = null

const manager = new SessionManager((localId, event) => {
  const payload: SessionEventPayload = { localId, event }
  win?.webContents.send(IpcChannels.sessionEvent, payload)
})

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
  registerIpc({ manager })
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
