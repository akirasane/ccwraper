import { ipcMain } from 'electron'
import { IpcChannels, PluginsBrowseSchema, PluginsListSchema, PluginsMutateSchema } from '../../shared/ipc'
import type { PluginService } from '../services/plugin-service'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export function registerPluginsIpc(service: Pick<PluginService, 'list' | 'browse' | 'mutate'>): Disposer {
  ipcMain.handle(IpcChannels.pluginsList, (_e, raw: unknown) => service.list(PluginsListSchema.parse(raw ?? {}).cwd))
  ipcMain.handle(IpcChannels.pluginsBrowse, (_e, raw: unknown) => service.browse(PluginsBrowseSchema.parse(raw)))
  ipcMain.handle(IpcChannels.pluginsMutate, (_e, raw: unknown) => {
    const a = PluginsMutateSchema.parse(raw)
    return service.mutate(a.action, a.cwd)
  })
  return removeHandlers(IpcChannels.pluginsList, IpcChannels.pluginsBrowse, IpcChannels.pluginsMutate)
}
