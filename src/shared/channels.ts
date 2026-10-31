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
  fsChanged: 'fs:changed',
  // ---- P3 ----
  sessionStopTask: 'session:stopTask',
  itemsList: 'items:list',
  itemsCreate: 'items:create',
  itemsRename: 'items:rename',
  itemsDelete: 'items:delete',
  // ---- P4 ----
  appAuthStatus: 'app:authStatus',
  /** Fire-and-forget (ipcRenderer.send / ipcMain.on). */
  appSetActiveSession: 'app:setActiveSession',
  /** main -> renderer */
  appFocusSession: 'app:focusSession',
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  /** main -> renderer */
  prefsChanged: 'prefs:changed',
  usageSummary: 'usage:summary',
  gitStatus: 'git:status',
  gitDiff: 'git:diff',
  gitLog: 'git:log',
  // ---- P4 WP14 ----
  /** Fire-and-forget (ipcRenderer.send / ipcMain.on). */
  autoResumeReport: 'autoresume:report',
  // ---- auto-update ----
  /** main -> renderer */
  updateState: 'update:state',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  updateGetState: 'update:getState',
  // ---- status bar: usage limits + caveman badge ----
  /** main -> renderer */
  limitsState: 'limits:state',
  limitsGet: 'limits:get',
  /** main -> renderer */
  cavemanState: 'caveman:state',
  cavemanGet: 'caveman:get'
} as const
