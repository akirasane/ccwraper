import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type { ShellProfile } from '../../shared/config'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export interface PtyIpcDeps {
  send: (channel: string, payload: unknown) => void
}

// STUB (WP0). WP3 replaces this with PtyService + shell detection (and adds the ipcMain.on write/resize).
export function registerPtyIpc(_deps: PtyIpcDeps): Disposer {
  ipcMain.handle(IpcChannels.ptyListShells, (): ShellProfile[] => [])
  ipcMain.handle(IpcChannels.ptyOpen, () => {
    throw new Error('terminal not available yet')
  })
  ipcMain.handle(IpcChannels.ptyClose, (): void => {})
  return removeHandlers(IpcChannels.ptyListShells, IpcChannels.ptyOpen, IpcChannels.ptyClose)
}
