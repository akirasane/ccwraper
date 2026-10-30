import { ipcMain } from 'electron'
import { ConfigReadSchema, ConfigWatchProjectSchema, ConfigWriteSchema, IpcChannels, SettingsResolveSchema } from '../../shared/ipc'
import type { ConfigSnapshot, ConfigWriteResult, ResolvedSettingsView } from '../../shared/config'
import { memoryFilePath, settingsFilePath } from '../paths'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export interface ConfigIpcDeps {
  send: (channel: string, payload: unknown) => void
}

// STUB (WP0). WP1 replaces this with the real ConfigService / watcher / settings resolver.
export function registerConfigIpc(_deps: ConfigIpcDeps): Disposer {
  ipcMain.handle(IpcChannels.configRead, (_e, raw: unknown): ConfigSnapshot => {
    const { ref } = ConfigReadSchema.parse(raw)
    const path = ref.kind === 'settings' ? settingsFilePath(ref.scope, ref.cwd) : memoryFilePath(ref.scope, ref.cwd)
    return { ref, path, exists: false, text: '', hash: null }
  })
  ipcMain.handle(IpcChannels.configWrite, (_e, raw: unknown): ConfigWriteResult => {
    ConfigWriteSchema.parse(raw)
    return { ok: false, code: 'io', message: 'not implemented' }
  })
  ipcMain.handle(IpcChannels.configWatchProject, (_e, raw: unknown): void => {
    ConfigWatchProjectSchema.parse(raw)
  })
  ipcMain.handle(IpcChannels.settingsResolve, (_e, raw: unknown): ResolvedSettingsView => {
    const a = SettingsResolveSchema.parse(raw)
    return { ...(a.cwd ? { cwd: a.cwd } : {}), effective: {}, provenance: {}, sources: [], error: 'not implemented' }
  })
  return removeHandlers(
    IpcChannels.configRead,
    IpcChannels.configWrite,
    IpcChannels.configWatchProject,
    IpcChannels.settingsResolve
  )
}
