import { formatElapsed, formatTokens } from '@/features/chat/activity/format'
import { TokenCount } from '@/features/chat/activity/TokenCount'
import { selectLiveContext, selectTurnSummary } from '@/features/chat/model/selectors'
import type { ConvState } from '@/features/chat/model/types'
import { Tooltip } from '@/components/ui'
import { useNow } from '@/lib/use-now'
import { useAppInfo } from '@/features/sessions/queries'
import { getCachedCtxWindow, useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import type { PermissionMode } from '@shared/ipc'
import { CostMeter } from './CostMeter'

const MODES: { value: PermissionMode; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'plan', label: 'Plan' }
]

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
  const localMode = useChatStore((s) => (convId ? s.modes[convId] : undefined))
  const setMode = useChatStore((s) => s.setPermissionMode)
  const app = useAppInfo().data

  const st = STATE[conv?.status ?? 'idle'] ?? STATE.idle!
  const ctx = conv ? selectLiveContext(conv, getCachedCtxWindow(conv.meta.model)) : undefined
  const mode = conv?.meta.permissionMode ?? localMode ?? 'default'
  const modes = MODES.some((m) => m.value === mode) ? MODES : [...MODES, { value: mode as PermissionMode, label: mode }]
  const claude = app ? `claude ${app.claudeVersion ?? '?'} (${app.claudeSource})` : undefined

  return (
    <footer
      data-testid="status-bar"
      className="flex h-[26px] shrink-0 items-center gap-2 border-t border-border bg-bg-1 px-3 text-xs text-fg-3"
    >
      <span className="inline-flex items-center gap-1.5 text-fg-2" data-testid="status-state">
        <span className={`size-1.5 rounded-full ${st.dot}`} aria-hidden />
        {st.label}
      </span>
      {conv?.meta.model && (
        <>
          {sep}
          <span data-testid="status-model" className="font-mono text-fg-2">
            {conv.meta.model}
          </span>
        </>
      )}
      {sep}
      <select
        aria-label="Permission mode"
        value={mode}
        disabled={!convId}
        onChange={(e) => convId && void setMode(convId, e.target.value as PermissionMode)}
        className="h-5 rounded-xs border border-transparent bg-transparent px-1 text-xs text-fg-2 hover:bg-bg-3 disabled:opacity-40"
      >
        {modes.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      {ctx !== undefined && (
        <>
          {sep}
          <span
            data-testid="status-ctx"
            data-estimated={!!conv?.turn && !ctx.exact}
            className="tabular-nums"
            title={conv?.turn && !ctx.exact ? 'Context window used (estimated while streaming)' : 'Context window used'}
          >
            ctx {conv?.turn && !ctx.exact ? '~' : ''}
            {Math.round(ctx.fraction * 100)}%
          </span>
        </>
      )}
      {conv && <TurnSegment conv={conv} />}
      {sep}
      <CostMeter value={conv?.lastResult?.costUsd} />
      <span className="ml-auto flex min-w-0 items-center gap-2">
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
