import { ipcMain } from 'electron'
import { HistoryListSchema, HistoryLoadSchema, IpcChannels } from '../../shared/ipc'
import type { HistorySessionInfo, ProjectInfo, SessionEvent } from '../../shared/events'

/** STUB (WP0): returns empty results. WP2 replaces the bodies with the real HistoryService. */
export function registerHistoryIpc(): void {
  ipcMain.handle(IpcChannels.historyListProjects, async (): Promise<ProjectInfo[]> => [])
  ipcMain.handle(IpcChannels.historyList, async (_e, raw: unknown): Promise<HistorySessionInfo[]> => {
    HistoryListSchema.parse(raw)
    return []
  })
  ipcMain.handle(IpcChannels.historyLoad, async (_e, raw: unknown): Promise<SessionEvent[]> => {
    HistoryLoadSchema.parse(raw)
    return []
  })
}
