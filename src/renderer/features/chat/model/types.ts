// Owned by WP4: the chat view model. Pure data, no React.
import type { SessionStatus, Usage } from '@shared/events'

/** Identifies a conversation shown in ChatView. */
export type ChatTarget = { convId: string; cwd: string; localId?: string; resumeSessionId?: string }

export type AssistantPart =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string; startedAt?: number; endedAt?: number }

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | {
      kind: 'assistant'
      id: string
      msgId: string
      parts: AssistantPart[]
      /** true while deltas may still arrive (not yet finalized by assistant_message). */
      streaming: boolean
      parentToolUseId?: string
    }
  | { kind: 'tool'; id: string; toolUseId: string; parentToolUseId?: string }
  | { kind: 'error'; id: string; message: string }

export type ToolStatus = 'running' | 'done' | 'error' | 'needs_approval'

export interface ToolCallView {
  toolUseId: string
  name: string
  input: unknown
  status: ToolStatus
  result?: string
  startedAt?: number
  endedAt?: number
  parentToolUseId?: string
  /** reqId of the permission request currently gating this tool. */
  reqId?: string
}

export interface PendingPermission {
  reqId: string
  toolName: string
  input: unknown
  title?: string
  ruleLabel?: string
  /** Every rule an "Always allow" would save (all addRules suggestions). */
  ruleLabels?: string[]
  /** Set when the request matched a running tool by name + input. */
  toolUseId?: string
}

export interface ConvMeta {
  sessionId?: string
  model?: string
  tools: string[]
  mcp: { name: string; status: string }[]
  slashCommands: string[]
  permissionMode?: string
  cwd?: string
}

export interface LastResult {
  costUsd: number
  durationMs: number
  turns: number
  usage: Usage
  isError: boolean
  contextWindow?: number
  resultText?: string
}

export interface ConvState {
  convId: string
  cwd: string
  localId?: string
  resumeSessionId?: string
  items: ChatItem[]
  tools: Record<string, ToolCallView>
  pending: PendingPermission[]
  meta: ConvMeta
  status: SessionStatus
  lastResult?: LastResult
  /** Inline notice above the stream (e.g. truncated history). */
  notice?: string
  /** Monotonic counter for item ids; keeps the reducer pure. */
  seq: number
}
