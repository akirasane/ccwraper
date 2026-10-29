// The ONLY file that imports @anthropic-ai/claude-agent-sdk. Maps SDK messages -> SessionEvent.
// Types are imported with `import type` (erased); the runtime module is loaded lazily with
// dynamic import() because the SDK is ESM-only and the main bundle is CJS.
import { randomUUID } from 'node:crypto'
import type {
  Options,
  PermissionMode as SdkPermissionMode,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { Block, SessionEvent, Usage } from '../../shared/events'
import { resolveClaudeExecutable } from '../paths'

export type PermissionModeName = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'

export interface AdapterOptions {
  cwd: string
  model?: string
  permissionMode?: PermissionModeName
  resumeId?: string
  fork?: boolean
  /** Override binary path; otherwise resolved via resolveClaudeExecutable(). */
  claudePath?: string
  /** Initial prompt. Further prompts via send(). */
  prompt: string
  onEvent: (e: SessionEvent) => void
}

export interface AdapterSession {
  send(text: string): void
  interrupt(): Promise<void>
  setModel(model: string): Promise<void>
  setPermissionMode(mode: PermissionModeName): Promise<void>
  replyPermission(reqId: string, decision: 'allow' | 'deny', updatedInput?: Record<string, unknown>): void
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
        const b = c as { type?: string; text?: string }
        return b.type === 'text' && typeof b.text === 'string' ? b.text : JSON.stringify(c)
      })
      .join('\n')
  }
  return content == null ? '' : JSON.stringify(content)
}

/** Translate one SDK message into zero or more normalized events. Exported for tests/spike. */
export function mapMessage(m: SDKMessage, state: { msgId: string }): SessionEvent[] {
  const out: SessionEvent[] = []
  switch (m.type) {
    case 'system': {
      if (m.subtype === 'init') {
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
      out.push({
        t: 'result',
        costUsd: m.total_cost_usd,
        durationMs: m.duration_ms,
        turns: m.num_turns,
        usage: mapUsage(m.usage),
        isError: m.is_error,
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
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const input = new InputQueue()
  const pending = new Map<string, (r: PermissionResult) => void>()
  const claudePath = opts.claudePath ?? resolveClaudeExecutable()

  const options: Options = {
    cwd: opts.cwd,
    includePartialMessages: true,
    settingSources: ['user', 'project', 'local'],
    permissionMode: (opts.permissionMode ?? 'default') as SdkPermissionMode,
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.resumeId ? { resume: opts.resumeId, forkSession: opts.fork === true } : {}),
    ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
    canUseTool: (toolName, toolInput, { signal, title }) =>
      new Promise<PermissionResult>((resolve) => {
        const reqId = randomUUID()
        pending.set(reqId, resolve)
        const onAbort = (): void => {
          if (pending.delete(reqId)) resolve({ behavior: 'deny', message: 'aborted', interrupt: true })
        }
        signal.addEventListener('abort', onAbort, { once: true })
        opts.onEvent({ t: 'status', state: 'waiting_permission' })
        opts.onEvent({
          t: 'permission_request',
          reqId,
          toolName,
          input: toolInput,
          ...(title ? { title } : {})
        })
      })
  }

  input.push(opts.prompt)
  opts.onEvent({ t: 'status', state: 'running' })
  const q: Query = sdk.query({ prompt: input, options })
  const state = { msgId: '' }

  const done = (async () => {
    try {
      for await (const m of q) {
        for (const e of mapMessage(m, state)) opts.onEvent(e)
      }
    } catch (err) {
      opts.onEvent({ t: 'error', message: err instanceof Error ? err.message : String(err) })
      opts.onEvent({ t: 'status', state: 'error' })
    }
  })()

  return {
    send(text) {
      opts.onEvent({ t: 'status', state: 'running' })
      input.push(text)
    },
    async interrupt() {
      await q.interrupt()
      opts.onEvent({ t: 'status', state: 'idle' })
    },
    setModel: (model) => q.setModel(model),
    setPermissionMode: (mode) => q.setPermissionMode(mode as SdkPermissionMode),
    replyPermission(reqId, decision, updatedInput) {
      const r = pending.get(reqId)
      if (!r) return
      pending.delete(reqId)
      r(
        decision === 'allow'
          ? { behavior: 'allow', ...(updatedInput ? { updatedInput } : {}) }
          : { behavior: 'deny', message: 'Denied by user' }
      )
      opts.onEvent({ t: 'status', state: 'running' })
    },
    done,
    close() {
      for (const [id, r] of pending) {
        r({ behavior: 'deny', message: 'session closed' })
        pending.delete(id)
      }
      input.close()
      q.close()
    }
  }
}
