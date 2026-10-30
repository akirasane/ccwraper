import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { IpcChannels } from '../shared/ipc'
import type { SessionEventPayload } from '../shared/ipc'
import { registerIpc } from './ipc'
import type { Disposer } from './ipc/dispose'
import { PluginRegistry } from './services/plugin-registry'
import { SessionManager } from './services/session-manager'

let win: BrowserWindow | null = null
let disposeIpc: Disposer | null = null

function isHttpUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol
    return p === 'http:' || p === 'https:'
  } catch {
    return false
  }
}

const pluginRegistry = new PluginRegistry()
const manager = new SessionManager(
  (localId, event) => {
    const payload: SessionEventPayload = { localId, event }
    win?.webContents.send(IpcChannels.sessionEvent, payload)
  },
  { registry: pluginRegistry }
)

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0A0A0C',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0A0A0C', symbolColor: '#9A9AA8', height: 40 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  // Never open in-app windows; hand http(s) links to the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Block in-place navigation away from the app (e.g. a clicked link without target).
  win.webContents.on('will-navigate', (e, url) => {
    const appUrl = process.env['ELECTRON_RENDERER_URL']
    if (appUrl && url.startsWith(appUrl)) return
    if (url.startsWith('file://')) return
    e.preventDefault()
    if (isHttpUrl(url)) void shell.openExternal(url)
  })
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url) void win.loadURL(url)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

void app.whenReady().then(() => {
  disposeIpc = registerIpc({
    manager,
    registry: pluginRegistry,
    send: (channel, payload) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    }
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

function shutdown(): void {
  manager.closeAll()
  disposeIpc?.()
  disposeIpc = null
}

app.on('before-quit', shutdown)
app.on('window-all-closed', () => {
  shutdown()
  if (process.platform !== 'darwin') app.quit()
})
