import { ipcMain } from 'electron'
import {
  IpcChannels,
  McpAddSchema,
  McpListSchema,
  McpRemoveSchema,
  McpTestSchema,
  McpUpdateSchema
} from '../../shared/ipc'
import type { McpListResult, McpMutationResult, McpTestResult } from '../../shared/config'
import { createConfigPaths } from '../paths'
import { McpService } from '../services/mcp-service'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export function registerMcpIpc(service: McpService = new McpService({ paths: createConfigPaths() })): Disposer {
  ipcMain.handle(IpcChannels.mcpList, (_e, raw: unknown): Promise<McpListResult> => service.list(McpListSchema.parse(raw ?? {}).cwd))
  ipcMain.handle(IpcChannels.mcpAdd, (_e, raw: unknown): Promise<McpMutationResult> => service.add(McpAddSchema.parse(raw)))
  ipcMain.handle(IpcChannels.mcpRemove, (_e, raw: unknown): Promise<McpMutationResult> =>
    service.remove(McpRemoveSchema.parse(raw))
  )
  ipcMain.handle(IpcChannels.mcpUpdate, (_e, raw: unknown): Promise<McpMutationResult> =>
    service.update(McpUpdateSchema.parse(raw))
  )
  ipcMain.handle(IpcChannels.mcpTest, (_e, raw: unknown): Promise<McpTestResult> => service.test(McpTestSchema.parse(raw)))
  return removeHandlers(IpcChannels.mcpList, IpcChannels.mcpAdd, IpcChannels.mcpRemove, IpcChannels.mcpUpdate, IpcChannels.mcpTest)
}
