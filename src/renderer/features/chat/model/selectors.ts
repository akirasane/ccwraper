import type { ChatItem, ConvState, PendingPermission, TaskView, ToolCallView, TurnActivity } from './types'

export const selectItems = (c: ConvState): ChatItem[] => c.items
export const selectTool = (c: ConvState, toolUseId: string): ToolCallView | undefined => c.tools[toolUseId]
export const selectActivePermission = (c: ConvState): PendingPermission | undefined => c.pending[0]
export const selectIsRunning = (c: ConvState): boolean => c.status === 'running' || c.status === 'waiting_permission'
export const selectIsStreaming = (c: ConvState): boolean => c.items.some((i) => i.kind === 'assistant' && i.streaming)

/** Fraction (0..1) of the context window used by the latest turn's input, or undefined if unknown. */
export function selectContextUsage(c: ConvState): number | undefined {
  const r = c.lastResult
  if (!r?.contextWindow) return undefined
  const used = r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheCreationTokens
  return Math.min(1, used / r.contextWindow)
}

// ---- P3 frozen selector signatures. WP0 lands stubs; WP2 implements them (memoized per D13). ----

const EMPTY_ITEMS: ChatItem[] = []
const EMPTY_TASKS: TaskView[] = []

export interface LiveContext {
  used: number
  window: number
  fraction: number
  exact: boolean
}
export interface WorkingState {
  verb: 'working' | 'thinking' | 'tool' | 'approval'
  toolName?: string
  since: number
}

/** The SDK tool that spawns a subagent: `Agent` in current CLIs, legacy `Task`. */
export const isAgentTool = (name: string): boolean => name === 'Agent' || name === 'Task'

/** STUB: returns all items. WP2: hides children of known Agent / Task tools at any depth. */
export const selectTopLevelItems = (c: ConvState): ChatItem[] => c.items
/** STUB: always empty. WP2: items whose parentToolUseId is `toolUseId`. */
export const selectChildItems = (_c: ConvState, _toolUseId: string): ChatItem[] => EMPTY_ITEMS
/** STUB: undefined. WP2: the task spawned by this tool call. */
export const selectTaskForTool = (_c: ConvState, _toolUseId: string): TaskView | undefined => undefined
/** STUB: always empty. WP2: running tasks excluding ambient and hidden. */
export const selectRunningTasks = (_c: ConvState): TaskView[] => EMPTY_TASKS
/** STUB: undefined. WP2: context from the latest main-thread usage_live, not result.usage. */
export const selectLiveContext = (_c: ConvState, _fallbackWindow?: number): LiveContext | undefined => undefined
/** STUB: undefined. WP2: the live turn, else the last turn. */
export const selectTurnSummary = (_c: ConvState): TurnActivity | undefined => undefined
/** STUB: undefined. WP2: what the working row should say. */
export const selectWorkingState = (_c: ConvState): WorkingState | undefined => undefined
