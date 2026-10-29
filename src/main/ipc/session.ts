import { dialog, ipcMain } from 'electron'
import {
  IpcChannels,
  PermissionModeSchema,
  PermissionReplySchema,
  SessionSendSchema,
  SessionStartSchema
} from '../../shared/ipc'
import type { SessionManager } from '../services/session-manager'

export function registerSessionIpc(manager: SessionManager): void {
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
  ipcMain.handle(IpcChannels.pickDirectory, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
}
