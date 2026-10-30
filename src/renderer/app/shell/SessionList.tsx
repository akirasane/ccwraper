import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui'
import { queryKeys, useSessions } from '@/features/sessions/queries'
import { cn } from '@/lib/cn'
import { stagger } from '@/lib/motion'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

export function SessionList({ disabled }: { disabled?: boolean }): React.JSX.Element {
  const qc = useQueryClient()
  const cwd = useWorkspaceStore((s) => s.cwd)
  const activeConvId = useWorkspaceStore((s) => s.activeConvId)
  const openSession = useWorkspaceStore((s) => s.openSession)
  const newSession = useWorkspaceStore((s) => s.newSession)
  const conv = useChatStore((s) => (activeConvId ? s.convs[activeConvId] : undefined))
  const tabs = useWorkspaceStore((s) => s.tabs)
  const openIds = new Set(tabs.map((t) => t.sessionId).filter((x): x is string => !!x))
  const { data: sessions, isLoading, error } = useSessions(cwd)

  // Refetch after each result so new / updated sessions appear.
  const lastResult = conv?.lastResult
  useEffect(() => {
    if (lastResult && cwd) void qc.invalidateQueries({ queryKey: queryKeys.sessions(cwd) })
  }, [lastResult, cwd, qc])

  const activeSessionId = conv?.meta.sessionId ?? conv?.resumeSessionId

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="session-list">
      <div className="p-2">
        <Button variant="secondary" className="w-full" disabled={disabled || !cwd} onClick={newSession}>
          <Plus size={14} aria-hidden /> New session
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {cwd && isLoading && <p className="px-2 py-1 text-sm text-fg-3">Loading sessions...</p>}
        {error != null && <p className="px-2 py-1 text-sm text-danger">Could not load sessions</p>}
        {sessions && sessions.length === 0 && <p className="px-2 py-1 text-sm text-fg-3">No past sessions</p>}
        <ul className="flex flex-col gap-0.5">
          {sessions?.map((s, i) => (
            <li
              key={s.sessionId}
              className={i < stagger.maxItems ? 'ccw-fade-in' : undefined}
              style={i < stagger.maxItems ? { animationDelay: `${i * stagger.step}ms` } : undefined}
            >
              <button
                type="button"
                disabled={disabled}
                aria-current={activeSessionId === s.sessionId || undefined}
                onClick={() => void openSession(s)}
                className={cn(
                  'flex w-full flex-col rounded-sm px-2 py-1.5 text-left transition-colors duration-fast hover:bg-bg-3 disabled:opacity-45',
                  activeSessionId === s.sessionId && 'bg-accent-tint'
                )}
              >
                <span className="flex items-center gap-1.5 truncate text-base text-fg">
                  {openIds.has(s.sessionId) && (
                    <span
                      data-testid="open-dot"
                      title="Open in a tab"
                      aria-label="Open in a tab"
                      role="img"
                      className="size-1.5 shrink-0 rounded-full bg-accent-to"
                    />
                  )}
                  <span className="truncate">{s.title}</span>
                </span>
                <span className="truncate text-xs text-fg-3">
                  {relativeTime(s.lastModified)}
                  {s.gitBranch ? ` · ${s.gitBranch}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
