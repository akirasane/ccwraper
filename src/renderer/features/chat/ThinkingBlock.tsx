import { ChevronRight } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/cn'

export interface ThinkingBlockProps {
  text: string
  /** true while the thinking is still streaming (label shimmers). */
  active?: boolean
  startedAt?: number
  endedAt?: number
}

function label(active: boolean, startedAt?: number, endedAt?: number): string {
  if (active) return 'Thinking'
  if (startedAt !== undefined && endedAt !== undefined) {
    return `Thought for ${Math.max(1, Math.round((endedAt - startedAt) / 1000))}s`
  }
  return 'Thought'
}

/** Collapsed by default; opens with grid-rows 0fr -> 1fr (250ms). */
export function ThinkingBlock({ text, active = false, startedAt, endedAt }: ThinkingBlockProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [everOpened, setEverOpened] = React.useState(false)
  const id = React.useId()
  const toggle = (): void => {
    setOpen((o) => !o)
    setEverOpened(true)
  }
  return (
    <div data-testid="thinking-block" className="text-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className="inline-flex h-6 items-center gap-1 rounded-sm px-1 text-fg-3 transition-colors duration-fast ease-out hover:bg-bg-3 hover:text-fg-2"
      >
        <ChevronRight
          size={13}
          className={cn('transition-transform duration-base ease-out', open && 'rotate-90')}
          aria-hidden
        />
        <span className={cn(active && 'ccw-shimmer')}>{label(active, startedAt, endedAt)}</span>
      </button>
      <div id={id} className="ccw-collapse" data-open={open} aria-hidden={!open}>
        <div>
          {(open || everOpened) && (
            <p className="m-0 mt-1 whitespace-pre-wrap border-l-2 border-border-strong pl-3 text-fg-3 leading-[1.6]">
              {text}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
