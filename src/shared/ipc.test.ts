import { describe, expect, it } from 'vitest'
import { IpcChannels } from './channels'
import { McpServerConfigSchema, SettingsFormSchema } from './config-schemas'
import {
  ConfigFileRefSchema,
  ConfigWriteSchema,
  HistoryListSchema,
  HistoryLoadSchema,
  McpAddSchema,
  McpUpdateSchema,
  PermissionReplySchema,
  PtyOpenSchema,
  PtyResizeSchema,
  PtyWriteSchema
} from './ipc'

describe('ipc contracts', () => {
  it('declares the history/app channels', () => {
    expect(IpcChannels.historyListProjects).toBe('history:listProjects')
    expect(IpcChannels.historyList).toBe('history:list')
    expect(IpcChannels.historyLoad).toBe('history:load')
    expect(IpcChannels.appInfo).toBe('app:info')
  })

  it('validates history args', () => {
    expect(HistoryListSchema.safeParse({ cwd: 'C:\\x' }).success).toBe(true)
    expect(HistoryListSchema.safeParse({ cwd: '' }).success).toBe(false)
    expect(HistoryLoadSchema.safeParse({ sessionId: 's1' }).success).toBe(true)
    expect(HistoryLoadSchema.safeParse({}).success).toBe(false)
  })
})

describe('P2 contracts', () => {
  it('declares the P2 channels', () => {
    expect(IpcChannels.configRead).toBe('config:read')
    expect(IpcChannels.configWatchProject).toBe('config:watchProject')
    expect(IpcChannels.settingsResolve).toBe('settings:resolve')
    expect(IpcChannels.ptyWrite).toBe('pty:write')
    expect(IpcChannels.fsChanged).toBe('fs:changed')
    expect(IpcChannels.sessionSupportedModels).toBe('session:supportedModels')
  })

  it('has unique channel names', () => {
    const v = Object.values(IpcChannels)
    expect(new Set(v).size).toBe(v.length)
  })

  it('permission reply accepts remember "user"', () => {
    expect(PermissionReplySchema.safeParse({ localId: 'l', reqId: 'r', decision: 'allow', remember: 'user' }).success).toBe(true)
    expect(PermissionReplySchema.safeParse({ localId: 'l', reqId: 'r', decision: 'allow', remember: 'x' }).success).toBe(false)
  })

  it('config refs require cwd unless user scope', () => {
    expect(ConfigFileRefSchema.safeParse({ kind: 'settings', scope: 'user' }).success).toBe(true)
    expect(ConfigFileRefSchema.safeParse({ kind: 'settings', scope: 'project' }).success).toBe(false)
    expect(ConfigFileRefSchema.safeParse({ kind: 'memory', scope: 'projectDotClaude', cwd: 'C:\p' }).success).toBe(true)
    expect(ConfigWriteSchema.safeParse({ ref: { kind: 'memory', scope: 'user' }, text: '', baseHash: null }).success).toBe(true)
    expect(ConfigWriteSchema.safeParse({ ref: { kind: 'memory', scope: 'user' }, text: 'x'.repeat(2_000_001), baseHash: null }).success).toBe(false)
  })

  it('mcp schemas validate name, config and cwd-by-scope', () => {
    const config = { command: 'node', args: ['a'] }
    expect(McpAddSchema.safeParse({ scope: 'user', name: 'ok-1.x', config }).success).toBe(true)
    expect(McpAddSchema.safeParse({ scope: 'user', name: 'bad name', config }).success).toBe(false)
    expect(McpAddSchema.safeParse({ scope: 'project', name: 'ok', config }).success).toBe(false)
    expect(McpAddSchema.safeParse({ scope: 'local', cwd: 'C:\p', name: 'ok', config }).success).toBe(true)
    expect(McpAddSchema.safeParse({ scope: 'user', name: 'h', config: { type: 'http', url: 'https://x.test/mcp' } }).success).toBe(true)
    expect(McpAddSchema.safeParse({ scope: 'user', name: 'h', config: { type: 'http', url: 'nope' } }).success).toBe(false)
    expect(McpUpdateSchema.safeParse({ scope: 'user', name: 'a', newName: 'b', config }).success).toBe(true)
  })

  it('MCP config keeps unknown keys', () => {
    const r = McpServerConfigSchema.parse({ command: 'x', extra: 1 })
    expect((r as Record<string, unknown>)['extra']).toBe(1)
  })

  it('settings form schema is loose and flags bad types', () => {
    expect(SettingsFormSchema.safeParse({ newCliKey: { a: 1 }, model: 'opus' }).success).toBe(true)
    expect(SettingsFormSchema.safeParse({ cleanupPeriodDays: -1 }).success).toBe(false)
    expect(SettingsFormSchema.safeParse({ permissions: { defaultMode: 'nope' } }).success).toBe(false)
  })

  it('pty schemas bound cols/rows and shell ids', () => {
    const ok = { shellId: 'pwsh', cwd: 'C:\p', cols: 80, rows: 24 }
    expect(PtyOpenSchema.safeParse(ok).success).toBe(true)
    expect(PtyOpenSchema.safeParse({ ...ok, shellId: 'C:\evil.exe' }).success).toBe(false)
    expect(PtyOpenSchema.safeParse({ ...ok, cols: 1 }).success).toBe(false)
    expect(PtyResizeSchema.safeParse({ ptyId: 'p', cols: 501, rows: 24 }).success).toBe(false)
    expect(PtyWriteSchema.safeParse({ ptyId: 'p', data: 'x' }).success).toBe(true)
  })
})
