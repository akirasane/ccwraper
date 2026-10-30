import { z } from 'zod'

// Split out of ipc.ts so config-schemas.ts and ipc.ts can both use it without an import cycle.
export const PermissionModeSchema = z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'])
export type PermissionMode = z.infer<typeof PermissionModeSchema>
