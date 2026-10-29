import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type { AppInfo } from '../../shared/events'

/** STUB (WP0): minimal AppInfo. WP1 fills in the real binary/version resolution. */
export function registerAppIpc(): void {
  ipcMain.handle(
    IpcChannels.appInfo,
    async (): Promise<AppInfo> => ({ claudeSource: 'bundled', sdkVersion: 'unknown', platform: process.platform })
  )
}
