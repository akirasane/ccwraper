import { ipcMain } from 'electron'
import type { CavemanState, LimitsState } from '../../shared/limits'
import { IpcChannels } from '../../shared/ipc'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export interface LimitsIpcDeps {
  getState(): LimitsState
}
export interface CavemanIpcDeps {
  /** Re-reads the plugin files first so a focus/open gets a current value. */
  refresh(): Promise<CavemanState>
}

/** No channel takes arguments; anything the renderer sends is ignored. */
export function registerLimitsIpc(deps: LimitsIpcDeps): Disposer {
  ipcMain.handle(IpcChannels.limitsGet, (): LimitsState => deps.getState())
  return removeHandlers(IpcChannels.limitsGet)
}

export function registerCavemanIpc(deps: CavemanIpcDeps): Disposer {
  ipcMain.handle(IpcChannels.cavemanGet, (): Promise<CavemanState> => deps.refresh())
  return removeHandlers(IpcChannels.cavemanGet)
}
