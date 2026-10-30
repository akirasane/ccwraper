import { ipcMain } from 'electron'
import { IpcChannels, UsageQuerySchema } from '../../shared/ipc'
import type { UsageSummary } from '../../shared/usage'
import type { UsageService } from '../services/usage-service'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export function registerUsageIpc(usage: Pick<UsageService, 'summary'>): Disposer {
  ipcMain.handle(
    IpcChannels.usageSummary,
    (_e, raw: unknown): Promise<UsageSummary> => usage.summary(UsageQuerySchema.parse(raw))
  )
  return removeHandlers(IpcChannels.usageSummary)
}
