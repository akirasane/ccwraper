import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { ConfigReadSchema, ConfigWatchProjectSchema, ConfigWriteSchema, IpcChannels, SettingsResolveSchema } from '../../shared/ipc'
import type { ConfigSnapshot, ConfigWriteResult, FsChangedPayload, ResolvedSettingsView } from '../../shared/config'
import { createConfigPaths } from '../paths'
import type { ConfigPaths } from '../paths'
import { ConfigService } from '../services/config-service'
import { ConfigWatcher } from '../services/config-watcher'
import type { PluginRegistry } from '../services/plugin-registry'
import { resolveSettingsView } from '../services/sdk-settings'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export interface ConfigIpcDeps {
  send: (channel: string, payload: unknown) => void
  /** Test seams; defaults use the real config locations and userData/backups. */
  paths?: ConfigPaths
  backupDir?: string
  /** Plugin dirs reported by session init (WP4 uses it to resolve plugin item refs). */
  registry?: PluginRegistry
}

/** The ConfigService of the running app, so items:* shares its backups and own-write tracking with config:*. */
let shared: { service: ConfigService; paths: ConfigPaths } | undefined
export function sharedConfig(): { service: ConfigService; paths: ConfigPaths } | undefined {
  return shared
}

export function registerConfigIpc(deps: ConfigIpcDeps): Disposer {
  const paths = deps.paths ?? createConfigPaths()
  const service = new ConfigService(paths, deps.backupDir ?? join(app.getPath('userData'), 'backups'), {
    ...(deps.registry ? { registry: deps.registry } : {})
  })
  shared = { service, paths }
  const watcher = new ConfigWatcher(paths, service, (p: FsChangedPayload) => deps.send(IpcChannels.fsChanged, p))
  watcher.start().catch((err) => console.warn('[ccwrap] config watcher failed to start', err instanceof Error ? err.message : err))

  ipcMain.handle(IpcChannels.configRead, (_e, raw: unknown): Promise<ConfigSnapshot> => {
    const { ref } = ConfigReadSchema.parse(raw)
    return service.read(ref)
  })
  ipcMain.handle(IpcChannels.configWrite, (_e, raw: unknown): Promise<ConfigWriteResult> => {
    const { ref, text, baseHash } = ConfigWriteSchema.parse(raw)
    return service.write(ref, text, baseHash)
  })
  ipcMain.handle(IpcChannels.configWatchProject, async (_e, raw: unknown): Promise<void> => {
    const { cwd } = ConfigWatchProjectSchema.parse(raw)
    await watcher.setProject(cwd)
  })
  ipcMain.handle(IpcChannels.settingsResolve, (_e, raw: unknown): Promise<ResolvedSettingsView> => {
    const a = SettingsResolveSchema.parse(raw)
    return resolveSettingsView(a.cwd)
  })

  const remove = removeHandlers(
    IpcChannels.configRead,
    IpcChannels.configWrite,
    IpcChannels.configWatchProject,
    IpcChannels.settingsResolve
  )
  return () => {
    if (shared?.service === service) shared = undefined
    remove()
    void watcher.close()
  }
}
