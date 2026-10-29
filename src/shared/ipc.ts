import { z } from 'zod'
import type { SessionEvent } from './events'

export const PermissionModeSchema = z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'])
export type PermissionMode = z.infer<typeof PermissionModeSchema>

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
  remember: z.enum(['once', 'session', 'always']).optional(),
  updatedInput: z.record(z.string(), z.unknown()).optional()
})
export type PermissionReplyArgs = z.infer<typeof PermissionReplySchema>

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
  }
  dialog: { pickDirectory(): Promise<string | null> }
}
