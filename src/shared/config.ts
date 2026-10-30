// P2 config / MCP / pty types. Types only (zod-free) so the sandboxed preload can import it.

export type SettingsScope = 'user' | 'project' | 'local'
// user ~/.claude/CLAUDE.md | project <p>/CLAUDE.md | projectDotClaude <p>/.claude/CLAUDE.md | local <p>/CLAUDE.local.md
export type MemoryScope = 'user' | 'project' | 'projectDotClaude' | 'local'
export type ConfigFileRef =
  | { kind: 'settings'; scope: SettingsScope; cwd?: string } // cwd required unless scope === 'user'
  | { kind: 'memory'; scope: MemoryScope; cwd?: string }
export interface ConfigSnapshot {
  ref: ConfigFileRef
  path: string
  exists: boolean
  text: string
  hash: string | null
  mtimeMs?: number
}
export type ConfigErrorCode = 'conflict' | 'invalid_json' | 'not_object' | 'bad_ref' | 'io'
export type ConfigWriteResult =
  | { ok: true; snapshot: ConfigSnapshot; backupPath?: string }
  | { ok: false; code: ConfigErrorCode; message: string; current?: ConfigSnapshot }

export type ResolvedSource = 'user' | 'project' | 'local' | 'flag' | 'managed'
export interface ResolvedSettingsView {
  cwd?: string
  effective: Record<string, unknown>
  provenance: Record<string, { source: ResolvedSource; path?: string }>
  /** low -> high precedence, as returned by the SDK */
  sources: Array<{ source: ResolvedSource; path?: string; policyOrigin?: string; settings: Record<string, unknown> }>
  ignoredDefaultMode?: { source: ResolvedSource; mode: string }
  error?: string
}

export type McpScope = 'user' | 'project' | 'local'
export type McpTransport = 'stdio' | 'sse' | 'http' | 'ws' | 'unknown'
export interface McpServerEntry {
  name: string
  scope: McpScope
  transport: McpTransport
  /** As stored, env/header values included; the renderer masks them. */
  config: Record<string, unknown>
  /** Project scope only. */
  approval?: 'approved' | 'rejected' | 'pending'
  shadowedBy?: McpScope
}
export interface McpListResult {
  servers: McpServerEntry[]
  projectFile?: string
  error?: string
}
export type McpMutationResult = { ok: true; output: string } | { ok: false; message: string; output?: string }
export interface McpTestResult {
  name: string
  status: 'connected' | 'failed' | 'pending' | 'needs_auth' | 'unknown'
  detail?: string
  output: string
  durationMs: number
}

export type ShellId = 'pwsh' | 'powershell' | 'cmd' | 'gitbash' | 'wsl'
export interface ShellProfile {
  id: ShellId
  label: string
  path: string
  isDefault?: boolean
}
export interface PtyOpenResult {
  ptyId: string
  pid: number
  shellId: ShellId
}
export interface PtyDataPayload {
  ptyId: string
  data: string
}
export interface PtyExitPayload {
  ptyId: string
  exitCode: number
  signal?: number
}

export interface FsChangedPayload {
  kind: 'settings' | 'memory' | 'mcp'
  scope?: SettingsScope | MemoryScope | McpScope
  cwd?: string
  path: string
}
export interface ModelOption {
  value: string
  displayName: string
  description?: string
}
