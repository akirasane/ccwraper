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
  appInfo: 'app:info'
} as const
