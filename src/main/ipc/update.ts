import { ipcMain } from 'electron'
import type { UpdateState } from '../../shared/app'
import { IpcChannels } from '../../shared/ipc'
import type { UpdateService } from '../services/update-service'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export type UpdateIpcDeps = Pick<UpdateService, 'getState' | 'check' | 'installNow'>

/** None of these channels take arguments; anything the renderer sends is ignored. */
export function registerUpdateIpc(deps: UpdateIpcDeps): Disposer {
  ipcMain.handle(IpcChannels.updateGetState, (): UpdateState => deps.getState())
  ipcMain.handle(IpcChannels.updateCheck, (): Promise<UpdateState> => deps.check())
  ipcMain.handle(IpcChannels.updateInstall, (): boolean => deps.installNow())
  return removeHandlers(IpcChannels.updateGetState, IpcChannels.updateCheck, IpcChannels.updateInstall)
}
