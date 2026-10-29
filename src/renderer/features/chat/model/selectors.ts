import type { ChatItem, ConvState, PendingPermission, ToolCallView } from './types'

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
