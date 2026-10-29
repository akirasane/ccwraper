import type { SessionManager } from '../services/session-manager'
import { registerAppIpc } from './app'
import { registerHistoryIpc } from './history'
import { registerSessionIpc } from './session'

export interface IpcDeps {
  manager: SessionManager
}

export function registerIpc(deps: IpcDeps): void {
  registerSessionIpc(deps.manager)
  registerHistoryIpc()
  registerAppIpc()
}
