import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type { AppInfo } from '../../shared/events'
import { readSdkVersions, resolveClaudeBinary } from '../paths'

export function getAppInfo(): AppInfo {
  const bin = resolveClaudeBinary()
  return {
    ...(bin.path ? { claudePath: bin.path } : {}),
    ...(bin.version ? { claudeVersion: bin.version } : {}),
    claudeSource: bin.source,
    sdkVersion: readSdkVersions().sdk ?? 'unknown',
    platform: process.platform
  }
}

export function registerAppIpc(): void {
  ipcMain.handle(IpcChannels.appInfo, async (): Promise<AppInfo> => getAppInfo())
}
