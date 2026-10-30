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
import type { Block, SessionEvent, Usage } from '../../shared/events'
import { resolveClaudeExecutable } from '../paths'

export type PermissionModeName = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'

export type QueryImpl = (p: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query

export type RememberScope = 'once' | 'session' | 'always' | 'user'

export interface AdapterOptions {
  cwd: string
  model?: string
  permissionMode?: PermissionModeName
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
}

export interface AdapterSession {
  send(text: string): void
  interrupt(): Promise<void>
  setModel(model: string): Promise<void>
  setPermissionMode(mode: PermissionModeName): Promise<void>
  supportedModels(): Promise<ModelOption[]>
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

/** Translate one SDK message into zero or more normalized events. Exported for tests/spike. */
export function mapMessage(m: SDKMessage, state: { msgId: string; model?: string }): SessionEvent[] {
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
          permissionMode: m.permissionMode
        })
      }
      break
    }
    case 'stream_event': {
      const ev = m.event as unknown as {
        type: string
        message?: { id?: string }
        delta?: { type?: string; text?: string; thinking?: string }
      }
      if (ev.type === 'message_start' && ev.message?.id) state.msgId = ev.message.id
      else if (ev.type === 'content_block_delta' && ev.delta) {
        if (ev.delta.type === 'text_delta' && ev.delta.text)
          out.push({ t: 'text_delta', msgId: state.msgId, text: ev.delta.text })
        else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking)
          out.push({ t: 'thinking_delta', msgId: state.msgId, text: ev.delta.thinking })
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
    case 'result': {
      const contextWindow = pickContextWindow(m as { modelUsage?: unknown }, state.model)
      out.push({
        t: 'result',
        costUsd: m.total_cost_usd,
        durationMs: m.duration_ms,
        turns: m.num_turns,
        usage: mapUsage(m.usage),
        isError: m.is_error,
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
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.resumeId ? { resume: opts.resumeId, forkSession: opts.fork === true } : {}),
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
  const state: { msgId: string; model?: string } = { msgId: '' }
  let interrupted = false
  let running = true

  const done = (async () => {
    try {
      for await (const m of q) {
        opts.onRaw?.(m)
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
  })()

  return {
    send(text) {
      running = true
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
    setPermissionMode: (mode) => q.setPermissionMode(mode as SdkPermissionMode),
    async supportedModels() {
      const models = await q.supportedModels()
      return models.map((m) => ({
        value: m.value,
        displayName: m.displayName,
        ...(m.description ? { description: m.description } : {})
      }))
    },
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
