// Kept zod-free so the sandboxed preload can bundle it.
export const IpcChannels = {
  sessionStart: 'session:start',
  sessionSend: 'session:send',
  sessionInterrupt: 'session:interrupt',
  sessionClose: 'session:close',
  sessionSetModel: 'session:setModel',
  sessionSetPermissionMode: 'session:setPermissionMode',
  sessionPermissionReply: 'session:permissionReply',
  sessionEvent: 'session:event',
  pickDirectory: 'dialog:pickDirectory',
  historyListProjects: 'history:listProjects',
  historyList: 'history:list',
  historyLoad: 'history:load',
  appInfo: 'app:info',
  sessionSupportedModels: 'session:supportedModels',
  configRead: 'config:read',
  configWrite: 'config:write',
  configWatchProject: 'config:watchProject',
  settingsResolve: 'settings:resolve',
  mcpList: 'mcp:list',
  mcpAdd: 'mcp:add',
  mcpRemove: 'mcp:remove',
  mcpUpdate: 'mcp:update',
  mcpTest: 'mcp:test',
  ptyListShells: 'pty:listShells',
  ptyOpen: 'pty:open',
  /** Fire-and-forget (ipcRenderer.send / ipcMain.on). */
  ptyWrite: 'pty:write',
  /** Fire-and-forget (ipcRenderer.send / ipcMain.on). */
  ptyResize: 'pty:resize',
  ptyClose: 'pty:close',
  /** main -> renderer events */
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  fsChanged: 'fs:changed'
} as const
