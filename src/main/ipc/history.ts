import { ipcMain } from 'electron'
import { HistoryListSchema, HistoryLoadSchema, IpcChannels } from '../../shared/ipc'
import type { HistorySessionInfo, ProjectInfo, SessionEvent } from '../../shared/events'
import { HistoryService } from '../services/history-service'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export function registerHistoryIpc(service: HistoryService = new HistoryService()): Disposer {
  ipcMain.handle(IpcChannels.historyListProjects, (): Promise<ProjectInfo[]> => service.listProjects())
  ipcMain.handle(IpcChannels.historyList, (_e, raw: unknown): Promise<HistorySessionInfo[]> => {
    return service.list(HistoryListSchema.parse(raw).cwd)
  })
  ipcMain.handle(IpcChannels.historyLoad, (_e, raw: unknown): Promise<SessionEvent[]> => {
    const a = HistoryLoadSchema.parse(raw)
    return service.load(a.sessionId, a.cwd)
  })
  return removeHandlers(IpcChannels.historyListProjects, IpcChannels.historyList, IpcChannels.historyLoad)
}
