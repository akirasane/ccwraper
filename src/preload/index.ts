import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/channels'
import type { CcwrapApi, SessionEventPayload } from '../shared/ipc'

const api: CcwrapApi = {
  session: {
    start: (args) => ipcRenderer.invoke(IpcChannels.sessionStart, args),
    send: (args) => ipcRenderer.invoke(IpcChannels.sessionSend, args),
    interrupt: (id) => ipcRenderer.invoke(IpcChannels.sessionInterrupt, id),
    close: (id) => ipcRenderer.invoke(IpcChannels.sessionClose, id),
    setModel: (id, model) => ipcRenderer.invoke(IpcChannels.sessionSetModel, id, model),
    setPermissionMode: (id, mode) => ipcRenderer.invoke(IpcChannels.sessionSetPermissionMode, id, mode),
    permissionReply: (args) => ipcRenderer.invoke(IpcChannels.sessionPermissionReply, args),
    onEvent: (cb) => {
      const h = (_: unknown, p: SessionEventPayload): void => cb(p)
      ipcRenderer.on(IpcChannels.sessionEvent, h)
      return () => ipcRenderer.removeListener(IpcChannels.sessionEvent, h)
    }
  },
  dialog: { pickDirectory: () => ipcRenderer.invoke(IpcChannels.pickDirectory) }
}

contextBridge.exposeInMainWorld('ccwrap', api)
