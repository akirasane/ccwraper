import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import type { ConfigItemList, ItemMutationResult } from '../../shared/config'
import { IpcChannels, ItemsCreateSchema, ItemsDeleteSchema, ItemsListSchema, ItemsRenameSchema } from '../../shared/ipc'
import { createConfigPaths, trashDir } from '../paths'
import type { ConfigPaths } from '../paths'
import { ConfigService } from '../services/config-service'
import { ItemsService } from '../services/items-service'
import type { PluginRegistry } from '../services/plugin-registry'
import { Trash } from '../services/trash'
import { sharedConfig } from './config'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export interface ItemsIpcDeps {
  send: (channel: string, payload: unknown) => void
  registry: PluginRegistry
  /** Test seam: a ready service. */
  service?: ItemsService
  /** Test seams for the defaults. */
  paths?: ConfigPaths
  trashRoot?: string
  backupDir?: string
}

export function registerItemsIpc(deps: ItemsIpcDeps): Disposer {
  let service = deps.service
  // Built on first use so registration order against registerConfigIpc does not matter.
  const get = (): ItemsService => {
    if (service) return service
    const cfg = sharedConfig()
    const paths = deps.paths ?? cfg?.paths ?? createConfigPaths()
    const config =
      cfg?.service ?? new ConfigService(paths, deps.backupDir ?? join(app.getPath('userData'), 'backups'), { registry: deps.registry })
    return (service = new ItemsService(paths, deps.registry, config, new Trash(deps.trashRoot ?? trashDir(app.getPath('userData')))))
  }

  ipcMain.handle(IpcChannels.itemsList, (_e, raw: unknown): Promise<ConfigItemList> => {
    const a = ItemsListSchema.parse(raw)
    return get().list(a.kind, a.cwd)
  })
  ipcMain.handle(IpcChannels.itemsCreate, (_e, raw: unknown): Promise<ItemMutationResult> => {
    const a = ItemsCreateSchema.parse(raw)
    return get().create(a)
  })
  ipcMain.handle(IpcChannels.itemsRename, (_e, raw: unknown): Promise<ItemMutationResult> => {
    const a = ItemsRenameSchema.parse(raw)
    return get().rename(a)
  })
  ipcMain.handle(IpcChannels.itemsDelete, (_e, raw: unknown): Promise<ItemMutationResult> => {
    const a = ItemsDeleteSchema.parse(raw)
    return get().delete(a)
  })
  return removeHandlers(IpcChannels.itemsList, IpcChannels.itemsCreate, IpcChannels.itemsRename, IpcChannels.itemsDelete)
}
