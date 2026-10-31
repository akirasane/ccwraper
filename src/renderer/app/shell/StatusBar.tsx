import { formatElapsed, formatTokens } from '@/features/chat/activity/format'
import { TokenCount } from '@/features/chat/activity/TokenCount'
import { selectLiveContext, selectTurnSummary } from '@/features/chat/model/selectors'
import type { ConvState } from '@/features/chat/model/types'
import { Tooltip } from '@/components/ui'
import { useNow } from '@/lib/use-now'
import { useAppInfo } from '@/features/sessions/queries'
import { modelLabel, useModels } from '@/features/chat/ModelMenu'
import { assumedContextWindow } from '@shared/models'
import { effectiveMode, getCachedCtxWindow, useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { ShieldAlert } from 'lucide-react'
import { isBypass, modeLabel } from '@/features/chat/mode/modes'
import { CavemanBadge, LimitsCluster } from '@/features/limits/UsageCluster'
import { CostMeter } from './CostMeter'

const STATE: Record<string, { label: string; dot: string }> = {
  idle: { label: 'Idle', dot: 'bg-ok' },
  running: { label: 'Running', dot: 'bg-info' },
  waiting_permission: { label: 'Waiting for approval', dot: 'bg-warn' },
  error: { label: 'Error', dot: 'bg-danger' }
}

const sep = (
  <span className="text-fg-muted" aria-hidden>
    ·
  </span>
)

const promptTokens = (u: { inputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }): number =>
  u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens

/** Live turn numbers while running, the last turn's exact numbers after; a tooltip with the session totals. */
function TurnSegment({ conv }: { conv: ConvState }): React.JSX.Element | null {
  const turn = selectTurnSummary(conv)
  const live = !!conv.turn
  const now = useNow(live)
  if (!turn) return null
  const elapsed = live ? now - turn.startedAt : (turn.durationMs ?? 0)
  const s = conv.session
  const u = s.usage
  const work = s.workMs + (live ? Math.max(0, now - turn.startedAt) : 0)
  const tip = (
    <div className="space-y-0.5 tabular-nums" data-testid="status-turn-tip">
      <div>Session: {s.turns} {s.turns === 1 ? 'turn' : 'turns'}</div>
      {u ? (
        <>
          <div>input {formatTokens(u.inputTokens)} · output {formatTokens(u.outputTokens)}</div>
          <div>cache read {formatTokens(u.cacheReadTokens)} · cache write {formatTokens(u.cacheCreationTokens)}</div>
          <div>cost ${u.costUsd.toFixed(4)}</div>
        </>
      ) : (
        <div>No completed turn yet</div>
      )}
      <div>work time {formatElapsed(work)} · API time {formatElapsed(s.apiMs)}</div>
    </div>
  )
  return (
    <>
      {sep}
      <Tooltip content={tip}>
        <span data-testid="status-turn" className="inline-flex items-center gap-1.5 tabular-nums">
          <span>turn {formatElapsed(elapsed)}</span>
          <span>↑ {formatTokens(promptTokens(turn.usage))}</span>
          <span className="inline-flex items-center gap-0.5">
            ↓ <TokenCount value={turn.usage.outputTokens} exact={!live || turn.exact} />
          </span>
        </span>
      </Tooltip>
    </>
  )
}

export function StatusBar(): React.JSX.Element {
  const convId = useWorkspaceStore((s) => s.activeConvId)
  const branch = useWorkspaceStore((s) => s.activeBranch)
  const conv = useChatStore((s) => (convId ? s.convs[convId] : undefined))
  const mode = useChatStore((s) => (convId ? effectiveMode(s, convId) : 'default'))
  const app = useAppInfo().data
  const models = useModels(conv?.localId)

  const st = STATE[conv?.status ?? 'idle'] ?? STATE.idle!
  const ctx = conv ? selectLiveContext(conv, getCachedCtxWindow(conv.meta.model), assumedContextWindow(conv.meta.model)) : undefined
  const bypass = isBypass(mode)
  const claude = app ? `claude ${app.claudeVersion ?? '?'} (${app.claudeSource})` : undefined

  return (
    <footer
      data-testid="status-bar"
      className="flex h-[26px] shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-t border-border bg-bg-1 px-3 text-xs text-fg-3"
    >
      <span className="inline-flex items-center gap-1.5 text-fg-2" data-testid="status-state">
        <span className={`size-1.5 rounded-full ${st.dot}`} aria-hidden />
        {st.label}
      </span>
      {conv?.meta.model && (
        <>
          {sep}
          <span data-testid="status-model" className="font-mono text-fg-2" title={conv.meta.model}>
            {modelLabel(models, conv.meta.model)}
          </span>
        </>
      )}
      {sep}
      {/* Display-only: the mode is changed from the composer menu or the palette. */}
      <span
        data-testid="status-mode"
        data-bypass={bypass || undefined}
        title={bypass ? 'Bypass: every tool call runs without asking' : 'Permission mode'}
        className={bypass ? 'inline-flex items-center gap-1 rounded-xs border border-danger-border bg-danger-bg px-1.5 text-danger' : 'text-fg-2'}
      >
        {bypass && <ShieldAlert size={11} aria-hidden />}
        {modeLabel(mode)}
      </span>
      {ctx !== undefined && (
        <>
          {sep}
          <span
            data-testid="status-ctx"
            data-estimated={ctx.assumed || (!!conv?.turn && !ctx.exact)}
            className="tabular-nums"
            title={
              ctx.assumed
                ? 'Context window assumed until the first reply'
                : conv?.turn && !ctx.exact
                  ? 'Context window used (estimated while streaming)'
                  : 'Context window used'
            }
          >
            ctx {ctx.assumed || (conv?.turn && !ctx.exact) ? '~' : ''}
            {Math.round(ctx.fraction * 100)}%
          </span>
        </>
      )}
      {conv && <TurnSegment conv={conv} />}
      {sep}
      <CostMeter value={conv?.lastResult?.costUsd} />
      <span className="ml-auto flex min-w-0 items-center gap-2">
        <CavemanBadge />
        <LimitsCluster />
        {conv?.cwd && (
          <span data-testid="status-cwd" className="min-w-0 truncate font-mono" title={conv.cwd}>
            {conv.cwd}
          </span>
        )}
        {branch && (
          <>
            {sep}
            <span className="shrink-0 font-mono">{branch}</span>
          </>
        )}
        {claude && (
          <>
            {sep}
            <span data-testid="status-claude" className="shrink-0">
              {claude}
            </span>
          </>
        )}
      </span>
    </footer>
  )
}
