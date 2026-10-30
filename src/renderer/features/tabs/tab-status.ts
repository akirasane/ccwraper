import { selectRunningTasks } from '@/features/chat/model/selectors'
import type { ConvState } from '@/features/chat/model/types'
import type { TabRef } from '@/stores/workspace-store'

export type TabStatus = 'waiting' | 'error' | 'running' | 'unread' | 'idle'

const STATUS_TEXT: Record<TabStatus, string> = {
  waiting: 'Waiting for approval',
  error: 'Error',
  running: 'Running',
  unread: 'New result',
  idle: 'Idle'
}

export const statusText = (s: TabStatus): string => STATUS_TEXT[s]

// Memoized per conversation reference: the same ConvState gives the same base status.
const base = new WeakMap<ConvState, Exclude<TabStatus, 'unread'>>()

function baseStatus(c: ConvState): Exclude<TabStatus, 'unread'> {
  const hit = base.get(c)
  if (hit) return hit
  let s: Exclude<TabStatus, 'unread'> = 'idle'
  if (c.status === 'waiting_permission' || c.pending.length > 0) s = 'waiting'
  else if (c.status === 'error') s = 'error'
  else if (c.status === 'running' || selectRunningTasks(c).length > 0) s = 'running'
  base.set(c, s)
  return s
}

/** waiting > error > running > unread > idle. `unread` is cleared by the store on activation. */
export function tabStatus(c: ConvState | undefined, unread: boolean): TabStatus {
  if (!c) return 'idle'
  const b = baseStatus(c)
  return b === 'idle' && unread ? 'unread' : b
}

export function tabTitle(tab: TabRef, c?: ConvState): string {
  if (tab.title) return tab.title
  const first = c?.items.find((i) => i.kind === 'user')
  if (first && first.kind === 'user') {
    const line = first.text.replace(/\s+/g, ' ').trim()
    if (line) return line.length > 40 ? `${line.slice(0, 39)}…` : line
  }
  return 'New chat'
}

const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/** Multi-line tooltip: project path, model, session cost and tokens, status. */
export function tabTooltip(tab: TabRef, c: ConvState | undefined, status: TabStatus): string {
  const lines = [tab.cwd]
  if (c?.meta.model) lines.push(`Model: ${c.meta.model}`)
  const usage = c?.session.usage
  const cost = usage?.costUsd ?? c?.lastResult?.costUsd
  if (cost !== undefined) lines.push(`Cost: $${cost.toFixed(4)}`)
  if (usage) lines.push(`Tokens: ${fmtTokens(usage.inputTokens + usage.outputTokens)}`)
  lines.push(statusText(status))
  return lines.join('\n')
}
