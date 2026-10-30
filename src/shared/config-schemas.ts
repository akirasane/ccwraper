import { z } from 'zod'
import { PermissionModeSchema } from './permission-mode'

const StringMap = z.record(z.string(), z.string())

/** stdio / http / sse / ws MCP server config. Loose so unknown keys survive. */
export const McpServerConfigSchema = z.union([
  z.looseObject({
    type: z.literal('stdio').optional(),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: StringMap.optional()
  }),
  z.looseObject({
    type: z.enum(['http', 'sse']),
    url: z.url(),
    headers: StringMap.optional()
  }),
  z.looseObject({ type: z.literal('ws'), url: z.url() })
])
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>

/**
 * Form-level validation messages only. Main never rejects a settings file for failing this
 * (it checks "parses and is an object"), because new CLI keys must not be refused.
 */
export const SettingsFormSchema = z.looseObject({
  model: z.string().optional(),
  permissions: z
    .looseObject({
      defaultMode: PermissionModeSchema.optional(),
      allow: z.array(z.string()).optional(),
      ask: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
      additionalDirectories: z.array(z.string()).optional()
    })
    .optional(),
  env: StringMap.optional(),
  cleanupPeriodDays: z.number().int().min(0).optional(),
  enableAllProjectMcpServers: z.boolean().optional(),
  enabledMcpjsonServers: z.array(z.string()).optional(),
  disabledMcpjsonServers: z.array(z.string()).optional()
})
export type SettingsForm = z.infer<typeof SettingsFormSchema>

// ---- P3: skill / command / agent frontmatter (renderer warnings only; main never rejects on these) ----

/** A comma/space separated string or a list of strings. */
export const ToolListSchema = z.union([z.string(), z.array(z.string())])

export const SkillFrontmatterSchema = z.looseObject({
  name: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
  description: z.string().optional(),
  'allowed-tools': ToolListSchema.optional(),
  model: z.string().optional(),
  'argument-hint': z.string().optional(),
  'disable-model-invocation': z.boolean().optional(),
  'user-invocable': z.boolean().optional(),
  context: z.literal('fork').optional(),
  agent: z.string().optional(),
  paths: ToolListSchema.optional(),
  version: z.union([z.string(), z.number()]).optional(),
  license: z.string().optional()
})
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>

export const CommandFrontmatterSchema = z.looseObject({
  description: z.string().optional(),
  'allowed-tools': ToolListSchema.optional(),
  'argument-hint': z.string().optional(),
  model: z.string().optional(),
  'disable-model-invocation': z.boolean().optional()
})
export type CommandFrontmatter = z.infer<typeof CommandFrontmatterSchema>

export const AGENT_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'] as const

export const AgentFrontmatterSchema = z.looseObject({
  name: z.string().optional(),
  description: z.string().optional(),
  tools: ToolListSchema.optional(),
  disallowedTools: ToolListSchema.optional(),
  model: z.string().optional(),
  permissionMode: PermissionModeSchema.optional(),
  color: z.enum(AGENT_COLORS).optional(),
  maxTurns: z.number().int().min(1).optional(),
  memory: z.enum(['user', 'project', 'local']).optional(),
  effort: z.union([z.enum(['low', 'medium', 'high', 'xhigh', 'max']), z.number().int()]).optional(),
  background: z.boolean().optional(),
  skills: z.array(z.string()).optional(),
  mcpServers: z.unknown().optional(),
  hooks: z.unknown().optional(),
  initialPrompt: z.string().optional()
})
export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>

// ---- P3: hooks (settings.hooks) ----

const HookCommon = {
  timeout: z.number().int().positive().optional(),
  statusMessage: z.string().optional()
}

export const HookEntrySchema = z.union([
  z.looseObject({
    type: z.literal('command'),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    shell: z.enum(['bash', 'powershell']).optional(),
    async: z.boolean().optional(),
    asyncRewake: z.boolean().optional(),
    once: z.boolean().optional(),
    if: z.string().optional(),
    onFailure: z.enum(['continue', 'block']).optional(),
    ...HookCommon
  }),
  z.looseObject({
    type: z.enum(['prompt', 'agent']),
    prompt: z.string().min(1),
    model: z.string().optional(),
    continueOnBlock: z.boolean().optional(),
    ...HookCommon
  }),
  z.looseObject({
    type: z.literal('http'),
    url: z.url(),
    headers: StringMap.optional(),
    allowedEnvVars: z.array(z.string()).optional(),
    onFailure: z.enum(['continue', 'block']).optional(),
    ...HookCommon
  }),
  z.looseObject({
    type: z.literal('mcp_tool'),
    server: z.string().min(1),
    tool: z.string().min(1),
    input: z.unknown().optional(),
    ...HookCommon
  }),
  // Fallback for entry types a newer CLI knows: keep them, never reject.
  z.looseObject({ type: z.string() })
])
export type HookEntry = z.infer<typeof HookEntrySchema>

export const HookMatcherGroupSchema = z.looseObject({
  matcher: z.string().optional(),
  hooks: z.array(HookEntrySchema)
})
export type HookMatcherGroup = z.infer<typeof HookMatcherGroupSchema>

export const HooksSettingSchema = z.record(z.string(), z.array(HookMatcherGroupSchema))
export type HooksSetting = z.infer<typeof HooksSettingSchema>
