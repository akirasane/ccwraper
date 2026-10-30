import { ipcMain } from 'electron'
import type { ConfigItemList, ItemMutationResult } from '../../shared/config'
import { IpcChannels, ItemsCreateSchema, ItemsDeleteSchema, ItemsListSchema, ItemsRenameSchema } from '../../shared/ipc'
import type { PluginRegistry } from '../services/plugin-registry'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export interface ItemsIpcDeps {
  send: (channel: string, payload: unknown) => void
  registry: PluginRegistry
}

// WP0 STUB: WP4 replaces the bodies with ItemsService calls. Channels and validation are frozen.
const notImplemented = (): ItemMutationResult => ({ ok: false, code: 'io', message: 'not implemented' })

export function registerItemsIpc(_deps: ItemsIpcDeps): Disposer {
  ipcMain.handle(
    IpcChannels.itemsList,
    async (_e, raw: unknown): Promise<ConfigItemList> => {
      const a = ItemsListSchema.parse(raw)
      return { kind: a.kind, items: [], roots: [], pluginsKnown: false }
    }
  )
  ipcMain.handle(IpcChannels.itemsCreate, async (_e, raw: unknown): Promise<ItemMutationResult> => {
    ItemsCreateSchema.parse(raw)
    return notImplemented()
  })
  ipcMain.handle(IpcChannels.itemsRename, async (_e, raw: unknown): Promise<ItemMutationResult> => {
    ItemsRenameSchema.parse(raw)
    return notImplemented()
  })
  ipcMain.handle(IpcChannels.itemsDelete, async (_e, raw: unknown): Promise<ItemMutationResult> => {
    ItemsDeleteSchema.parse(raw)
    return notImplemented()
  })
  return removeHandlers(IpcChannels.itemsList, IpcChannels.itemsCreate, IpcChannels.itemsRename, IpcChannels.itemsDelete)
}
