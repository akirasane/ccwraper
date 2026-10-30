import { ChevronRight, FilePen, FileText, Search, SquareTerminal, TerminalSquare, Wrench } from 'lucide-react'
import * as React from 'react'
import { StatusPill, type StatusPillState } from '@/components/ui'
import { cn } from '@/lib/cn'
import { requestRunInTerminal } from '@/lib/terminal-bus'
import type { ToolCallView } from '@/features/chat/model/types'
import { useChatStore } from '@/stores/chat-store'
import { diffFromToolInput } from '../diff/compute-diff'
import { DiffView } from '../diff/DiffView'
import { argSummary, formatDuration, resultLineCount } from './tool-format'
import { TruncatedText } from './TruncatedText'

const asRec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '')

function ToolIcon({ name }: { name: string }): React.JSX.Element {
  const props = { size: 14, 'aria-hidden': true, className: 'shrink-0 text-fg-3' }
  if (name === 'Bash') return <SquareTerminal {...props} />
  if (name === 'Edit' || name === 'MultiEdit' || name === 'Write') return <FilePen {...props} />
  if (name === 'Read') return <FileText {...props} />
  if (name === 'Grep' || name === 'Glob') return <Search {...props} />
  return <Wrench {...props} />
}

const PILL: Record<ToolCallView['status'], StatusPillState> = {
  running: 'run',
  needs_approval: 'run',
  done: 'done',
  error: 'err'
}

function Label({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mb-1 text-2xs uppercase tracking-wider text-fg-muted">{children}</div>
}

function ResultBlock({ tool }: { tool: ToolCallView }): React.JSX.Element | null {
  if (tool.result === undefined || tool.result === '') return null
  return (
    <div className="px-3 pb-2">
      <TruncatedText
        text={tool.result}
        className={cn('font-mono text-sm', tool.status === 'error' ? 'text-danger' : 'text-fg-2')}
      />
    </div>
  )
}

function Body({ tool, flash, cwd }: { tool: ToolCallView; flash: boolean; cwd: string }): React.JSX.Element {
  const input = asRec(tool.input)
  const diff = diffFromToolInput(tool.name, tool.input)
  if (diff) {
    return (
      <>
        <div className="px-3 pb-1 font-mono text-xs text-fg-3">{asStr(input.file_path)}</div>
        <DiffView diff={diff} flash={flash} />
        {tool.status === 'error' && <ResultBlock tool={tool} />}
      </>
    )
  }
  if (tool.name === 'Bash') {
    return (
      <>
        <div className="flex items-start gap-2 px-3 pb-2">
          <div className="min-w-0 flex-1 font-mono text-sm text-fg">
            <span className="select-none text-fg-3">$ </span>
            <span className="whitespace-pre-wrap break-all">{asStr(input.command)}</span>
          </div>
          {asStr(input.command) && (
            <button
              type="button"
              aria-label="Run in terminal"
              title="Type this command into a terminal (not executed)"
              onClick={() => requestRunInTerminal({ cwd, command: asStr(input.command) })}
              className="inline-flex h-5 shrink-0 items-center gap-1 rounded-xs border border-border px-1.5 text-xs text-fg-3 transition-colors duration-fast hover:bg-bg-3 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-from"
            >
              <TerminalSquare size={11} aria-hidden />
              Run in terminal
            </button>
          )}
        </div>
        <ResultBlock tool={tool} />
      </>
    )
  }
  if (tool.name === 'Read') {
    const off = typeof input.offset === 'number' ? input.offset : undefined
    const lim = typeof input.limit === 'number' ? input.limit : undefined
    const range = off !== undefined || lim !== undefined ? `lines ${off ?? 1}-${(off ?? 1) + (lim ?? 0)}` : undefined
    return (
      <>
        <div className="px-3 pb-2 font-mono text-sm text-fg-2">
          {asStr(input.file_path)}
          {range && <span className="ml-2 text-fg-3">{range}</span>}
        </div>
        <ResultBlock tool={tool} />
      </>
    )
  }
  if (tool.name === 'Grep' || tool.name === 'Glob') {
    return (
      <>
        <div className="px-3 pb-2 font-mono text-sm text-fg-2">
          {asStr(input.pattern)}
          {asStr(input.path) && <span className="ml-2 text-fg-3">in {asStr(input.path)}</span>}
        </div>
        <ResultBlock tool={tool} />
      </>
    )
  }
  return (
    <>
      <div className="px-3 pb-2">
        <Label>Input</Label>
        <TruncatedText text={JSON.stringify(tool.input, null, 2) ?? ''} className="font-mono text-sm text-fg-2" />
      </div>
      <ResultBlock tool={tool} />
    </>
  )
}

function Meta({ tool }: { tool: ToolCallView }): React.JSX.Element | null {
  const diff = diffFromToolInput(tool.name, tool.input)
  if (diff) {
    return (
      <span className="shrink-0 font-mono text-xs tabular-nums">
        <span className="text-ok">+{diff.added}</span> <span className="text-danger">-{diff.removed}</span>
      </span>
    )
  }
  if ((tool.name === 'Grep' || tool.name === 'Glob') && tool.status === 'done') {
    const n = resultLineCount(tool.result)
    return <span className="shrink-0 text-xs text-fg-3 tabular-nums">{n} {n === 1 ? 'match' : 'matches'}</span>
  }
  // History replay seeds start and end at the same instant: no real duration to show.
  if (tool.status === 'done' && tool.startedAt !== undefined && tool.endedAt !== undefined && tool.endedAt > tool.startedAt) {
    return <span className="shrink-0 text-xs text-fg-3 tabular-nums">{formatDuration(tool.endedAt - tool.startedAt)}</span>
  }
  return null
}

export function ToolCard({ convId, toolUseId }: { convId: string; toolUseId: string }): React.JSX.Element | null {
  const tool = useChatStore((s) => s.convs[convId]?.tools[toolUseId])
  const cwd = useChatStore((s) => s.convs[convId]?.cwd ?? '')
  const [open, setOpen] = React.useState(true)
  const wasActive = React.useRef(false)
  const status = tool?.status
  const flash = status === 'done' && wasActive.current
  React.useEffect(() => {
    wasActive.current = status === 'running' || status === 'needs_approval'
  }, [status])

  if (!tool) return null
  const bodyId = `tool-body-${toolUseId}`
  return (
    <div
      data-testid="tool-card"
      data-conv-id={convId}
      data-tool-use-id={toolUseId}
      data-status={tool.status}
      className={cn(
        'ccw-toast-in overflow-hidden rounded-md border bg-bg-1',
        tool.status === 'error' ? 'border-danger-border' : 'border-border',
        tool.status === 'needs_approval' && 'border-warn-border'
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        className="flex h-[38px] w-full items-center gap-2 px-3 text-left transition-colors duration-fast hover:bg-bg-2"
      >
        <ChevronRight
          size={12}
          aria-hidden
          className={cn('shrink-0 text-fg-3 transition-transform duration-fast', open && 'rotate-90')}
        />
        <ToolIcon name={tool.name} />
        <span className="shrink-0 text-base font-medium text-fg">{tool.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-fg-3">{argSummary(tool.name, tool.input)}</span>
        <Meta tool={tool} />
        <StatusPill state={PILL[tool.status]} label={tool.status === 'needs_approval' ? 'Needs approval' : undefined} />
      </button>
      {open && (
        <div
          id={bodyId}
          className={cn('border-t pb-1 pt-2', tool.status === 'error' ? 'border-danger-border bg-danger-bg' : 'border-border')}
        >
          <Body tool={tool} flash={flash} cwd={cwd} />
        </div>
      )}
    </div>
  )
}
