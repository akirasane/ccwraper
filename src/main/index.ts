import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow, Menu, powerSaveBlocker, screen, shell } from 'electron'
import { join } from 'node:path'
import { IpcChannels } from '../shared/ipc'
import type { SessionEventPayload } from '../shared/ipc'
import { registerIpc } from './ipc'
import type { Disposer } from './ipc/dispose'
import { isAppNavigation } from './navigation'
import { prefsPath, transcriptsRoot, usageCachePath, usageLedgerPath, windowStatePath } from './paths'
import { AutoResumeMain } from './services/autoresume-main'
import { AuthStatusService } from './services/auth-status'
import { runClaude } from './services/claude-cli'
import { GitService } from './services/git-service'
import { HotkeyService } from './services/hotkey-service'
import { NotificationService } from './services/notification-service'
import { PluginRegistry } from './services/plugin-registry'
import { PrefsService } from './services/prefs-service'
import { installQuitGuard } from './services/quit-guard'
import { SessionManager } from './services/session-manager'
import { UpdateService } from './services/update-service'
import { UsageLedger } from './services/usage-ledger'
import { UsageService } from './services/usage-service'
import { loadWindowState, trackWindowState } from './services/window-state'

// A dev build must never share prefs, trash, ledger or localStorage with an installed app (P4 D8).
// Must run before anything reads app.getPath('userData'). An explicit --user-data-dir wins.
if (!app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), 'ccwraper-dev'))
}
// Same as the electron-builder appId, so toasts are attributed to "ccwraper" once installed.
app.setAppUserModelId('com.ccwraper.app')

const userData = app.getPath('userData')

let win: BrowserWindow | null = null
let disposeIpc: Disposer | null = null
let disposeWindow: Disposer | null = null

function isHttpUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol
    return p === 'http:' || p === 'https:'
  } catch {
    return false
  }
}

const getWindow = (): BrowserWindow | null => (win && !win.isDestroyed() ? win : null)

const prefs = new PrefsService(prefsPath(userData), {
  onCorrupt: ({ reason }) => console.warn('[ccwrap] prefs.json was unusable, using defaults:', reason)
})
const pluginRegistry = new PluginRegistry()
const usage = new UsageService({
  root: transcriptsRoot(),
  cacheFile: usageCachePath(userData),
  ledgerFile: usageLedgerPath(userData)
})
const ledger = new UsageLedger(usageLedgerPath(userData))
const git = new GitService()
const auth = new AuthStatusService(runClaude)
const hotkey = new HotkeyService({ getWindow })
const updates = new UpdateService({
  // autoUpdater is a lazy getter; it is only touched in a packaged build.
  ...(app.isPackaged ? { updater: autoUpdater } : {}),
  isPackaged: app.isPackaged,
  prefs,
  broadcast: (state) => getWindow()?.webContents.send(IpcChannels.updateState, state),
  log: (m) => console.warn('[ccwrap]', m)
})

// Session event fan-out: renderer, notifications, usage ledger.
const manager: SessionManager = new SessionManager(
  (localId, event) => {
    const payload: SessionEventPayload = { localId, event }
    getWindow()?.webContents.send(IpcChannels.sessionEvent, payload)
    notifications.onSessionEvent(localId, event)
    ledger.onSessionEvent(localId, event, manager.info(localId))
  },
  { registry: pluginRegistry, allowBypass: () => prefs.get().allowBypassMode }
)
const notifications = new NotificationService({ getWindow, prefs, manager })
const autoResume = new AutoResumeMain({ powerSave: powerSaveBlocker, announce: (r) => notifications.announce(r) })

function createWindow(): void {
  const restored = loadWindowState(
    windowStatePath(userData),
    screen.getAllDisplays().map((d) => d.workArea)
  )
  const { maximized, ...bounds } = restored
  const w = new BrowserWindow({
    width: 1280,
    height: 800,
    ...bounds,
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
  win = w
  if (maximized) w.maximize()
  w.once('ready-to-show', () => w.show())
  // Never open in-app windows; hand http(s) links to the OS browser.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const indexHtmlPath = join(__dirname, '../renderer/index.html')
  // Block in-place navigation away from the app (e.g. a clicked link without target).
  w.webContents.on('will-navigate', (e, url) => {
    if (isAppNavigation(url, { ...(devUrl ? { devUrl } : {}), indexHtmlPath })) return
    e.preventDefault()
    if (isHttpUrl(url)) void shell.openExternal(url)
  })
  w.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    if (!app.isPackaged) {
      // Dev only: DevTools without the default menu.
      if (key === 'f12' || (input.control && input.shift && key === 'i')) {
        w.webContents.toggleDevTools()
        e.preventDefault()
      }
    } else if (key === 'f5' || (input.control && key === 'r')) {
      // A reload would orphan the live main-process sessions.
      e.preventDefault()
    }
  })
  disposeWindow = combineWindowDisposers(trackWindowState(w, windowStatePath(userData)), installQuitGuard(w, { busyCount: () => manager.busyCount(), prefs }))
  w.on('closed', () => {
    disposeWindow?.()
    disposeWindow = null
    if (win === w) win = null
  })
  if (devUrl) void w.loadURL(devUrl)
  else void w.loadFile(indexHtmlPath)
}

function combineWindowDisposers(...ds: Disposer[]): Disposer {
  return () => {
    for (const d of ds) {
      try {
        d()
      } catch (err) {
        console.warn('[ccwrap] window dispose failed', err instanceof Error ? err.message : err)
      }
    }
  }
}

function focusMainWindow(): void {
  const w = getWindow()
  if (!w) return
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
}

// Without the default menu, Ctrl+W no longer closes the window and Ctrl+R no longer reloads (P4 D11).
Menu.setApplicationMenu(null)

if (!app.requestSingleInstanceLock()) {
  // A second launch hands over to the first one and exits.
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)

  void app.whenReady().then(() => {
    disposeIpc = registerIpc({
      manager,
      registry: pluginRegistry,
      send: (channel, payload) => {
        getWindow()?.webContents.send(channel, payload)
      },
      auth,
      setActiveSession: (localId) => notifications.setActive(localId),
      prefs,
      hotkey,
      usage,
      git,
      autoResume: { report: (r) => autoResume.report(r) },
      update: updates
    })
    updates.start()
    hotkey.apply(prefs.get().hotkey)
    prefs.onChange((p) => hotkey.apply(p.hotkey))
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

function shutdown(): void {
  manager.closeAll()
  disposeIpc?.()
  disposeIpc = null
}

app.on('before-quit', shutdown)
app.on('will-quit', () => {
  hotkey.dispose()
  updates.dispose()
  autoResume.dispose()
  notifications.dispose()
})
app.on('window-all-closed', () => {
  shutdown()
  if (process.platform !== 'darwin') app.quit()
})
