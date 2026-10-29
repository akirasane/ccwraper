// Second SDK boundary file (plan D6): wraps the SDK's history API (listSessions / getSessionMessages)
// and maps stored transcript messages to SessionEvent. SDK types never leave this file.
// Dynamic import() because the SDK is ESM-only and the main bundle is CJS.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { SessionEvent } from '../../shared/events'
import { mapMessage } from './sdk-adapter'

/** Structural copy of the SDK's SDKSessionInfo fields we use. */
export interface RawSessionInfo {
  sessionId: string
  summary: string
  lastModified: number
  fileSize?: number
  customTitle?: string
  firstPrompt?: string
  gitBranch?: string
  cwd?: string
  createdAt?: number
}

/** Structural copy of the SDK's SessionMessage. */
export interface RawSessionMessage {
  type: 'user' | 'assistant' | 'system'
  uuid: string
  session_id: string
  message: unknown
  parent_tool_use_id: string | null
}

export interface HistoryApi {
  listSessions(opts?: { dir?: string; includeWorktrees?: boolean }): Promise<RawSessionInfo[]>
  getSessionMessages(sessionId: string, opts?: { dir?: string }): Promise<RawSessionMessage[]>
}

/** The real SDK-backed implementation. */
export async function loadSdkHistory(): Promise<HistoryApi> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  return {
    listSessions: (opts) => sdk.listSessions(opts) as Promise<RawSessionInfo[]>,
    getSessionMessages: (id, opts) => sdk.getSessionMessages(id, opts) as Promise<RawSessionMessage[]>
  }
}

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g
const COMMAND_NAME_RE = /<command-name>([\s\S]*?)<\/command-name>/
const COMMAND_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/

/**
 * Turn the text of a stored user turn into a displayable prompt, or undefined if it is a meta
 * wrapper (system reminders, local command output/caveats, interrupts).
 * `<command-name>/foo</command-name>` wrappers are compacted to "/foo args".
 */
export function userPromptText(raw: string): string | undefined {
  let text = raw.replace(SYSTEM_REMINDER_RE, '').trim()
  if (!text) return undefined
  const cmd = COMMAND_NAME_RE.exec(text)
  if (cmd) {
    const name = (cmd[1] ?? '').trim()
    const args = (COMMAND_ARGS_RE.exec(text)?.[1] ?? '').trim()
    text = [name, args].filter(Boolean).join(' ')
    return text || undefined
  }
  if (/^<(local-command-[a-z]+|command-message|bash-(input|stdout|stderr))>/.test(text)) return undefined
  if (/^\[Request interrupted/.test(text)) return undefined
  return text
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
}

/** Map one stored message to events. Tolerant: unknown shapes and blocks yield nothing, never throw. */
export function mapHistoryMessage(m: RawSessionMessage): SessionEvent[] {
  try {
    const inner = asRecord(m.message)
    if (!inner) return []
    if (m.type === 'assistant') {
      if (!Array.isArray(inner['content'])) return []
      return mapMessage(m as unknown as SDKMessage, { msgId: String(inner['id'] ?? m.uuid) })
    }
    if (m.type === 'user') {
      const out: SessionEvent[] = []
      const content = inner['content']
      const sub = m.parent_tool_use_id != null // subagent prompt: not a user prompt
      if (typeof content === 'string') {
        const text = sub ? undefined : userPromptText(content)
        if (text) out.push({ t: 'user_message', text, uuid: m.uuid })
      } else if (Array.isArray(content)) {
        // tool_result blocks reuse the live mapping
        out.push(...mapMessage(m as unknown as SDKMessage, { msgId: m.uuid }))
        if (!sub) {
          const texts = content
            .map((b) => asRecord(b))
            .filter((b) => b?.['type'] === 'text' && typeof b['text'] === 'string')
            .map((b) => String(b?.['text']))
          const text = userPromptText(texts.join('\n'))
          if (text && texts.length) out.unshift({ t: 'user_message', text, uuid: m.uuid })
        }
      }
      return out
    }
    return []
  } catch {
    return []
  }
}

/**
 * Map a whole transcript. Transcripts store one entry per content block, so adjacent assistant
 * entries sharing a message id are coalesced into one message first (otherwise a later
 * assistant_message with the same msgId would replace the earlier blocks in the reducer).
 */
export function mapHistoryMessages(messages: RawSessionMessage[]): SessionEvent[] {
  const merged: RawSessionMessage[] = []
  for (const m of messages) {
    const prev = merged[merged.length - 1]
    const mi = asRecord(m.message)
    const pi = prev ? asRecord(prev.message) : undefined
    if (
      prev &&
      m.type === 'assistant' &&
      prev.type === 'assistant' &&
      m.parent_tool_use_id === prev.parent_tool_use_id &&
      mi &&
      pi &&
      mi['id'] != null &&
      mi['id'] === pi['id'] &&
      Array.isArray(mi['content']) &&
      Array.isArray(pi['content'])
    ) {
      merged[merged.length - 1] = {
        ...prev,
        message: { ...pi, content: [...(pi['content'] as unknown[]), ...(mi['content'] as unknown[])] }
      }
    } else merged.push(m)
  }
  return merged.flatMap(mapHistoryMessage)
}
