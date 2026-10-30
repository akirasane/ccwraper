import { ipcMain } from 'electron'
import type { AppPrefs, HotkeyStatus, PrefsSetResult } from '../../shared/app'
import { AppPrefsPatchSchema, IpcChannels } from '../../shared/ipc'
import type { AppPrefsPatch } from '../../shared/app'
import type { PrefsService } from '../services/prefs-service'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export interface PrefsIpcDeps {
  prefs: Pick<PrefsService, 'get' | 'set' | 'onChange'>
  /** Registration result of the global hotkey (the prefs.onChange listener in index.ts applies it first). */
  hotkey: { status(): HotkeyStatus }
  send: (channel: string, payload: unknown) => void
}

export function registerPrefsIpc(deps: PrefsIpcDeps): Disposer {
  ipcMain.handle(IpcChannels.prefsGet, (): AppPrefs => deps.prefs.get())
  ipcMain.handle(IpcChannels.prefsSet, async (_e, raw: unknown): Promise<PrefsSetResult> => {
    const patch = AppPrefsPatchSchema.parse(raw) as AppPrefsPatch
    const prefs = await deps.prefs.set(patch)
    return { prefs, hotkey: deps.hotkey.status() }
  })
  const off = deps.prefs.onChange((p) => deps.send(IpcChannels.prefsChanged, p))
  const rm = removeHandlers(IpcChannels.prefsGet, IpcChannels.prefsSet)
  return () => {
    off()
    rm()
  }
}
