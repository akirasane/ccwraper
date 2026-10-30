import { dialog } from 'electron'
import type { BrowserWindow, MessageBoxOptions } from 'electron'
import type { AppPrefs } from '../../shared/app'
import type { Disposer } from '../ipc/dispose'

// D11: on window close, when sessions are busy and `confirmQuitWhileRunning`, ask first (Cancel default).

export interface QuitGuardDeps {
  /** SessionManager.busyCount */
  busyCount: () => number
  prefs: { get(): AppPrefs }
  /** Injectable for tests; resolves to the clicked button index. */
  showDialog?: (win: BrowserWindow, opts: MessageBoxOptions) => Promise<{ response: number }>
}

export function installQuitGuard(win: BrowserWindow, deps: QuitGuardDeps): Disposer {
  const show = deps.showDialog ?? ((w, o) => dialog.showMessageBox(w, o))
  let confirmed = false
  let asking = false
  const onClose = (e: { preventDefault(): void }): void => {
    if (confirmed) return
    const n = deps.busyCount()
    if (n <= 0 || !deps.prefs.get().confirmQuitWhileRunning) return
    e.preventDefault()
    if (asking) return
    asking = true
    const message = n === 1 ? '1 session is still working. Quit and stop it?' : `${n} sessions are still working. Quit and stop them?`
    void show(win, {
      type: 'warning',
      buttons: ['Quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'ccwraper',
      message,
      noLink: true
    })
      .then(({ response }) => {
        if (response === 0 && !win.isDestroyed()) {
          confirmed = true
          win.close()
        }
      })
      .catch(() => {})
      .finally(() => {
        asking = false
      })
  }
  win.on('close', onClose)
  return () => {
    if (!win.isDestroyed()) win.removeListener('close', onClose)
  }
}
