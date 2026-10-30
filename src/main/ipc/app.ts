import { app, ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type { AppInfo } from '../../shared/events'
import { readSdkVersions, resolveClaudeBinary, trashDir } from '../paths'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export function getAppInfo(): AppInfo {
  const bin = resolveClaudeBinary()
  return {
    ...(bin.path ? { claudePath: bin.path } : {}),
    ...(bin.version ? { claudeVersion: bin.version } : {}),
    claudeSource: bin.source,
    sdkVersion: readSdkVersions().sdk ?? 'unknown',
    platform: process.platform,
    trashDir: trashDir(app.getPath('userData'))
  }
}

export function registerAppIpc(): Disposer {
  ipcMain.handle(IpcChannels.appInfo, async (): Promise<AppInfo> => getAppInfo())
  return removeHandlers(IpcChannels.appInfo)
}
