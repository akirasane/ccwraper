// Owned by WP4: the chat view model. Pure data, no React.
import type { SessionStatus, TaskStatus, Usage } from '@shared/events'

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
  /** CLI-reported elapsed (tool_progress); the UI shows max(progressMs, now - startedAt). */
  progressMs?: number
}

// ---- P3 frozen seams (types only; WP2 implements the logic) ----

export interface TaskView {
  taskId: string
  toolUseId?: string
  description: string
  subagentType?: string
  taskType?: string
  parentTaskId?: string
  depth?: number
  background?: boolean
  ambient?: boolean
  hidden?: boolean
  status: TaskStatus | 'stopping'
  startedAt: number
  endedAt?: number
  /** CLI-reported */
  totalTokens?: number
  toolUses?: number
  durationMs?: number
  progressAt?: number
  lastToolName?: string
  summary?: string
  error?: string
}

export interface TurnActivity {
  startedAt: number
  endedAt?: number
  durationMs?: number
  usage: Usage
  exact: boolean
  apiCalls: number
  contextTokens?: number
  contextExact?: boolean
}

export interface SessionActivity {
  workMs: number
  apiMs: number
  turns: number
  usage?: Usage & { costUsd: number; thinkingTokens?: number }
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
  agents?: string[]
  skills?: string[]
  plugins?: { name: string; version?: string }[]
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
  /** Subagent tasks by taskId (P3). */
  tasks: Record<string, TaskView>
  /** Live turn (P3). */
  turn?: TurnActivity
  lastTurn?: TurnActivity
  session: SessionActivity
  /** Inline notice above the stream (e.g. truncated history). */
  notice?: string
  /** Monotonic counter for item ids; keeps the reducer pure. */
  seq: number
}
