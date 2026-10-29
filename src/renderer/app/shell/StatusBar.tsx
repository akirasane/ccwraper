import { selectContextUsage } from '@/features/chat/model/selectors'
import { useAppInfo } from '@/features/sessions/queries'
import { useChatStore } from '@/stores/chat-store'
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

export function StatusBar(): React.JSX.Element {
  const convId = useWorkspaceStore((s) => s.activeConvId)
  const branch = useWorkspaceStore((s) => s.activeBranch)
  const conv = useChatStore((s) => (convId ? s.convs[convId] : undefined))
  const localMode = useChatStore((s) => (convId ? s.modes[convId] : undefined))
  const setMode = useChatStore((s) => s.setPermissionMode)
  const app = useAppInfo().data

  const st = STATE[conv?.status ?? 'idle'] ?? STATE.idle!
  const ctx = conv ? selectContextUsage(conv) : undefined
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
          <span data-testid="status-ctx" className="tabular-nums" title="Context window used">
            ctx {Math.round(ctx * 100)}%
          </span>
        </>
      )}
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
