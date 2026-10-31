import { Bot, ChevronRight, Square } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/cn'
import { useNow } from '@/lib/use-now'
import { useChatStore } from '@/stores/chat-store'
import { selectRunningTasks } from '../model/selectors'
import type { TaskView } from '../model/types'
import { formatElapsed, isLostTask } from './format'
import { TokenCount } from './TokenCount'

const NO_TASKS: TaskView[] = []

function jumpToCard(convId: string, toolUseId: string | undefined): void {
  if (!toolUseId) return
  const root = document.querySelector(`[data-testid="chat-view"][data-conv-id="${CSS.escape(convId)}"]`)
  const card = root?.querySelector(`[data-testid="subagent-card"][data-tool-use-id="${CSS.escape(toolUseId)}"]`)
  card?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

function DockRow({ convId, task, now }: { convId: string; task: TaskView; now: number }): React.JSX.Element {
  const stopping = task.status === 'stopping'
  const elapsed = Math.max(task.durationMs ?? 0, now - task.startedAt)
  return (
    <li
      data-testid="agent-dock-row"
      data-task-id={task.taskId}
      className="flex min-h-[30px] items-center gap-2 rounded-sm px-2 text-sm hover:bg-bg-2"
    >
      <Bot size={13} aria-hidden className="shrink-0 text-fg-3" />
      <button
        type="button"
        onClick={() => jumpToCard(convId, task.toolUseId)}
        disabled={!task.toolUseId}
        title="Show in conversation"
        className="min-w-0 flex-1 truncate text-left text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-from"
      >
        {task.description || 'Agent'}
        {task.subagentType && <span className="ml-2 text-2xs text-fg-3">{task.subagentType}</span>}
      </button>
      <span className="flex shrink-0 items-center gap-2 text-xs text-fg-3">
        {task.lastToolName && <span className="font-mono text-fg-2">{task.lastToolName}</span>}
        {task.toolUses !== undefined && <span className="tabular-nums">{task.toolUses} tools</span>}
        {task.totalTokens !== undefined && (
          <span className="inline-flex items-center gap-0.5">
            <span aria-hidden>↓</span>
            <TokenCount value={task.totalTokens} exact />
          </span>
        )}
        <span className="tabular-nums">{formatElapsed(elapsed)}</span>
      </span>
      <button
        type="button"
        aria-label={`Stop agent ${task.description}`}
        disabled={stopping}
        onClick={() => void useChatStore.getState().stopTask(convId, task.taskId)}
        className="inline-flex h-5 shrink-0 items-center gap-1 rounded-xs border border-border px-1.5 text-xs text-fg-3 transition-colors duration-fast hover:bg-bg-3 hover:text-fg disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-from"
      >
        <Square size={9} fill="currentColor" aria-hidden />
        {stopping ? 'Stopping' : 'Stop'}
      </button>
    </li>
  )
}

/**
 * Pinned list of running agents just above the composer, so they stay visible and stoppable
 * however far the transcript is scrolled. Click a row to jump to its card in the conversation.
 */
export function AgentDock({ convId }: { convId: string }): React.JSX.Element | null {
  const tasks = useChatStore((s) => {
    const c = s.convs[convId]
    return c ? selectRunningTasks(c) : NO_TASKS
  })
  const closed = useChatStore((s) => s.convs[convId]?.closed)
  const [collapsed, setCollapsed] = React.useState(false)
  const live = tasks.filter((t) => !isLostTask(closed, t))
  const now = useNow(live.length > 0)
  if (live.length === 0) return null

  return (
    <section
      data-testid="agent-dock"
      aria-label="Running agents"
      className="mx-auto w-full max-w-[calc(var(--chat-max-w)+48px)] shrink-0 px-6 pb-2"
    >
      <div className="overflow-hidden rounded-md border border-border bg-bg-1">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
          className="flex h-7 w-full items-center gap-1.5 px-2 text-left text-xs text-fg-2 hover:bg-bg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-from"
        >
          <ChevronRight
            size={12}
            aria-hidden
            className={cn('shrink-0 text-fg-3 transition-transform duration-fast', !collapsed && 'rotate-90')}
          />
          <span data-testid="agent-dock-title">
            {live.length} {live.length === 1 ? 'agent' : 'agents'} running
          </span>
        </button>
        {!collapsed && (
          <ul className="max-h-[132px] space-y-0.5 overflow-y-auto border-t border-border p-1">
            {live.map((t) => (
              <DockRow key={t.taskId} convId={convId} task={t} now={now} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
