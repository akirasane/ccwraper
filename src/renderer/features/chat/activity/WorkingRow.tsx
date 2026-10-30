import * as React from 'react'
import { Kbd } from '@/components/ui'
import { useNow } from '@/lib/use-now'
import { useChatStore } from '@/stores/chat-store'
import {
  selectRunningTasks,
  selectSubagentTokens,
  selectTurnSummary,
  selectWorkingState
} from '../model/selectors'
import type { TaskView, TurnActivity } from '../model/types'
import { formatElapsed, isLostTask } from './format'
import { TokenCount } from './TokenCount'

const NO_TASKS: TaskView[] = []

const dot = (
  <span className="text-fg-muted" aria-hidden>
    ·
  </span>
)

const agents = (n: number): string => `${n} ${n === 1 ? 'agent' : 'agents'}`

function Tokens({ turn, sub }: { turn: TurnActivity | undefined; sub: number }): React.JSX.Element | null {
  if (!turn) return null
  const main = turn.usage.outputTokens
  if (main <= 0 && sub <= 0) return null
  return (
    <span data-testid="working-tokens" className="inline-flex items-center gap-1">
      <span aria-hidden>↓</span>
      <TokenCount value={main} exact={turn.exact} />
      {sub > 0 ? (
        <span data-testid="working-sub-tokens">
          main + <TokenCount value={sub} exact /> subagents
        </span>
      ) : (
        <span>tokens</span>
      )}
    </span>
  )
}

/**
 * The live activity row above the composer (D11): verb + elapsed, streamed tokens, running agents, Esc hint.
 * Visible for the whole running turn. After the turn's result a still-running background agent shows as
 * "N agents running in background" (the turn itself is over).
 */
export function WorkingRow({ convId }: { convId: string }): React.JSX.Element | null {
  const working = useChatStore((s) => {
    const c = s.convs[convId]
    return c ? selectWorkingState(c) : undefined
  })
  const turn = useChatStore((s) => {
    const c = s.convs[convId]
    return c ? selectTurnSummary(c) : undefined
  })
  const tasks = useChatStore((s) => {
    const c = s.convs[convId]
    return c ? selectRunningTasks(c) : NO_TASKS
  })
  const sub = useChatStore((s) => {
    const c = s.convs[convId]
    return c ? selectSubagentTokens(c) : 0
  })
  const status = useChatStore((s) => s.convs[convId]?.status)
  const live = tasks.filter((t) => !isLostTask(status, t)).length
  const now = useNow(working !== undefined)

  const wrap =
    'mx-auto flex w-full max-w-[calc(var(--chat-max-w)+48px)] shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-6 pb-2 text-sm text-fg-3'

  if (!working) {
    if (live === 0) return null
    return (
      <div data-testid="background-indicator" role="status" className={wrap}>
        <span className="text-fg-2">{agents(live)} running in background</span>
      </div>
    )
  }

  const since = working.since || turn?.startedAt || now
  const verbElapsed = formatElapsed(now - since)
  const total = turn ? formatElapsed(now - turn.startedAt) : verbElapsed
  let label: string
  switch (working.verb) {
    case 'thinking':
      label = 'Thinking...'
      break
    case 'tool':
      label = `Running ${working.toolName ?? 'tool'}...`
      break
    case 'approval':
      label = working.toolName ? `Waiting for approval (${working.toolName})` : 'Waiting for approval'
      break
    default:
      label = 'Working...'
  }

  return (
    <div data-testid="working-indicator" data-verb={working.verb} role="status" className={wrap}>
      <span className="ccw-shimmer" data-testid="working-verb">
        {label}
      </span>
      <span aria-live="off" className="inline-flex flex-wrap items-center gap-x-2">
        {working.verb !== 'approval' && (
          <span data-testid="working-elapsed" className="tabular-nums">
            {verbElapsed}
          </span>
        )}
        {working.verb !== 'working' && working.verb !== 'approval' && total !== verbElapsed && (
          <>
            {dot}
            <span data-testid="working-total" className="tabular-nums">
              turn {total}
            </span>
          </>
        )}
        {((turn?.usage.outputTokens ?? 0) > 0 || sub > 0) && (
          <>
            {dot}
            <Tokens turn={turn} sub={sub} />
          </>
        )}
        {live > 0 && (
          <>
            {dot}
            <span data-testid="working-agents">{agents(live)}</span>
          </>
        )}
      </span>
      {dot}
      <span className="inline-flex items-center gap-1">
        <Kbd>esc</Kbd> to interrupt
      </span>
    </div>
  )
}
