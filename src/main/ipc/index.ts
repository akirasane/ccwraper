import type { SessionManager } from '../services/session-manager'
import { registerAppIpc } from './app'
import { registerConfigIpc } from './config'
import { combineDisposers } from './dispose'
import type { Disposer } from './dispose'
import type { PluginRegistry } from '../services/plugin-registry'
import { registerHistoryIpc } from './history'
import { registerItemsIpc } from './items'
import { registerMcpIpc } from './mcp'
import { registerPtyIpc } from './pty'
import { registerSessionIpc } from './session'

/** Send a main -> renderer event to the main window. */
export type SendToRenderer = (channel: string, payload: unknown) => void

export interface IpcDeps {
  manager: SessionManager
  send: SendToRenderer
  /** One registry for the app run; the same instance is given to SessionManager (feeds it on init). */
  registry: PluginRegistry
}

/** Registers every IPC handler. Returns one disposer that index.ts calls on quit. */
export function registerIpc(deps: IpcDeps): Disposer {
  return combineDisposers(
    registerSessionIpc(deps.manager),
    registerHistoryIpc(),
    registerAppIpc(),
    registerConfigIpc({ send: deps.send, registry: deps.registry }),
    registerItemsIpc({ send: deps.send, registry: deps.registry }),
    registerMcpIpc(),
    registerPtyIpc({ send: deps.send })
  )
}
