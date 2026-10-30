import type { SessionManager } from '../services/session-manager'
import { registerAppIpc } from './app'
import { registerConfigIpc } from './config'
import { combineDisposers } from './dispose'
import type { Disposer } from './dispose'
import { registerHistoryIpc } from './history'
import { registerMcpIpc } from './mcp'
import { registerPtyIpc } from './pty'
import { registerSessionIpc } from './session'

/** Send a main -> renderer event to the main window. */
export type SendToRenderer = (channel: string, payload: unknown) => void

export interface IpcDeps {
  manager: SessionManager
  send: SendToRenderer
}

/** Registers every IPC handler. Returns one disposer that index.ts calls on quit. */
export function registerIpc(deps: IpcDeps): Disposer {
  return combineDisposers(
    registerSessionIpc(deps.manager),
    registerHistoryIpc(),
    registerAppIpc(),
    registerConfigIpc({ send: deps.send }),
    registerMcpIpc(),
    registerPtyIpc({ send: deps.send })
  )
}
