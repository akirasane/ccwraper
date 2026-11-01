import { ipcMain } from 'electron'
import { FileSearchSchema, IpcChannels } from '../../shared/ipc'
import type { FileSearchService } from '../services/file-search'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export function registerFilesIpc(files: Pick<FileSearchService, 'search'>): Disposer {
  ipcMain.handle(IpcChannels.filesSearch, (_e, raw: unknown) => files.search(FileSearchSchema.parse(raw)))
  return removeHandlers(IpcChannels.filesSearch)
}
