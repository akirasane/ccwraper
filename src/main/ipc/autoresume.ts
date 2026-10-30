import { ipcMain } from 'electron'
import { AutoResumeReportSchema, IpcChannels } from '../../shared/ipc'
import type { AutoResumeReport } from '../../shared/app'
import type { Disposer } from './dispose'

export interface AutoResumeIpcDeps {
  report: (r: AutoResumeReport) => void
}

/** Fire-and-forget from the renderer; malformed payloads are dropped. */
export function registerAutoResumeIpc(deps: AutoResumeIpcDeps): Disposer {
  const onReport = (_e: unknown, raw: unknown): void => {
    const parsed = AutoResumeReportSchema.safeParse(raw)
    if (parsed.success) deps.report(parsed.data as AutoResumeReport)
  }
  ipcMain.on(IpcChannels.autoResumeReport, onReport)
  return () => {
    ipcMain.removeListener(IpcChannels.autoResumeReport, onReport)
  }
}
