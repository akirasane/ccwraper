import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/channels'
import type { FsChangedPayload, PtyDataPayload, PtyExitPayload } from '../shared/config'
import type { CcwrapApi, SessionEventPayload } from '../shared/ipc'

function subscribe<T>(channel: string, cb: (p: T) => void): () => void {
  const h = (_: unknown, p: T): void => cb(p)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

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
    },
    supportedModels: (id) => ipcRenderer.invoke(IpcChannels.sessionSupportedModels, id),
    stopTask: (localId, taskId) => ipcRenderer.invoke(IpcChannels.sessionStopTask, { localId, taskId })
  },
  items: {
    list: (args) => ipcRenderer.invoke(IpcChannels.itemsList, args),
    create: (args) => ipcRenderer.invoke(IpcChannels.itemsCreate, args),
    rename: (args) => ipcRenderer.invoke(IpcChannels.itemsRename, args),
    delete: (args) => ipcRenderer.invoke(IpcChannels.itemsDelete, args)
  },
  dialog: { pickDirectory: () => ipcRenderer.invoke(IpcChannels.pickDirectory) },
  history: {
    listProjects: () => ipcRenderer.invoke(IpcChannels.historyListProjects),
    list: (args) => ipcRenderer.invoke(IpcChannels.historyList, args),
    load: (args) => ipcRenderer.invoke(IpcChannels.historyLoad, args)
  },
  app: { info: () => ipcRenderer.invoke(IpcChannels.appInfo) },
  config: {
    read: (ref) => ipcRenderer.invoke(IpcChannels.configRead, { ref }),
    write: (args) => ipcRenderer.invoke(IpcChannels.configWrite, args),
    watchProject: (cwd) => ipcRenderer.invoke(IpcChannels.configWatchProject, { cwd }),
    onChanged: (cb) => subscribe<FsChangedPayload>(IpcChannels.fsChanged, cb)
  },
  settings: { resolve: (args) => ipcRenderer.invoke(IpcChannels.settingsResolve, args) },
  mcp: {
    list: (args) => ipcRenderer.invoke(IpcChannels.mcpList, args),
    add: (args) => ipcRenderer.invoke(IpcChannels.mcpAdd, args),
    remove: (args) => ipcRenderer.invoke(IpcChannels.mcpRemove, args),
    update: (args) => ipcRenderer.invoke(IpcChannels.mcpUpdate, args),
    test: (args) => ipcRenderer.invoke(IpcChannels.mcpTest, args)
  },
  pty: {
    listShells: () => ipcRenderer.invoke(IpcChannels.ptyListShells),
    open: (args) => ipcRenderer.invoke(IpcChannels.ptyOpen, args),
    write: (ptyId, data) => ipcRenderer.send(IpcChannels.ptyWrite, { ptyId, data }),
    resize: (ptyId, cols, rows) => ipcRenderer.send(IpcChannels.ptyResize, { ptyId, cols, rows }),
    close: (ptyId) => ipcRenderer.invoke(IpcChannels.ptyClose, { ptyId }),
    onData: (cb) => subscribe<PtyDataPayload>(IpcChannels.ptyData, cb),
    onExit: (cb) => subscribe<PtyExitPayload>(IpcChannels.ptyExit, cb)
  }
}

contextBridge.exposeInMainWorld('ccwrap', api)
