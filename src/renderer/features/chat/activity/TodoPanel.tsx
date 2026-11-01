import { Check, ChevronRight, Circle, LoaderCircle } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/cn'
import { useChatStore } from '@/stores/chat-store'
import { deriveTodos, todoProgress, type TodoItem } from '../model/todos'

function StatusIcon({ status }: { status: TodoItem['status'] }): React.JSX.Element {
  if (status === 'completed') return <Check size={13} aria-hidden className="shrink-0 text-ok" />
  if (status === 'in_progress') return <LoaderCircle size={13} aria-hidden className="shrink-0 animate-spin text-accent-from" />
  return <Circle size={12} aria-hidden className="shrink-0 text-fg-muted" />
}

/**
 * Pinned checklist from the agent's TodoWrite / Task* tool calls, just above the composer.
 * Derived from the conversation's tools, so it also appears when a session is resumed.
 */
export function TodoPanel({ convId }: { convId: string }): React.JSX.Element | null {
  const tools = useChatStore((s) => s.convs[convId]?.tools)
  const todos = React.useMemo(() => (tools ? deriveTodos({ tools }) : []), [tools])
  const [collapsed, setCollapsed] = React.useState(false)
  if (todos.length === 0) return null
  const { done, total, current } = todoProgress(todos)
  const allDone = done === total

  return (
    <section
      data-testid="todo-panel"
      aria-label="Task list"
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
          <span data-testid="todo-title" className="tabular-nums">
            Tasks {done}/{total}
          </span>
          {collapsed && current ? (
            <span className="min-w-0 flex-1 truncate text-fg-3">{current.activeForm ?? current.subject}</span>
          ) : null}
          {allDone ? <span className="text-ok">done</span> : null}
        </button>
        {!collapsed && (
          <ul className="max-h-[160px] space-y-0.5 overflow-y-auto border-t border-border p-1">
            {todos.map((t) => (
              <li
                key={t.id}
                data-testid="todo-row"
                data-status={t.status}
                className="flex min-h-[26px] items-center gap-2 rounded-sm px-2 text-sm"
              >
                <StatusIcon status={t.status} />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    t.status === 'completed' && 'text-fg-3 line-through',
                    t.status === 'in_progress' && 'text-fg',
                    t.status === 'pending' && 'text-fg-2'
                  )}
                >
                  {t.status === 'in_progress' ? (t.activeForm ?? t.subject) : t.subject}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
