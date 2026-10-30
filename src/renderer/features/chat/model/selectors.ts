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

function shallowEq<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

export interface LiveContext {
  used: number
  window: number
  fraction: number
  exact: boolean
  /** the window is a guess (no result or cached value yet): shown with ~ */
  assumed: boolean
}
export interface WorkingState {
  verb: 'working' | 'thinking' | 'tool' | 'approval'
  toolName?: string
  since: number
}

/** The SDK tool that spawns a subagent: `Agent` in current CLIs, legacy `Task`. */
export const isAgentTool = (name: string): boolean => name === 'Agent' || name === 'Task'

// Memo caches keyed on the state slice they derive from, so equal inputs give the same reference.
const topCache = new WeakMap<ChatItem[], { tools: ConvState['tools']; result: ChatItem[] }>()
const childCache = new WeakMap<ChatItem[], Map<string, ChatItem[]>>()
const taskToolCache = new WeakMap<ConvState['tasks'], Map<string, TaskView>>()
const runningCache = new WeakMap<ConvState['tasks'], TaskView[]>()
const lastLive = new Map<string, LiveContext | undefined>()
const lastWorking = new Map<string, WorkingState | undefined>()

/** Top-level items: children of Agent / Task tools (any depth) are shown inside their card instead. */
export function selectTopLevelItems(c: ConvState): ChatItem[] {
  const hit = topCache.get(c.items)
  if (hit && hit.tools === c.tools) return hit.result
  const parentIsAgent = (it: ChatItem): boolean => {
    if (it.kind !== 'assistant' && it.kind !== 'tool') return false
    const p = it.parentToolUseId
    const t = p ? c.tools[p] : undefined
    return !!t && isAgentTool(t.name)
  }
  const filtered = c.items.filter((it) => !parentIsAgent(it))
  const result = filtered.length === c.items.length ? c.items : filtered
  // Tools churn on every result; keep the old array when nothing visible changed.
  const keep = hit && shallowEq(hit.result, result) ? hit.result : result
  topCache.set(c.items, { tools: c.tools, result: keep })
  return keep
}

/** Direct children (items whose parentToolUseId is `toolUseId`). */
export function selectChildItems(c: ConvState, toolUseId: string): ChatItem[] {
  let map = childCache.get(c.items)
  if (!map) {
    map = new Map()
    for (const it of c.items) {
      if ((it.kind !== 'assistant' && it.kind !== 'tool') || !it.parentToolUseId) continue
      const list = map.get(it.parentToolUseId)
      if (list) list.push(it)
      else map.set(it.parentToolUseId, [it])
    }
    childCache.set(c.items, map)
  }
  return map.get(toolUseId) ?? EMPTY_ITEMS
}

/** The task spawned by this tool call. */
export function selectTaskForTool(c: ConvState, toolUseId: string): TaskView | undefined {
  let map = taskToolCache.get(c.tasks)
  if (!map) {
    map = new Map()
    for (const t of Object.values(c.tasks)) if (t.toolUseId) map.set(t.toolUseId, t)
    taskToolCache.set(c.tasks, map)
  }
  return map.get(toolUseId)
}

/** Live tasks, excluding ambient and hidden ones. */
export function selectRunningTasks(c: ConvState): TaskView[] {
  const hit = runningCache.get(c.tasks)
  if (hit) return hit
  const list = Object.values(c.tasks).filter(
    (t) =>
      !t.ambient &&
      !t.hidden &&
      (t.status === 'running' || t.status === 'pending' || t.status === 'stopping' || t.status === 'paused')
  )
  const result = list.length === 0 ? EMPTY_TASKS : list
  runningCache.set(c.tasks, result)
  return result
}

/** Context from the latest main-thread usage_live (not result.usage); falls back to the last result. */
export function selectLiveContext(c: ConvState, fallbackWindow?: number, assumedWindow?: number): LiveContext | undefined {
  const known = c.lastResult?.contextWindow ?? fallbackWindow
  const assumed = !known && !!assumedWindow
  const window = known ?? assumedWindow
  let value: LiveContext | undefined
  if (window) {
    const t = c.turn?.contextTokens ? c.turn : c.lastTurn?.contextTokens ? c.lastTurn : undefined
    if (t?.contextTokens) {
      value = {
        used: t.contextTokens,
        window,
        fraction: Math.min(1, t.contextTokens / window),
        exact: t.contextExact === true,
        assumed
      }
    } else {
      const f = selectContextUsage(c)
      if (f !== undefined && c.lastResult) {
        const u = c.lastResult.usage
        value = { used: u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens, window, fraction: f, exact: false, assumed }
      }
    }
  }
  const prev = lastLive.get(c.convId)
  if (prev && value && prev.used === value.used && prev.window === value.window && prev.exact === value.exact && prev.assumed === value.assumed) return prev
  lastLive.set(c.convId, value)
  return value
}

/** The live turn, else the last one. */
export const selectTurnSummary = (c: ConvState): TurnActivity | undefined => c.turn ?? c.lastTurn

/** What the working row should say, or undefined when idle. */
export function selectWorkingState(c: ConvState): WorkingState | undefined {
  let value: WorkingState | undefined
  if (selectIsRunning(c)) {
    const since = c.turn?.startedAt ?? 0
    if (c.status === 'waiting_permission' || c.pending.length > 0) {
      const tn = c.pending[0]?.toolName
      value = { verb: 'approval', ...(tn ? { toolName: tn } : {}), since }
    } else {
      let running: ToolCallView | undefined
      for (const t of Object.values(c.tools)) {
        if (t.status === 'running' && (!running || (t.startedAt ?? 0) >= (running.startedAt ?? 0))) running = t
      }
      const last = c.items[c.items.length - 1]
      const lastPart = last?.kind === 'assistant' && last.streaming ? last.parts[last.parts.length - 1] : undefined
      if (running) value = { verb: 'tool', toolName: running.name, since: running.startedAt ?? since }
      else if (lastPart?.kind === 'thinking' && lastPart.endedAt === undefined)
        value = { verb: 'thinking', since: lastPart.startedAt ?? since }
      else value = { verb: 'working', since }
    }
  }
  const prev = lastWorking.get(c.convId)
  if (prev && value && prev.verb === value.verb && prev.toolName === value.toolName && prev.since === value.since) return prev
  lastWorking.set(c.convId, value)
  return value
}


/** Tokens spent by subagents this turn (live tasks plus tasks started this turn); the turn usage excludes them. */
export function selectSubagentTokens(c: ConvState): number {
  const since = (c.turn ?? c.lastTurn)?.startedAt ?? 0
  let sum = 0
  for (const t of Object.values(c.tasks)) {
    if (t.ambient || t.hidden || t.totalTokens === undefined) continue
    const live = t.status === 'running' || t.status === 'pending' || t.status === 'stopping' || t.status === 'paused'
    if (live || t.startedAt >= since) sum += t.totalTokens
  }
  return sum
}
