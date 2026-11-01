// The ONLY file that imports @anthropic-ai/claude-agent-sdk. Maps SDK messages -> SessionEvent.
// Types are imported with `import type` (erased); the runtime module is loaded lazily with
// dynamic import() because the SDK is ESM-only and the main bundle is CJS.
import { randomUUID } from 'node:crypto'
import type {
  Options,
  PermissionUpdate,
  PermissionMode as SdkPermissionMode,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { ModelOption } from '../../shared/config'
import type { Block, SessionEvent, SlashCommandInfo, Usage } from '../../shared/events'
import { limitTypeFromText, looksLikeUsageLimit, normalizeResetsAt, parseLimitReset } from '../../shared/rate-limit'
import { resolveClaudeExecutable } from '../paths'

export type PermissionModeName = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'

export const BYPASS_DISABLED = 'Bypass mode is disabled. Turn on "Allow Bypass mode" in Preferences first.'

export type QueryImpl = (p: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query

export type RememberScope = 'once' | 'session' | 'always' | 'user'

export interface AdapterOptions {
  cwd: string
  model?: string
  permissionMode?: PermissionModeName
  /** Preference gate: only then is allowDangerouslySkipPermissions passed (needed for Bypass at start or via setPermissionMode). */
  allowBypass?: boolean
  /** Pass `--chrome` to the CLI (Claude in Chrome). */
  chrome?: boolean
  resumeId?: string
  fork?: boolean
  /** Override binary path; otherwise resolved via resolveClaudeExecutable(). */
  claudePath?: string
  /** Defaults to ['user','project','local'] (SDK loads none by default). */
  settingSources?: Array<'user' | 'project' | 'local'>
  /** Request adaptive thinking (summarized) so thinking blocks/deltas are produced. */
  thinking?: boolean
  /** Raw SDK message tap (spike/fixture recording). */
  onRaw?: (m: unknown) => void
  /** Test seam: replaces the SDK's query(). */
  queryImpl?: QueryImpl
  /** CLI stderr lines (useful because spawn failures are reported generically). */
  onStderr?: (line: string) => void
  /** Initial prompt. Further prompts via send(). */
  prompt: string
  onEvent: (e: SessionEvent) => void
  /** Every SDK `rate_limit_info` (feeds the status-bar usage limits); independent of the rate_limited event. */
  onRateLimitInfo?: (info: unknown) => void
}

export interface AdapterSession {
  send(text: string): void
  interrupt(): Promise<void>
  setModel(model: string): Promise<void>
  setPermissionMode(mode: PermissionModeName): Promise<void>
  supportedModels(): Promise<ModelOption[]>
  /** Stop one background task / subagent; the CLI answers with task_notification status `stopped`. */
  stopTask(taskId: string): Promise<void>
  replyPermission(
    reqId: string,
    decision: 'allow' | 'deny',
    remember?: RememberScope,
    updatedInput?: Record<string, unknown>
  ): void
  /** Resolves when the SDK message loop ends. */
  done: Promise<void>
  close(): void
}

/** Minimal push-based async iterable feeding SDK streaming-input mode. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = []
  private waiter: ((r: IteratorResult<SDKUserMessage>) => void) | null = null
  private closed = false
  push(text: string): void {
    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null
    }
    if (this.waiter) {
      const w = this.waiter
      this.waiter = null
      w({ value: msg, done: false })
    } else this.items.push(msg)
  }
  close(): void {
    this.closed = true
    if (this.waiter) {
      this.waiter({ value: undefined, done: true })
      this.waiter = null
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((res) => (this.waiter = res))
      }
    }
  }
}

/** SDK SlashCommand[] -> plain SlashCommandInfo[]; undefined when the payload is not a list. */
export function normalizeCommands(raw: unknown): SlashCommandInfo[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: SlashCommandInfo[] = []
  for (const c of raw as Array<Record<string, unknown>>) {
    if (!c || typeof c['name'] !== 'string' || !c['name']) continue
    out.push({
      name: c['name'].replace(/^\//, ''),
      description: typeof c['description'] === 'string' ? c['description'] : '',
      argumentHint: typeof c['argumentHint'] === 'string' ? c['argumentHint'] : '',
      ...(Array.isArray(c['aliases']) ? { aliases: (c['aliases'] as unknown[]).filter((a): a is string => typeof a === 'string') } : {}),
      ...(c['builtin'] === true ? { builtin: true } : {})
    })
  }
  return out
}

function mapUsage(u: unknown): Usage {
  const x = (u ?? {}) as Record<string, unknown>
  const n = (k: string): number => (typeof x[k] === 'number' ? (x[k] as number) : 0)
  return {
    inputTokens: n('input_tokens'),
    outputTokens: n('output_tokens'),
    cacheReadTokens: n('cache_read_input_tokens'),
    cacheCreationTokens: n('cache_creation_input_tokens')
  }
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        const b = c as { type?: string; text?: string; source?: { media_type?: string } }
        if (b.type === 'text' && typeof b.text === 'string') return b.text
        // Never inline base64 image payloads into the transcript text.
        if (b.type === 'image') return `[image${b.source?.media_type ? `: ${b.source.media_type}` : ''}]`
        return JSON.stringify(c)
      })
      .join('\n')
  }
  return content == null ? '' : JSON.stringify(content)
}

/** Human label for the rule an "always allow" would write, e.g. `Bash(npm test:*)`. */
export function ruleLabelsFrom(suggestions: PermissionUpdate[] | undefined): string[] {
  const labels: string[] = []
  for (const s of suggestions ?? []) {
    if (s.type !== 'addRules') continue
    for (const rule of s.rules) {
      const label = rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName
      if (!labels.includes(label)) labels.push(label)
    }
  }
  return labels
}

/** First rule label (legacy single-label field). */
export function ruleLabelFrom(suggestions: PermissionUpdate[] | undefined): string | undefined {
  return ruleLabelsFrom(suggestions)[0]
}

/** Build the SDK permission result for a user decision (D5 remember scopes). */
export function buildPermissionResult(
  decision: 'allow' | 'deny',
  remember: RememberScope | undefined,
  suggestions: PermissionUpdate[] | undefined,
  updatedInput?: Record<string, unknown>
): PermissionResult {
  if (decision === 'deny') return { behavior: 'deny', message: 'Denied by user' }
  const dest =
    remember === 'always'
      ? 'localSettings'
      : remember === 'user'
        ? 'userSettings'
        : remember === 'session'
          ? 'session'
          : undefined
  // Only persist rules. Other suggestions (e.g. setMode acceptEdits for Write/Edit) would silently change the
  // user's default mode, which "Always allow <rule>" must not do.
  const rules = suggestions?.filter((s) => s.type === 'addRules')
  const updatedPermissions =
    dest && rules?.length ? rules.map((s) => ({ ...s, destination: dest }) as PermissionUpdate) : undefined
  return {
    behavior: 'allow',
    ...(updatedInput ? { updatedInput } : {}),
    ...(updatedPermissions ? { updatedPermissions } : {})
  }
}

function pickContextWindow(m: { modelUsage?: unknown }, model: string | undefined): number | undefined {
  const mu = (m.modelUsage ?? {}) as Record<string, { contextWindow?: number }>
  const own = model ? mu[model]?.contextWindow : undefined
  if (typeof own === 'number' && own > 0) return own
  const all = Object.values(mu)
    .map((u) => u?.contextWindow)
    .filter((n): n is number => typeof n === 'number' && n > 0)
  return all.length ? Math.max(...all) : undefined
}

export type UsageLiveEvent = Extract<SessionEvent, { t: 'usage_live' }>

interface CallRec {
  usage: Usage
  startOut: number
  chars: number
  thinkingEst: number
  outExact?: number
}

export interface AccumulatorOptions {
  emit: (e: UsageLiveEvent) => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  intervalMs?: number
}

/**
 * Per-turn token accounting (D2). Calls are keyed by (parent, message id). Output is an estimate
 * (ceil(chars / 4), or the thinking_tokens estimate when larger) until the call's message_delta
 * delivers the exact value. Context = the latest MAIN-thread call. Emission: immediately on
 * message_start / message_delta, throttled (with trailing flush) while deltas stream.
 */
export class TurnUsageAccumulator {
  private calls = new Map<string, CallRec>()
  private current = new Map<string, CallRec>()
  private lastEmit = Number.NEGATIVE_INFINITY
  private timer: unknown = undefined
  private stopped = false
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (h: unknown) => void
  private readonly intervalMs: number

  constructor(private readonly o: AccumulatorOptions) {
    this.now = o.now ?? Date.now
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
    this.intervalMs = o.intervalMs ?? 250
  }

  reset(): void {
    this.cancelTimer()
    this.calls.clear()
    this.current.clear()
    this.lastEmit = Number.NEGATIVE_INFINITY
    this.stopped = false
  }

  messageStart(parent: string, id: string, usage: unknown): void {
    if (this.stopped) return
    const u = mapUsage(usage)
    const rec: CallRec = { usage: u, startOut: u.outputTokens, chars: 0, thinkingEst: 0 }
    this.calls.set(`${parent}\u0000${id}`, rec)
    this.current.set(parent, rec)
    this.emitNow()
  }

  /** Streamed characters (text, thinking, partial_json) for the current call of this parent. */
  delta(parent: string, chars: number): void {
    if (this.stopped) return
    const rec = this.current.get(parent)
    if (!rec || rec.outExact !== undefined) return
    rec.chars += chars
    this.throttled()
  }

  messageDelta(parent: string, usage: unknown): void {
    if (this.stopped) return
    const rec = this.current.get(parent)
    const out = (usage as { output_tokens?: unknown } | undefined)?.output_tokens
    if (!rec || typeof out !== 'number') return
    rec.outExact = out
    this.emitNow()
  }

  /** `system thinking_tokens` (main thread): running estimate for the redacted-thinking phase. */
  thinkingTokens(estimated: number): void {
    if (this.stopped) return
    const rec = this.current.get('')
    if (!rec || rec.outExact !== undefined) return
    rec.thinkingEst = Math.max(rec.thinkingEst, estimated)
    this.throttled()
  }

  /** Flush a pending trailing emit and ignore further input until reset(). */
  finish(): void {
    if (this.timer !== undefined) this.emitNow()
    this.stopped = true
  }

  snapshot(): UsageLiveEvent {
    const turn: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
    let exact = true
    for (const r of this.calls.values()) {
      turn.inputTokens += r.usage.inputTokens
      turn.cacheReadTokens += r.usage.cacheReadTokens
      turn.cacheCreationTokens += r.usage.cacheCreationTokens
      turn.outputTokens += outOf(r)
      if (r.outExact === undefined) exact = false
    }
    const main = this.current.get('')
    return {
      t: 'usage_live',
      contextTokens: main ? promptOf(main) : 0,
      contextOutputTokens: main ? outOf(main) : 0,
      contextExact: main ? main.outExact !== undefined : false,
      turn,
      exact,
      apiCalls: this.calls.size
    }
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer)
      this.timer = undefined
    }
  }

  private emitNow(): void {
    this.cancelTimer()
    this.lastEmit = this.now()
    this.o.emit(this.snapshot())
  }

  private throttled(): void {
    const wait = this.intervalMs - (this.now() - this.lastEmit)
    if (wait <= 0) this.emitNow()
    else if (this.timer === undefined) {
      this.timer = this.setTimer(() => {
        this.timer = undefined
        this.emitNow()
      }, wait)
    }
  }
}

function promptOf(r: CallRec): number {
  return r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheCreationTokens
}
function outOf(r: CallRec): number {
  return r.outExact ?? Math.max(Math.ceil(r.chars / 4), r.thinkingEst, r.startOut)
}

export interface MapState {
  /** Main-thread message id (subagent streams never touch it). */
  msgId: string
  model?: string
  acc?: TurnUsageAccumulator
  /** Per-turn usage-limit evidence (WP14); consumed and cleared by the turn's `result`. */
  limit?: { rejected: boolean; resetsAt?: number; limitType?: string; apiError: boolean; text: string }
  /** Test seam: the clock used to parse "resets 4:10pm". */
  now?: () => number
}

function limitEvidence(state: MapState): NonNullable<MapState['limit']> {
  return (state.limit ??= { rejected: false, apiError: false, text: '' })
}

/** Sum result.modelUsage over models (cumulative session, main + subagents). */
function sumModelUsage(modelUsage: unknown): (Usage & { costUsd: number; thinkingTokens?: number }) | undefined {
  const entries = Object.values((modelUsage ?? {}) as Record<string, Record<string, unknown>>)
  if (!entries.length) return undefined
  const num = (o: Record<string, unknown>, k: string): number => (typeof o[k] === 'number' ? (o[k] as number) : 0)
  const sum = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 }
  let thinking: number | undefined
  for (const u of entries) {
    if (!u || typeof u !== 'object') continue
    sum.inputTokens += num(u, 'inputTokens')
    sum.outputTokens += num(u, 'outputTokens')
    sum.cacheReadTokens += num(u, 'cacheReadInputTokens')
    sum.cacheCreationTokens += num(u, 'cacheCreationInputTokens')
    sum.costUsd += num(u, 'costUSD')
    if (typeof u['thinkingTokens'] === 'number') thinking = (thinking ?? 0) + (u['thinkingTokens'] as number)
  }
  return thinking !== undefined ? { ...sum, thinkingTokens: thinking } : sum
}

/** Map result.modelUsage per model (cumulative for this query process). costUsd is the SDK's est. API value. */
function mapModelUsage(modelUsage: unknown): Record<string, Usage & { costUsd: number }> | undefined {
  if (!modelUsage || typeof modelUsage !== 'object') return undefined
  const num = (o: Record<string, unknown>, k: string): number => (typeof o[k] === 'number' ? (o[k] as number) : 0)
  const out: Record<string, Usage & { costUsd: number }> = {}
  for (const [model, u] of Object.entries(modelUsage as Record<string, unknown>)) {
    if (!u || typeof u !== 'object') continue
    const r = u as Record<string, unknown>
    out[model] = {
      inputTokens: num(r, 'inputTokens'),
      outputTokens: num(r, 'outputTokens'),
      cacheReadTokens: num(r, 'cacheReadInputTokens'),
      cacheCreationTokens: num(r, 'cacheCreationInputTokens'),
      costUsd: num(r, 'costUSD')
    }
  }
  return Object.keys(out).length ? out : undefined
}

/** Translate one SDK message into zero or more normalized events. Exported for tests/spike. */
/** `system/status requesting` on the main thread = a new API request is starting. */
function isMainRequestStart(m: SDKMessage): boolean {
  const x = m as { type?: string; subtype?: string; status?: string; parent_tool_use_id?: string | null }
  return x.type === 'system' && x.subtype === 'status' && x.status === 'requesting' && !x.parent_tool_use_id
}

export function mapMessage(m: SDKMessage, state: MapState): SessionEvent[] {
  const out: SessionEvent[] = []
  switch (m.type) {
    case 'system': {
      if (m.subtype === 'init') {
        state.model = m.model
        out.push({
          t: 'init',
          sessionId: m.session_id,
          model: m.model,
          tools: m.tools,
          mcp: m.mcp_servers.map((s) => ({ name: s.name, status: s.status })),
          slashCommands: m.slash_commands,
          cwd: m.cwd,
          permissionMode: m.permissionMode,
          ...(Array.isArray(m.agents) ? { agents: m.agents } : {}),
          ...(Array.isArray(m.skills) ? { skills: m.skills } : {}),
          ...(Array.isArray(m.plugins)
            ? {
                plugins: m.plugins.map((p) => ({
                  name: p.name,
                  path: p.path,
                  ...(p.version ? { version: p.version } : {})
                }))
              }
            : {})
        })
      } else if ((m.subtype as string) === 'commands_changed') {
        const list = normalizeCommands((m as unknown as { commands?: unknown }).commands)
        if (list) out.push({ t: 'commands', commands: list })
      } else if (m.subtype === 'thinking_tokens') {
        state.acc?.thinkingTokens(m.estimated_tokens)
      } else if (m.subtype === 'task_started') {
        out.push({
          t: 'task_started',
          taskId: m.task_id,
          description: m.description,
          ...(m.tool_use_id ? { toolUseId: m.tool_use_id } : {}),
          ...(m.subagent_type ? { subagentType: m.subagent_type } : {}),
          ...(m.task_type ? { taskType: m.task_type } : {}),
          ...(m.parent_task_id ? { parentTaskId: m.parent_task_id } : {}),
          ...(typeof m.spawn_depth === 'number' ? { depth: m.spawn_depth } : {}),
          ...(typeof m.is_backgrounded === 'boolean' ? { background: m.is_backgrounded } : {}),
          ...(m.ambient ? { ambient: true } : {}),
          ...(m.skip_transcript ? { hidden: true } : {})
        })
      } else if (m.subtype === 'task_progress') {
        out.push({
          t: 'task_progress',
          taskId: m.task_id,
          totalTokens: m.usage.total_tokens,
          toolUses: m.usage.tool_uses,
          durationMs: m.usage.duration_ms,
          ...(m.tool_use_id ? { toolUseId: m.tool_use_id } : {}),
          ...(m.last_tool_name ? { lastToolName: m.last_tool_name } : {}),
          ...(m.summary ? { summary: m.summary } : {})
        })
      } else if (m.subtype === 'task_updated') {
        const p = m.patch
        out.push({
          t: 'task_updated',
          taskId: m.task_id,
          ...(p.status ? { status: p.status } : {}),
          ...(p.description ? { description: p.description } : {}),
          ...(p.error ? { error: p.error } : {}),
          ...(typeof p.is_backgrounded === 'boolean' ? { background: p.is_backgrounded } : {})
        })
      } else if (m.subtype === 'task_notification') {
        out.push({
          t: 'task_ended',
          taskId: m.task_id,
          status: m.status,
          ...(m.tool_use_id ? { toolUseId: m.tool_use_id } : {}),
          ...(m.summary ? { summary: m.summary } : {}),
          ...(m.usage
            ? { totalTokens: m.usage.total_tokens, toolUses: m.usage.tool_uses, durationMs: m.usage.duration_ms }
            : {})
        })
      }
      // background_tasks_changed and the rest: intentionally not mapped (D4).
      break
    }
    case 'tool_progress': {
      out.push({
        t: 'tool_progress',
        toolUseId: m.tool_use_id,
        toolName: m.tool_name,
        elapsedMs: Math.round(m.elapsed_time_seconds * 1000),
        ...(m.parent_tool_use_id ? { parentToolUseId: m.parent_tool_use_id } : {}),
        ...(m.task_id ? { taskId: m.task_id } : {})
      })
      break
    }
    case 'stream_event': {
      const ev = m.event as unknown as {
        type: string
        message?: { id?: string; usage?: unknown }
        delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }
        usage?: unknown
      }
      // Main thread = no parent. Subagent streams only feed the accumulator, never the transcript (D4).
      const parentKey = m.parent_tool_use_id ?? ''
      if (ev.type === 'message_start' && ev.message?.id) {
        if (!parentKey) state.msgId = ev.message.id
        state.acc?.messageStart(parentKey, ev.message.id, ev.message.usage)
      } else if (ev.type === 'message_delta') {
        state.acc?.messageDelta(parentKey, ev.usage)
      } else if (ev.type === 'content_block_delta' && ev.delta) {
        const d = ev.delta
        const chars =
          d.type === 'text_delta'
            ? (d.text?.length ?? 0)
            : d.type === 'thinking_delta'
              ? (d.thinking?.length ?? 0)
              : d.type === 'input_json_delta'
                ? (d.partial_json?.length ?? 0)
                : 0
        if (chars) state.acc?.delta(parentKey, chars)
        if (!parentKey) {
          if (d.type === 'text_delta' && d.text) out.push({ t: 'text_delta', msgId: state.msgId, text: d.text })
          else if (d.type === 'thinking_delta' && d.thinking)
            out.push({ t: 'thinking_delta', msgId: state.msgId, text: d.thinking })
        }
      }
      break
    }
    case 'assistant': {
      const parent = m.parent_tool_use_id ?? undefined
      const blocks: Block[] = []
      for (const b of m.message.content as unknown as Array<Record<string, unknown>>) {
        if (b['type'] === 'text') blocks.push({ type: 'text', text: String(b['text'] ?? '') })
        else if (b['type'] === 'thinking') blocks.push({ type: 'thinking', text: String(b['thinking'] ?? '') })
        else if (b['type'] === 'tool_use')
          blocks.push({ type: 'tool_use', toolUseId: String(b['id']), name: String(b['name']), input: b['input'] })
      }
      const ev: SessionEvent = { t: 'assistant_message', msgId: m.message.id, blocks }
      if (parent) ev.parentToolUseId = parent
      out.push(ev)
      for (const b of blocks) {
        if (b.type === 'tool_use') {
          const tu: SessionEvent = { t: 'tool_use', toolUseId: b.toolUseId, name: b.name, input: b.input }
          if (parent) tu.parentToolUseId = parent
          out.push(tu)
        }
      }
      if (m.error) out.push({ t: 'error', message: `assistant error: ${String(m.error)}` })
      if (m.error === 'rate_limit' && !parent) {
        const ev = limitEvidence(state)
        ev.apiError = true
        const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join(' ')
        ev.text = `${ev.text} ${text}`.trim().slice(0, 1000)
      }
      break
    }
    case 'user': {
      const content = m.message.content
      if (Array.isArray(content)) {
        for (const b of content as unknown as Array<Record<string, unknown>>) {
          if (b['type'] === 'tool_result')
            out.push({
              t: 'tool_result',
              toolUseId: String(b['tool_use_id']),
              content: stringifyToolResult(b['content']),
              isError: b['is_error'] === true
            })
        }
      }
      break
    }
    case 'rate_limit_event': {
      const info = m.rate_limit_info
      if (info.status === 'rejected') {
        const ev = limitEvidence(state)
        ev.rejected = true
        const at = normalizeResetsAt(info.resetsAt)
        if (at !== undefined) ev.resetsAt = at
        if (info.rateLimitType) ev.limitType = info.rateLimitType
      } else if (state.limit) {
        // Limit info moved on to allowed: an earlier rejection no longer describes the session.
        state.limit.rejected = false
        delete state.limit.resetsAt
      }
      break
    }
    case 'result': {
      const ev = state.limit
      state.limit = undefined
      if (m.is_error && ev) {
        const resultText = m.subtype === 'success' ? m.result : ''
        const text = `${ev.text} ${resultText}`.trim()
        // A plain API 429 also carries error 'rate_limit'; only a rejected limit event or limit wording counts.
        if (ev.rejected || (ev.apiError && looksLikeUsageLimit(text))) {
          const fromText = ev.resetsAt === undefined ? parseLimitReset(text, (state.now ?? Date.now)()) : undefined
          const resetsAt = ev.resetsAt ?? fromText
          const limitType = ev.limitType ?? limitTypeFromText(text)
          out.push({
            t: 'rate_limited',
            source: ev.resetsAt !== undefined ? 'event' : fromText !== undefined ? 'text' : 'none',
            ...(resetsAt !== undefined ? { resetsAt } : {}),
            ...(limitType ? { limitType } : {})
          })
        }
      }
      const contextWindow = pickContextWindow(m as { modelUsage?: unknown }, state.model)
      const sessionUsage = sumModelUsage((m as { modelUsage?: unknown }).modelUsage)
      const modelUsage = mapModelUsage((m as { modelUsage?: unknown }).modelUsage)
      out.push({
        t: 'result',
        costUsd: m.total_cost_usd,
        durationMs: m.duration_ms,
        turns: m.num_turns,
        usage: mapUsage(m.usage),
        isError: m.is_error,
        ...(typeof m.duration_api_ms === 'number' ? { durationApiMs: m.duration_api_ms } : {}),
        ...(sessionUsage ? { sessionUsage } : {}),
        ...(modelUsage ? { modelUsage } : {}),
        ...(contextWindow ? { contextWindow } : {}),
        ...(m.subtype === 'success' ? { resultText: m.result } : {})
      })
      out.push({ t: 'status', state: m.is_error ? 'error' : 'idle' })
      break
    }
    default:
      break
  }
  return out
}

export async function startSdkSession(opts: AdapterOptions): Promise<AdapterSession> {
  const queryFn: QueryImpl = opts.queryImpl ?? (await import('@anthropic-ai/claude-agent-sdk')).query
  if (opts.permissionMode === 'bypassPermissions' && !opts.allowBypass) throw new Error(BYPASS_DISABLED)
  const input = new InputQueue()
  const pending = new Map<string, { resolve: (r: PermissionResult) => void; suggestions?: PermissionUpdate[] }>()
  const claudePath = opts.claudePath ?? (opts.queryImpl ? undefined : resolveClaudeExecutable())

  const options: Options = {
    cwd: opts.cwd,
    includePartialMessages: true,
    ...(opts.onStderr ? { stderr: opts.onStderr } : {}),
    settingSources: opts.settingSources ?? ['user', 'project', 'local'],
    ...(opts.thinking ? { thinking: { type: 'adaptive' as const, display: 'summarized' as const } } : {}),
    permissionMode: (opts.permissionMode ?? 'default') as SdkPermissionMode,
    ...(opts.allowBypass ? { allowDangerouslySkipPermissions: true } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.resumeId ? { resume: opts.resumeId, forkSession: opts.fork === true } : {}),
    ...(opts.chrome ? { extraArgs: { chrome: null } } : {}),
    ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
    canUseTool: (toolName, toolInput, { signal, title, suggestions }) =>
      new Promise<PermissionResult>((resolve) => {
        const reqId = randomUUID()
        pending.set(reqId, { resolve, ...(suggestions ? { suggestions } : {}) })
        const onAbort = (): void => {
          if (pending.delete(reqId)) resolve({ behavior: 'deny', message: 'aborted', interrupt: true })
        }
        signal.addEventListener('abort', onAbort, { once: true })
        opts.onEvent({ t: 'status', state: 'waiting_permission' })
        const ruleLabels = ruleLabelsFrom(suggestions)
        opts.onEvent({
          t: 'permission_request',
          reqId,
          toolName,
          input: toolInput,
          ...(title ? { title } : {}),
          ...(ruleLabels.length ? { ruleLabel: ruleLabels[0], ruleLabels } : {})
        })
      })
  }

  input.push(opts.prompt)
  opts.onEvent({ t: 'status', state: 'running' })
  const q: Query = queryFn({ prompt: input, options })
  const acc = new TurnUsageAccumulator({ emit: (e) => opts.onEvent(e) })
  const state: MapState = { msgId: '', acc }
  let interrupted = false
  let running = true

  // Full command objects (descriptions, hints, aliases). Best effort: the init event still carries the bare names.
  // supportedCommands() resolves from the initialize handshake, so it does not spend tokens or wait for a prompt.
  try {
    const p = typeof q.supportedCommands === 'function' ? q.supportedCommands() : undefined
    void Promise.resolve(p)
      .then((list) => {
        const commands = normalizeCommands(list)
        if (commands) opts.onEvent({ t: 'commands', commands })
      })
      .catch(() => undefined)
  } catch {
    /* ignore */
  }

  const done = (async () => {
    try {
      for await (const m of q) {
        opts.onRaw?.(m)
        if (m.type === 'rate_limit_event') {
          try {
            opts.onRateLimitInfo?.(m.rate_limit_info)
          } catch {
            /* the status bar is best effort */
          }
        }
        // A turn the CLI starts on its own (a background task finished and Claude reacts to it) has no
        // send(): the first main-thread API request after a result is its start. Without this the UI stays
        // "Idle" while the reply streams and the usage accumulator is still stopped from the last turn.
        if (!running && isMainRequestStart(m)) {
          running = true
          acc.reset()
          opts.onEvent({ t: 'status', state: 'running' })
        }
        if (m.type === 'result') acc.finish()
        for (const e of mapMessage(m, state)) {
          // An interrupted turn ends with an error-subtype result; present it as idle, not error.
          if (interrupted && e.t === 'status' && e.state === 'error') opts.onEvent({ t: 'status', state: 'idle' })
          else opts.onEvent(e)
          if (e.t === 'result') running = false
        }
        if (m.type === 'result') interrupted = false
      }
    } catch (err) {
      opts.onEvent({ t: 'error', message: err instanceof Error ? err.message : String(err) })
      opts.onEvent({ t: 'status', state: 'error' })
    }
    opts.onEvent({ t: 'session_closed' })
  })()

  return {
    send(text) {
      running = true
      acc.reset()
      opts.onEvent({ t: 'status', state: 'running' })
      input.push(text)
    },
    async interrupt() {
      if (!running && pending.size === 0) return
      interrupted = true
      // Release pending permission prompts so the CLI is not left waiting on the UI.
      for (const [id, p] of pending) {
        pending.delete(id)
        p.resolve({ behavior: 'deny', message: 'Interrupted', interrupt: true })
      }
      await q.interrupt()
      opts.onEvent({ t: 'status', state: 'idle' })
    },
    setModel: (model) => q.setModel(model),
    setPermissionMode: (mode) => {
      if (mode === 'bypassPermissions' && !opts.allowBypass) return Promise.reject(new Error(BYPASS_DISABLED))
      return q.setPermissionMode(mode as SdkPermissionMode)
    },
    async supportedModels() {
      const models = await q.supportedModels()
      return models.map((m) => ({
        value: m.value,
        displayName: m.displayName,
        ...(m.description ? { description: m.description } : {}),
        ...(m.resolvedModel ? { resolvedModel: m.resolvedModel } : {})
      }))
    },
    stopTask: (taskId) => q.stopTask(taskId),
    replyPermission(reqId, decision, remember, updatedInput) {
      const p = pending.get(reqId)
      if (!p) return
      pending.delete(reqId)
      p.resolve(buildPermissionResult(decision, remember, p.suggestions, updatedInput))
      opts.onEvent({ t: 'status', state: 'running' })
    },
    done,
    close() {
      for (const [id, p] of pending) {
        p.resolve({ behavior: 'deny', message: 'session closed' })
        pending.delete(id)
      }
      input.close()
      q.close()
    }
  }
}
