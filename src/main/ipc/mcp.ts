import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type { McpListResult, McpMutationResult, McpTestResult } from '../../shared/config'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

// STUB (WP0). WP2 replaces this with the real McpService.
export function registerMcpIpc(): Disposer {
  const notImpl = (): McpMutationResult => ({ ok: false, message: 'not implemented' })
  ipcMain.handle(IpcChannels.mcpList, (): McpListResult => ({ servers: [] }))
  ipcMain.handle(IpcChannels.mcpAdd, notImpl)
  ipcMain.handle(IpcChannels.mcpRemove, notImpl)
  ipcMain.handle(IpcChannels.mcpUpdate, notImpl)
  ipcMain.handle(
    IpcChannels.mcpTest,
    (_e, raw: unknown): McpTestResult => ({
      name: String((raw as { name?: unknown } | null)?.name ?? ''),
      status: 'unknown',
      output: 'not implemented',
      durationMs: 0
    })
  )
  return removeHandlers(IpcChannels.mcpList, IpcChannels.mcpAdd, IpcChannels.mcpRemove, IpcChannels.mcpUpdate, IpcChannels.mcpTest)
}
