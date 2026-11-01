import type { SessionManager } from '../services/session-manager'
import { registerAutoResumeIpc } from './autoresume'
import { registerAppIpc } from './app'
import type { AppIpcDeps } from './app'
import { registerConfigIpc } from './config'
import { combineDisposers } from './dispose'
import type { Disposer } from './dispose'
import type { PluginRegistry } from '../services/plugin-registry'
import { registerGitIpc } from './git'
import { registerFilesIpc } from './files'
import { registerHistoryIpc } from './history'
import { registerItemsIpc } from './items'
import { registerMcpIpc } from './mcp'
import { registerPrefsIpc } from './prefs'
import type { PrefsIpcDeps } from './prefs'
import { registerPtyIpc } from './pty'
import { registerSessionIpc } from './session'
import { registerCavemanIpc, registerLimitsIpc } from './statusbar'
import type { CavemanIpcDeps, LimitsIpcDeps } from './statusbar'
import { registerUpdateIpc } from './update'
import type { UpdateIpcDeps } from './update'
import { registerUsageIpc } from './usage'
import type { GitService } from '../services/git-service'
import type { UsageService } from '../services/usage-service'

/** Send a main -> renderer event to the main window. */
export type SendToRenderer = (channel: string, payload: unknown) => void

export interface IpcDeps {
  manager: SessionManager
  send: SendToRenderer
  /** One registry for the app run; the same instance is given to SessionManager (feeds it on init). */
  registry: PluginRegistry
  // ---- P4 ----
  auth: AppIpcDeps['auth']
  setActiveSession: AppIpcDeps['setActiveSession']
  prefs: PrefsIpcDeps['prefs']
  hotkey: PrefsIpcDeps['hotkey']
  usage: Pick<UsageService, 'summary'>
  git: Pick<GitService, 'status' | 'diff' | 'log'>
  files?: Parameters<typeof registerFilesIpc>[0]
  /** Auto-update service (optional so older callers keep working). */
  update?: UpdateIpcDeps
  /** Status bar sources (optional so older callers keep working). */
  limits?: LimitsIpcDeps
  caveman?: CavemanIpcDeps
  /** WP14 sink for renderer auto-resume reports (optional so older callers keep working). */
  autoResume?: Parameters<typeof registerAutoResumeIpc>[0]
}

/** Registers every IPC handler. Returns one disposer that index.ts calls on quit. */
export function registerIpc(deps: IpcDeps): Disposer {
  return combineDisposers(
    registerSessionIpc(deps.manager),
    registerHistoryIpc(),
    registerAppIpc({ auth: deps.auth, setActiveSession: deps.setActiveSession }),
    registerPrefsIpc({ prefs: deps.prefs, hotkey: deps.hotkey, send: deps.send }),
    registerUsageIpc(deps.usage),
    registerGitIpc(deps.git),
    deps.files ? registerFilesIpc(deps.files) : () => {},
    deps.autoResume ? registerAutoResumeIpc(deps.autoResume) : () => {},
    deps.update ? registerUpdateIpc(deps.update) : () => {},
    deps.limits ? registerLimitsIpc(deps.limits) : () => {},
    deps.caveman ? registerCavemanIpc(deps.caveman) : () => {},
    registerConfigIpc({ send: deps.send, registry: deps.registry }),
    registerItemsIpc({ send: deps.send, registry: deps.registry }),
    registerMcpIpc(),
    registerPtyIpc({ send: deps.send })
  )
}
