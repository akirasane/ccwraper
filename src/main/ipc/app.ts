import { app, ipcMain } from 'electron'
import { AuthStatusArgsSchema, IpcChannels, SetActiveSessionSchema } from '../../shared/ipc'
import type { AuthStatus } from '../../shared/app'
import type { AppInfo } from '../../shared/events'
import { readSdkVersions, resolveClaudeBinary, trashDir } from '../paths'
import type { AuthStatusService } from '../services/auth-status'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export function getAppInfo(): AppInfo {
  const bin = resolveClaudeBinary()
  const userData = app.getPath('userData')
  return {
    ...(bin.path ? { claudePath: bin.path } : {}),
    ...(bin.version ? { claudeVersion: bin.version } : {}),
    claudeSource: bin.source,
    sdkVersion: readSdkVersions().sdk ?? 'unknown',
    platform: process.platform,
    trashDir: trashDir(userData),
    version: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
    packaged: app.isPackaged,
    userDataDir: userData
  }
}

export interface AppIpcDeps {
  auth: Pick<AuthStatusService, 'get'>
  /** app:setActiveSession sink (notifications). */
  setActiveSession: (localId: string | null) => void
}

export function registerAppIpc(deps: AppIpcDeps): Disposer {
  ipcMain.handle(IpcChannels.appInfo, async (): Promise<AppInfo> => getAppInfo())
  ipcMain.handle(
    IpcChannels.appAuthStatus,
    (_e, raw: unknown): Promise<AuthStatus> => deps.auth.get(AuthStatusArgsSchema.parse(raw ?? {}).refresh)
  )
  const onActive = (_e: unknown, raw: unknown): void => {
    const parsed = SetActiveSessionSchema.safeParse(raw)
    if (parsed.success) deps.setActiveSession(parsed.data.localId)
  }
  ipcMain.on(IpcChannels.appSetActiveSession, onActive)
  const off = removeHandlers(IpcChannels.appInfo, IpcChannels.appAuthStatus)
  return () => {
    off()
    ipcMain.removeListener(IpcChannels.appSetActiveSession, onActive)
  }
}
