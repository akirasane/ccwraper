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
