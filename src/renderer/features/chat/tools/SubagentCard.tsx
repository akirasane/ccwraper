import { Bot, ChevronRight, Square } from 'lucide-react'
import * as React from 'react'
import { StatusPill, type StatusPillState } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useNow } from '@/lib/use-now'
import { useChatStore } from '@/stores/chat-store'
import { formatElapsed, isLiveTask, isLostTask } from '../activity/format'
import { TokenCount } from '../activity/TokenCount'
import { selectChildItems, selectTaskForTool } from '../model/selectors'
import type { ChatItem, TaskView, ToolCallView } from '../model/types'
import { TruncatedText } from './TruncatedText'

export const CHILD_CAP = 50
const MAX_INDENT_DEPTH = 3
const EMPTY: ChatItem[] = []

interface Pill {
  state: StatusPillState
  label: string
}

function pillFor(task: TaskView | undefined, tool: ToolCallView, lost: boolean): Pill {
  if (lost) return { state: 'err', label: 'Lost' }
  if (!task) {
    // No task events (history replay): fall back to the spawning tool call.
    if (tool.status === 'error') return { state: 'err', label: 'Error' }
    return tool.status === 'done' ? { state: 'done', label: 'Done' } : { state: 'run', label: 'Running' }
  }
  switch (task.status) {
    case 'completed':
      return { state: 'done', label: 'Done' }
    case 'failed':
      return { state: 'err', label: 'Error' }
    case 'stopped':
    case 'killed':
      return { state: 'done', label: 'Stopped' }
    case 'stopping':
      return { state: 'run', label: 'Stopping' }
    case 'paused':
      return { state: 'run', label: 'Paused' }
    default:
      return { state: 'run', label: 'Running' }
  }
}

function newestRunningChildTool(children: ChatItem[], tools: Record<string, ToolCallView>): string | undefined {
  for (let i = children.length - 1; i >= 0; i--) {
    const it = children[i]
    if (it?.kind === 'tool' && tools[it.toolUseId]?.status === 'running') return tools[it.toolUseId]?.name
  }
  return undefined
}

const asRec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

export interface SubagentCardProps {
  convId: string
  toolUseId: string
  /** Nesting level (0 = top level); the indent stops growing at 3. */
  depth?: number
  /** Renders one child item (the chat `ItemView`; passed in so nested agents recurse without an import cycle). */
  renderItem: (item: ChatItem, depth: number) => React.ReactNode
}

export function SubagentCard({ convId, toolUseId, depth = 0, renderItem }: SubagentCardProps): React.JSX.Element | null {
  const tool = useChatStore((s) => s.convs[convId]?.tools[toolUseId])
  const task = useChatStore((s) => {
    const c = s.convs[convId]
    return c ? selectTaskForTool(c, toolUseId) : undefined
  })
  const children = useChatStore((s) => {
    const c = s.convs[convId]
    return c ? selectChildItems(c, toolUseId) : EMPTY
  })
  const childTools = useChatStore((s) => s.convs[convId]?.tools)
  const convClosed = useChatStore((s) => s.convs[convId]?.closed)
  const [userOpen, setUserOpen] = React.useState<boolean | null>(null)
  const [showAll, setShowAll] = React.useState(false)

  const lost = task ? isLostTask(convClosed, task) : false
  // The task events decide, not the spawning tool call (a background agent outlives its tool_result).
  const live = task ? isLiveTask(task) && !lost : tool?.status === 'running' || tool?.status === 'needs_approval'
  const now = useNow(live)
  if (!tool) return null

  const open = userOpen ?? live
  const bodyId = `agent-body-${toolUseId}`
  const input = asRec(tool.input)
  const description = task?.description || (typeof input.description === 'string' ? input.description : '') || 'Agent'
  const subType = task?.subagentType ?? (typeof input.subagent_type === 'string' ? input.subagent_type : undefined)
  const pill = pillFor(task, tool, lost)
  const startedAt = task?.startedAt ?? tool.startedAt
  const elapsedMs = live
    ? startedAt !== undefined
      ? Math.max(task?.durationMs ?? 0, now - startedAt)
      : undefined
    : (task?.durationMs ?? (task?.endedAt !== undefined && startedAt !== undefined ? task.endedAt - startedAt : undefined))
  const currentTool = live ? (task?.lastToolName ?? newestRunningChildTool(children, childTools ?? {})) : undefined
  const canStop = !!task && live && task.status !== 'stopping'

  const hidden = showAll ? 0 : Math.max(0, children.length - CHILD_CAP)
  const visible = hidden > 0 ? children.slice(hidden) : children
  const childDepth = depth + 1

  return (
    <div
      data-testid="subagent-card"
      data-conv-id={convId}
      data-tool-use-id={toolUseId}
      data-status={task?.status ?? tool.status}
      data-lost={lost || undefined}
      className={cn(
        'ccw-toast-in overflow-hidden rounded-md border bg-bg-1',
        pill.state === 'err' ? 'border-danger-border' : 'border-border'
      )}
    >
      <div className="flex min-h-[38px] items-center gap-1 pr-2 transition-colors duration-fast hover:bg-bg-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`Agent ${description}`}
          onClick={() => setUserOpen(!open)}
          className="flex min-h-[38px] min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1 text-left"
        >
          <ChevronRight
            size={12}
            aria-hidden
            className={cn('shrink-0 text-fg-3 transition-transform duration-fast', open && 'rotate-90')}
          />
          <Bot size={14} aria-hidden className="shrink-0 text-fg-3" />
          <span className="min-w-0 max-w-full truncate text-base font-medium text-fg">{description}</span>
          {subType && (
            <span
              data-testid="subagent-type"
              className="shrink-0 rounded-xs border border-border bg-bg-2 px-1.5 text-2xs text-fg-2"
            >
              {subType}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-fg-3">
            {task?.totalTokens !== undefined && (
              <span data-testid="subagent-tokens" className="inline-flex items-center gap-0.5">
                <span aria-hidden>↓</span>
                <TokenCount value={task.totalTokens} exact />
              </span>
            )}
            {task?.toolUses !== undefined && (
              <span data-testid="subagent-tool-count" className="tabular-nums">
                {task.toolUses} {task.toolUses === 1 ? 'tool call' : 'tool calls'}
              </span>
            )}
            {currentTool && (
              <span data-testid="subagent-current-tool" className="font-mono text-fg-2">
                {currentTool}
              </span>
            )}
            {elapsedMs !== undefined && (
              <span data-testid="subagent-elapsed" className="tabular-nums">
                {formatElapsed(elapsedMs)}
              </span>
            )}
          </span>
        </button>
        {canStop && (
          <button
            type="button"
            data-testid="subagent-stop"
            aria-label="Stop agent"
            onClick={() => void useChatStore.getState().stopTask(convId, task.taskId)}
            className="inline-flex h-5 shrink-0 items-center gap-1 rounded-xs border border-border px-1.5 text-xs text-fg-3 transition-colors duration-fast hover:bg-bg-3 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-from"
          >
            <Square size={9} fill="currentColor" aria-hidden />
            Stop agent
          </button>
        )}
        <StatusPill state={pill.state} label={pill.label} />
      </div>
      {open && (
        <div id={bodyId} data-testid="subagent-body" className="space-y-2 border-t border-border px-3 py-2">
          {hidden > 0 && (
            <button
              type="button"
              data-testid="subagent-show-earlier"
              onClick={() => setShowAll(true)}
              className="text-xs text-accent-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-from"
            >
              Show {hidden} earlier
            </button>
          )}
          {visible.map((it) => (
            <div key={it.id} className={cn(childDepth <= MAX_INDENT_DEPTH && 'pl-1')}>
              {renderItem(it, childDepth)}
            </div>
          ))}
          {children.length === 0 && (
            <div className="text-sm text-fg-3">{live ? 'Starting...' : 'No activity recorded.'}</div>
          )}
          {!live && tool.result !== undefined && tool.result !== '' && (
            <TruncatedText text={tool.result} className="font-mono text-sm text-fg-2" />
          )}
        </div>
      )}
    </div>
  )
}
