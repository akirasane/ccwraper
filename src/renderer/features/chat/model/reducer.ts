import type { Block, SessionEvent } from '@shared/events'
import type { AssistantPart, ChatItem, ChatTarget, ConvState, PendingPermission, ToolCallView } from './types'

export function createConvState(target: ChatTarget): ConvState {
  return {
    convId: target.convId,
    cwd: target.cwd,
    ...(target.localId ? { localId: target.localId } : {}),
    ...(target.resumeSessionId ? { resumeSessionId: target.resumeSessionId } : {}),
    items: [],
    tools: {},
    pending: [],
    meta: { tools: [], mcp: [], slashCommands: [] },
    status: 'idle',
    tasks: {},
    session: { workMs: 0, apiMs: 0, turns: 0 },
    seq: 0
  }
}

type AssistantItem = Extract<ChatItem, { kind: 'assistant' }>

function sameInput(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** Index of the last streaming assistant item for msgId, or -1. */
function findStreaming(items: ChatItem[], msgId: string): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!
    if (it.kind === 'assistant' && it.streaming && it.msgId === msgId) return i
  }
  return -1
}

function appendDelta(conv: ConvState, msgId: string, kind: 'text' | 'thinking', text: string, now: number): ConvState {
  const items = conv.items.slice()
  let idx = findStreaming(items, msgId)
  let seq = conv.seq
  if (idx < 0) {
    items.push({ kind: 'assistant', id: `i${++seq}`, msgId, parts: [], streaming: true })
    idx = items.length - 1
  }
  const item = items[idx] as AssistantItem
  const parts: AssistantPart[] = item.parts.slice()
  const last = parts[parts.length - 1]
  if (kind === 'text') {
    // Thinking ends once text starts.
    if (last?.kind === 'thinking' && last.endedAt === undefined) parts[parts.length - 1] = { ...last, endedAt: now }
    const tail = parts[parts.length - 1]
    if (tail?.kind === 'text') parts[parts.length - 1] = { kind: 'text', text: tail.text + text }
    else parts.push({ kind: 'text', text })
  } else if (last?.kind === 'thinking' && last.endedAt === undefined) {
    parts[parts.length - 1] = { ...last, text: last.text + text }
  } else parts.push({ kind: 'thinking', text, startedAt: now })
  items[idx] = { ...item, parts }
  return { ...conv, items, seq }
}

function upsertTool(
  conv: ConvState,
  t: { toolUseId: string; name: string; input: unknown; parentToolUseId?: string },
  now: number
): { conv: ConvState; item?: ChatItem } {
  const existing = conv.tools[t.toolUseId]
  if (existing) {
    const tools = { ...conv.tools, [t.toolUseId]: { ...existing, name: t.name, input: t.input } }
    return { conv: { ...conv, tools } }
  }
  const view: ToolCallView = {
    toolUseId: t.toolUseId,
    name: t.name,
    input: t.input,
    status: 'running',
    startedAt: now,
    ...(t.parentToolUseId ? { parentToolUseId: t.parentToolUseId } : {})
  }
  const seq = conv.seq + 1
  const item: ChatItem = {
    kind: 'tool',
    id: `i${seq}`,
    toolUseId: t.toolUseId,
    ...(t.parentToolUseId ? { parentToolUseId: t.parentToolUseId } : {})
  }
  return { conv: { ...conv, tools: { ...conv.tools, [t.toolUseId]: view }, seq }, item }
}

function finalizeAssistant(
  conv: ConvState,
  msgId: string,
  blocks: Block[],
  parentToolUseId: string | undefined,
  now: number
): ConvState {
  const streamIdx = findStreaming(conv.items, msgId)
  const streamed = streamIdx >= 0 ? (conv.items[streamIdx] as AssistantItem) : undefined
  let next: ConvState = conv
  const out: ChatItem[] = []
  let group: AssistantPart[] = []
  let reusedId = streamed?.id
  const flush = (): void => {
    if (group.length === 0) return
    let id = reusedId
    reusedId = undefined
    if (!id) {
      next = { ...next, seq: next.seq + 1 }
      id = `i${next.seq}`
    }
    out.push({
      kind: 'assistant',
      id,
      msgId,
      parts: group,
      streaming: false,
      ...(parentToolUseId ? { parentToolUseId } : {})
    })
    group = []
  }
  for (const b of blocks) {
    if (b.type === 'text') group.push({ kind: 'text', text: b.text })
    else if (b.type === 'thinking') {
      const prior = streamed?.parts.find((p) => p.kind === 'thinking')
      const startedAt = prior?.kind === 'thinking' ? prior.startedAt : undefined
      const endedAt = prior?.kind === 'thinking' ? (prior.endedAt ?? now) : now
      group.push({
        kind: 'thinking',
        text: b.text,
        ...(startedAt !== undefined ? { startedAt } : {}),
        endedAt
      })
    } else {
      flush()
      const r = upsertTool(next, { ...b, ...(parentToolUseId ? { parentToolUseId } : {}) }, now)
      next = r.conv
      if (r.item) out.push(r.item)
    }
  }
  flush()
  // Streamed kinds the final message did not carry stay streaming (the SDK may split one message id across events).
  if (streamed) {
    const hasText = blocks.some((b) => b.type === 'text')
    const hasThinking = blocks.some((b) => b.type === 'thinking')
    const leftover = streamed.parts.filter((p) => (p.kind === 'text' ? !hasText : !hasThinking))
    if (leftover.length > 0) {
      next = { ...next, seq: next.seq + 1 }
      out.push({ kind: 'assistant', id: `i${next.seq}`, msgId, parts: leftover, streaming: true })
    }
  }
  const items = next.items.slice()
  if (streamIdx >= 0) items.splice(streamIdx, 1, ...out)
  else items.push(...out)
  return { ...next, items }
}

function stopStreaming(conv: ConvState, now: number): ConvState {
  if (!conv.items.some((i) => i.kind === 'assistant' && i.streaming)) return conv
  const items = conv.items.map((i): ChatItem => {
    if (i.kind !== 'assistant' || !i.streaming) return i
    return {
      ...i,
      streaming: false,
      parts: i.parts.map((p) => (p.kind === 'thinking' && p.endedAt === undefined ? { ...p, endedAt: now } : p))
    }
  })
  return { ...conv, items }
}

/** Ends the turn: stops streaming; when interrupted also fails unfinished tools and drops pending permissions. */
function endTurn(conv: ConvState, now: number, interrupted: boolean): ConvState {
  let next = stopStreaming(conv, now)
  if (interrupted) {
    const tools: Record<string, ToolCallView> = {}
    let changed = false
    for (const [id, t] of Object.entries(next.tools)) {
      if (t.status === 'running' || t.status === 'needs_approval') {
        changed = true
        const { reqId: _r, ...rest } = t
        tools[id] = { ...rest, status: 'error', result: t.result ?? 'Interrupted', endedAt: now }
      } else tools[id] = t
    }
    if (changed) next = { ...next, tools }
    if (next.pending.length > 0) next = { ...next, pending: [] }
  }
  return next
}

/** Pure reducer. `now` is injected so tests are deterministic; the store passes Date.now(). */
export function reduce(conv: ConvState, e: SessionEvent, now = 0): ConvState {
  switch (e.t) {
    case 'init':
      // Replace-not-append: init is re-emitted every turn.
      return {
        ...conv,
        meta: {
          sessionId: e.sessionId,
          model: e.model,
          tools: e.tools,
          mcp: e.mcp,
          slashCommands: e.slashCommands,
          cwd: e.cwd,
          ...(e.permissionMode ? { permissionMode: e.permissionMode } : {})
        }
      }
    case 'user_message': {
      const seq = conv.seq + 1
      return { ...conv, seq, items: [...conv.items, { kind: 'user', id: `i${seq}`, text: e.text }] }
    }
    case 'text_delta':
      return appendDelta(conv, e.msgId, 'text', e.text, now)
    case 'thinking_delta':
      return appendDelta(conv, e.msgId, 'thinking', e.text, now)
    case 'assistant_message':
      return finalizeAssistant(conv, e.msgId, e.blocks, e.parentToolUseId, now)
    case 'tool_use': {
      const r = upsertTool(conv, e, now)
      return r.item ? { ...r.conv, items: [...r.conv.items, r.item] } : r.conv
    }
    case 'tool_result': {
      const t = conv.tools[e.toolUseId]
      if (!t) return conv
      const { reqId: _r, ...rest } = t
      const view: ToolCallView = { ...rest, status: e.isError ? 'error' : 'done', result: e.content, endedAt: now }
      const pending = t.reqId ? conv.pending.filter((p) => p.reqId !== t.reqId) : conv.pending
      return { ...conv, tools: { ...conv.tools, [e.toolUseId]: view }, pending }
    }
    case 'permission_request': {
      const match = Object.values(conv.tools).find(
        (t) => t.status === 'running' && t.name === e.toolName && sameInput(t.input, e.input)
      )
      const req: PendingPermission = {
        reqId: e.reqId,
        toolName: e.toolName,
        input: e.input,
        ...(e.title ? { title: e.title } : {}),
        ...(e.ruleLabel ? { ruleLabel: e.ruleLabel } : {}),
        ...(e.ruleLabels?.length ? { ruleLabels: e.ruleLabels } : e.ruleLabel ? { ruleLabels: [e.ruleLabel] } : {}),
        ...(match ? { toolUseId: match.toolUseId } : {})
      }
      const pending = [...conv.pending.filter((p) => p.reqId !== e.reqId), req]
      const tools = match
        ? { ...conv.tools, [match.toolUseId]: { ...match, status: 'needs_approval' as const, reqId: e.reqId } }
        : conv.tools
      return { ...conv, pending, tools }
    }
    case 'status': {
      const next: ConvState = { ...conv, status: e.state }
      // idle after a turn = finished or interrupted; anything unfinished is dead.
      return e.state === 'idle' ? endTurn(next, now, true) : next
    }
    case 'result': {
      const next = endTurn(conv, now, false)
      // An interrupted turn reports an error result with zero usage and zero cost: keep the last real
      // context usage and cost instead of dropping the meters to 0.
      const u = e.usage
      const noUsage = u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreationTokens === 0
      const prev = e.isError && noUsage ? conv.lastResult : undefined
      const contextWindow = e.contextWindow ?? prev?.contextWindow
      return {
        ...next,
        status: next.status === 'error' ? 'error' : 'idle',
        lastResult: {
          costUsd: prev ? Math.max(prev.costUsd, e.costUsd) : e.costUsd,
          durationMs: e.durationMs,
          turns: e.turns,
          usage: prev ? prev.usage : e.usage,
          isError: e.isError,
          ...(contextWindow !== undefined ? { contextWindow } : {}),
          ...(e.resultText !== undefined ? { resultText: e.resultText } : {})
        }
      }
    }
    case 'error': {
      const seq = conv.seq + 1
      return {
        ...conv,
        seq,
        status: 'error',
        items: [...conv.items, { kind: 'error', id: `i${seq}`, message: e.message }]
      }
    }
    // P3 live-activity events: WP2 implements these (usage, tasks, tool progress). No-ops until then.
    case 'usage_live':
    case 'task_started':
    case 'task_progress':
    case 'task_updated':
    case 'task_ended':
    case 'tool_progress':
      return conv
  }
}

/** Optimistic local user prompt (live sessions do not echo it). */
export function addUserItem(conv: ConvState, text: string): ConvState {
  const seq = conv.seq + 1
  return { ...conv, seq, status: 'running', items: [...conv.items, { kind: 'user', id: `i${seq}`, text }] }
}

/** Drop a pending permission after the user answered it. */
export function resolvePermission(conv: ConvState, reqId: string, decision: 'allow' | 'deny', now = 0): ConvState {
  const req = conv.pending.find((p) => p.reqId === reqId)
  if (!req) return conv
  const pending = conv.pending.filter((p) => p.reqId !== reqId)
  const t = req.toolUseId ? conv.tools[req.toolUseId] : undefined
  if (!t) return { ...conv, pending }
  const { reqId: _r, ...rest } = t
  const view: ToolCallView =
    decision === 'allow' ? { ...rest, status: 'running' } : { ...rest, status: 'error', result: 'Denied', endedAt: now }
  return { ...conv, pending, tools: { ...conv.tools, [t.toolUseId]: view } }
}

export function reduceAll(conv: ConvState, events: SessionEvent[], now = 0): ConvState {
  return events.reduce((c, e) => reduce(c, e, now), conv)
}
