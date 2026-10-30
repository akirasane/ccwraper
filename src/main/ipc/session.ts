import { dialog, ipcMain } from 'electron'
import {
  IpcChannels,
  PermissionModeSchema,
  PermissionReplySchema,
  SessionSendSchema,
  SessionStartSchema,
  SessionStopTaskSchema
} from '../../shared/ipc'
import type { ModelOption } from '../../shared/config'
import type { SessionManager } from '../services/session-manager'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export function registerSessionIpc(manager: SessionManager): Disposer {
  ipcMain.handle(IpcChannels.sessionStart, (_e, raw: unknown) => manager.start(SessionStartSchema.parse(raw)))
  ipcMain.handle(IpcChannels.sessionSend, (_e, raw: unknown) => {
    const a = SessionSendSchema.parse(raw)
    manager.send(a.localId, a.text)
  })
  ipcMain.handle(IpcChannels.sessionInterrupt, (_e, id: unknown) => manager.interrupt(String(id)))
  ipcMain.handle(IpcChannels.sessionClose, (_e, id: unknown) => manager.close(String(id)))
  ipcMain.handle(IpcChannels.sessionSetModel, (_e, id: unknown, model: unknown) =>
    manager.setModel(String(id), String(model))
  )
  ipcMain.handle(IpcChannels.sessionSetPermissionMode, (_e, id: unknown, mode: unknown) =>
    manager.setPermissionMode(String(id), PermissionModeSchema.parse(mode))
  )
  ipcMain.handle(IpcChannels.sessionPermissionReply, (_e, raw: unknown) =>
    manager.permissionReply(PermissionReplySchema.parse(raw))
  )
  ipcMain.handle(IpcChannels.sessionSupportedModels, (_e, id: unknown): Promise<ModelOption[]> =>
    manager.supportedModels(String(id))
  )
  // WP0 STUB: WP1 wires this to manager.stopTask.
  ipcMain.handle(IpcChannels.sessionStopTask, async (_e, raw: unknown): Promise<void> => {
    SessionStopTaskSchema.parse(raw)
  })
  ipcMain.handle(IpcChannels.pickDirectory, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  return removeHandlers(
    IpcChannels.sessionStart,
    IpcChannels.sessionSend,
    IpcChannels.sessionInterrupt,
    IpcChannels.sessionClose,
    IpcChannels.sessionSetModel,
    IpcChannels.sessionSetPermissionMode,
    IpcChannels.sessionPermissionReply,
    IpcChannels.sessionSupportedModels,
    IpcChannels.sessionStopTask,
    IpcChannels.pickDirectory
  )
}
