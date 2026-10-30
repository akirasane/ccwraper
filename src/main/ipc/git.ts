import { ipcMain } from 'electron'
import { GitDiffSchema, GitLogSchema, GitStatusSchema, IpcChannels } from '../../shared/ipc'
import type { GitService } from '../services/git-service'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export function registerGitIpc(git: Pick<GitService, 'status' | 'diff' | 'log'>): Disposer {
  ipcMain.handle(IpcChannels.gitStatus, (_e, raw: unknown) => git.status(GitStatusSchema.parse(raw)))
  ipcMain.handle(IpcChannels.gitDiff, (_e, raw: unknown) => git.diff(GitDiffSchema.parse(raw)))
  ipcMain.handle(IpcChannels.gitLog, (_e, raw: unknown) => git.log(GitLogSchema.parse(raw)))
  return removeHandlers(IpcChannels.gitStatus, IpcChannels.gitDiff, IpcChannels.gitLog)
}
