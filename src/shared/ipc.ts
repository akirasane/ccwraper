import { z } from 'zod'
import { McpServerConfigSchema } from './config-schemas'
import type {
  ConfigFileRef,
  ConfigItemList,
  ConfigSnapshot,
  ConfigWriteResult,
  FsChangedPayload,
  ItemKind,
  ItemMutationResult,
  ItemScope,
  McpListResult,
  McpMutationResult,
  McpTestResult,
  ModelOption,
  PtyDataPayload,
  PtyExitPayload,
  PtyOpenResult,
  ResolvedSettingsView,
  ShellProfile
} from './config'
import type { AppInfo, HistorySessionInfo, ProjectInfo, SessionEvent } from './events'
import { PermissionModeSchema } from './permission-mode'
import type { PermissionMode } from './permission-mode'

export { PermissionModeSchema }
export type { PermissionMode }

export const SessionStartSchema = z.object({
  cwd: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().optional(),
  permissionMode: PermissionModeSchema.optional(),
  resumeId: z.string().optional(),
  fork: z.boolean().optional()
})
export type SessionStartArgs = z.infer<typeof SessionStartSchema>

export const SessionSendSchema = z.object({ localId: z.string(), text: z.string().min(1) })
export type SessionSendArgs = z.infer<typeof SessionSendSchema>

export const PermissionReplySchema = z.object({
  localId: z.string(),
  reqId: z.string(),
  decision: z.enum(['allow', 'deny']),
  remember: z.enum(['once', 'session', 'always', 'user']).optional(),
  updatedInput: z.record(z.string(), z.unknown()).optional()
})
export type PermissionReplyArgs = z.infer<typeof PermissionReplySchema>

export const HistoryListSchema = z.object({ cwd: z.string().min(1) })
export type HistoryListArgs = z.infer<typeof HistoryListSchema>

export const HistoryLoadSchema = z.object({ sessionId: z.string().min(1), cwd: z.string().optional() })
export type HistoryLoadArgs = z.infer<typeof HistoryLoadSchema>

// ---- P2: config / settings ----
export const SettingsScopeSchema = z.enum(['user', 'project', 'local'])
export const MemoryScopeSchema = z.enum(['user', 'project', 'projectDotClaude', 'local'])

// ---- P3: item kinds / names ----
export const ItemKindSchema = z.enum(['skill', 'command', 'agent'])
export const ItemScopeSchema = z.enum(['user', 'project'])

const REF_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const NEW_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Max path segments in an item name: commands may be namespaced 3 deep, skills and agents are flat. */
export function maxItemSegments(kind: 'skill' | 'command' | 'agent'): number {
  return kind === 'command' ? 3 : 1
}

/** Existing names (refs): lenient so on-disk files keep working. '/' separates command namespaces; no '..' segment. */
export function isValidRefName(kind: 'skill' | 'command' | 'agent', name: string): boolean {
  const segs = name.split('/')
  return segs.length >= 1 && segs.length <= maxItemSegments(kind) && segs.every((s) => s !== '..' && REF_SEGMENT.test(s))
}

/** New names (create / rename): strict kebab-case, <= 64 chars. */
export function isValidNewName(kind: 'skill' | 'command' | 'agent', name: string): boolean {
  const segs = name.split('/')
  return name.length <= 64 && segs.length >= 1 && segs.length <= maxItemSegments(kind) && segs.every((s) => NEW_SEGMENT.test(s))
}

/** Strict new-name rule without a kind (segment count is checked per kind by the schemas that know it). */
export const NewItemNameSchema = z
  .string()
  .max(64)
  .refine((n) => n.split('/').length <= 3 && n.split('/').every((s) => NEW_SEGMENT.test(s)), {
    message: 'Use lowercase letters, digits and single hyphens (commands may use up to 3 "/" segments)'
  })

const OptCwd = z.string().min(1).optional()
const NEEDS_CWD_SCOPES = new Set(['project', 'local', 'projectDotClaude'])

export const ConfigFileRefSchema = z
  .union([
    z.object({ kind: z.literal('settings'), scope: SettingsScopeSchema, cwd: OptCwd }),
    z.object({ kind: z.literal('memory'), scope: MemoryScopeSchema, cwd: OptCwd }),
    z.object({ kind: ItemKindSchema, scope: ItemScopeSchema, cwd: OptCwd, name: z.string().min(1).max(400) }),
    z.object({
      kind: ItemKindSchema,
      scope: z.literal('plugin'),
      plugin: z.string().regex(/^[A-Za-z0-9_.@-]{1,128}$/),
      name: z.string().min(1).max(400)
    })
  ])
  .refine((r) => !NEEDS_CWD_SCOPES.has(r.scope) || ('cwd' in r && !!r.cwd), {
    message: 'cwd is required for project, local and projectDotClaude scopes'
  })
  .refine((r) => !('name' in r) || isValidRefName(r.kind as 'skill' | 'command' | 'agent', r.name), {
    message: 'Invalid item name'
  })

/** A ref to a user or project item (never settings / memory / plugin). */
const ItemRefSchema = ConfigFileRefSchema.refine((r) => 'name' in r && r.scope !== 'plugin', {
  message: 'A non-plugin item ref is required'
})

export const ConfigReadSchema = z.object({ ref: ConfigFileRefSchema })
export type ConfigReadArgs = z.infer<typeof ConfigReadSchema>

export const ConfigWriteSchema = z.object({
  ref: ConfigFileRefSchema,
  text: z.string().max(2_000_000),
  baseHash: z.string().nullable()
})
export type ConfigWriteArgs = z.infer<typeof ConfigWriteSchema>

export const ConfigWatchProjectSchema = z.object({ cwd: z.string().nullable() })
export type ConfigWatchProjectArgs = z.infer<typeof ConfigWatchProjectSchema>

export const SettingsResolveSchema = z.object({ cwd: z.string().optional() })
export type SettingsResolveArgs = z.infer<typeof SettingsResolveSchema>

// ---- P3: items (skills / commands / agents) ----
export const ItemsListSchema = z.object({ kind: ItemKindSchema, cwd: z.string().min(1).optional() })
export interface ItemsListArgs {
  kind: ItemKind
  cwd?: string
}

export const ItemsCreateSchema = z
  .object({
    kind: ItemKindSchema,
    scope: ItemScopeSchema,
    cwd: z.string().min(1).optional(),
    name: NewItemNameSchema,
    text: z.string().max(2_000_000)
  })
  .refine((a) => a.scope === 'user' || !!a.cwd, { message: 'cwd is required for project scope' })
  .refine((a) => isValidNewName(a.kind, a.name), { message: 'Invalid item name for this kind', path: ['name'] })
export interface ItemsCreateArgs {
  kind: ItemKind
  scope: ItemScope
  cwd?: string
  name: string
  text: string
}

export const ItemsRenameSchema = z
  .object({ ref: ItemRefSchema, newName: NewItemNameSchema, baseHash: z.string(), text: z.string().max(2_000_000).optional() })
  .refine((a) => isValidNewName(a.ref.kind as ItemKind, a.newName), { message: 'Invalid item name for this kind', path: ['newName'] })
export interface ItemsRenameArgs {
  ref: ConfigFileRef
  newName: string
  baseHash: string
  text?: string
}

export const ItemsDeleteSchema = z.object({ ref: ItemRefSchema, baseHash: z.string() })
export interface ItemsDeleteArgs {
  ref: ConfigFileRef
  baseHash: string
}

export const SessionStopTaskSchema = z.object({ localId: z.string(), taskId: z.string().min(1) })
export type SessionStopTaskArgs = z.infer<typeof SessionStopTaskSchema>

// ---- P2: MCP ----
export const McpScopeSchema = z.enum(['user', 'project', 'local'])
const McpName = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/)
const needsCwd = (a: { scope: string; cwd?: string | undefined }): boolean => a.scope === 'user' || !!a.cwd
const needsCwdMsg = { message: 'cwd is required for project and local scopes' }

export const McpListSchema = z.object({ cwd: z.string().min(1).optional() })
export type McpListArgs = z.infer<typeof McpListSchema>

export const McpAddSchema = z
  .object({ scope: McpScopeSchema, cwd: z.string().min(1).optional(), name: McpName, config: McpServerConfigSchema })
  .refine(needsCwd, needsCwdMsg)
export type McpAddArgs = z.infer<typeof McpAddSchema>

export const McpRemoveSchema = z
  .object({ scope: McpScopeSchema, cwd: z.string().min(1).optional(), name: McpName })
  .refine(needsCwd, needsCwdMsg)
export type McpRemoveArgs = z.infer<typeof McpRemoveSchema>

export const McpUpdateSchema = z
  .object({
    scope: McpScopeSchema,
    cwd: z.string().min(1).optional(),
    name: McpName,
    newName: McpName.optional(),
    config: McpServerConfigSchema
  })
  .refine(needsCwd, needsCwdMsg)
export type McpUpdateArgs = z.infer<typeof McpUpdateSchema>

export const McpTestSchema = z.object({ cwd: z.string().min(1).optional(), name: McpName })
export type McpTestArgs = z.infer<typeof McpTestSchema>

// ---- P2: pty ----
export const ShellIdSchema = z.enum(['pwsh', 'powershell', 'cmd', 'gitbash', 'wsl'])
const Cols = z.number().int().min(2).max(500)
const Rows = z.number().int().min(2).max(300)
export const PtyOpenSchema = z.object({ shellId: ShellIdSchema, cwd: z.string().min(1), cols: Cols, rows: Rows })
export type PtyOpenArgs = z.infer<typeof PtyOpenSchema>
export const PtyWriteSchema = z.object({ ptyId: z.string(), data: z.string().max(1_000_000) })
export type PtyWriteArgs = z.infer<typeof PtyWriteSchema>
export const PtyResizeSchema = z.object({ ptyId: z.string(), cols: Cols, rows: Rows })
export type PtyResizeArgs = z.infer<typeof PtyResizeSchema>
export const PtyCloseSchema = z.object({ ptyId: z.string() })
export type PtyCloseArgs = z.infer<typeof PtyCloseSchema>

export { IpcChannels } from './channels'

export interface SessionEventPayload {
  localId: string
  event: SessionEvent
}

/** Shape exposed on window.ccwrap by the preload script. */
export interface CcwrapApi {
  session: {
    start(args: SessionStartArgs): Promise<{ localId: string }>
    send(args: SessionSendArgs): Promise<void>
    interrupt(localId: string): Promise<void>
    close(localId: string): Promise<void>
    setModel(localId: string, model: string): Promise<void>
    setPermissionMode(localId: string, mode: PermissionMode): Promise<void>
    permissionReply(args: PermissionReplyArgs): Promise<void>
    onEvent(cb: (p: SessionEventPayload) => void): () => void
    supportedModels(localId: string): Promise<ModelOption[]>
    stopTask(localId: string, taskId: string): Promise<void>
  }
  items: {
    list(args: ItemsListArgs): Promise<ConfigItemList>
    create(args: ItemsCreateArgs): Promise<ItemMutationResult>
    rename(args: ItemsRenameArgs): Promise<ItemMutationResult>
    delete(args: ItemsDeleteArgs): Promise<ItemMutationResult>
  }
  dialog: { pickDirectory(): Promise<string | null> }
  history: {
    listProjects(): Promise<ProjectInfo[]>
    list(args: HistoryListArgs): Promise<HistorySessionInfo[]>
    /** Replayable events (user_message, assistant_message, tool_use, tool_result...) for a past session. */
    load(args: HistoryLoadArgs): Promise<SessionEvent[]>
  }
  app: { info(): Promise<AppInfo> }
  config: {
    read(ref: ConfigFileRef): Promise<ConfigSnapshot>
    write(args: ConfigWriteArgs): Promise<ConfigWriteResult>
    watchProject(cwd: string | null): Promise<void>
    onChanged(cb: (p: FsChangedPayload) => void): () => void
  }
  settings: { resolve(args: SettingsResolveArgs): Promise<ResolvedSettingsView> }
  mcp: {
    list(args: McpListArgs): Promise<McpListResult>
    add(args: McpAddArgs): Promise<McpMutationResult>
    remove(args: McpRemoveArgs): Promise<McpMutationResult>
    update(args: McpUpdateArgs): Promise<McpMutationResult>
    test(args: McpTestArgs): Promise<McpTestResult>
  }
  pty: {
    listShells(): Promise<ShellProfile[]>
    open(args: PtyOpenArgs): Promise<PtyOpenResult>
    write(ptyId: string, data: string): void
    resize(ptyId: string, cols: number, rows: number): void
    close(ptyId: string): Promise<void>
    onData(cb: (p: PtyDataPayload) => void): () => void
    onExit(cb: (p: PtyExitPayload) => void): () => void
  }
}
