import { Check, X } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './spinner'

export type StatusPillState = 'run' | 'done' | 'err'

const LABEL: Record<StatusPillState, string> = { run: 'Running', done: 'Done', err: 'Error' }
const TONE: Record<StatusPillState, string> = {
  run: 'border-info-border bg-info-bg text-info',
  done: 'border-ok-border bg-ok-bg text-ok',
  err: 'border-danger-border bg-danger-bg text-danger'
}

const glyph = 'absolute inset-0 flex items-center justify-center transition-[opacity,scale] duration-base ease-spring'

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  state: StatusPillState
  /** Overrides the visible/accessible label (defaults to Running / Done / Error). */
  label?: string
}

/** 22px pill. The three glyphs are stacked and crossfade + scale on state change; `err` shakes once. */
export function StatusPill({ state, label, className, ...props }: StatusPillProps): React.JSX.Element {
  const text = label ?? LABEL[state]
  return (
    <span
      role="status"
      data-state={state}
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border pl-1.5 pr-2 text-xs transition-colors duration-fast ease-out',
        TONE[state],
        state === 'err' && 'ccw-shake',
        className
      )}
      {...props}
    >
      <span className="relative inline-block size-3" aria-hidden>
        <span className={cn(glyph, state === 'run' ? 'scale-100 opacity-100' : 'scale-50 opacity-0')}>
          <Spinner size={12} className="text-info" />
        </span>
        <span className={cn(glyph, state === 'done' ? 'scale-100 opacity-100' : 'scale-50 opacity-0')}>
          <Check size={12} strokeWidth={2.5} />
        </span>
        <span className={cn(glyph, state === 'err' ? 'scale-100 opacity-100' : 'scale-50 opacity-0')}>
          <X size={12} strokeWidth={2.5} />
        </span>
      </span>
      <span>{text}</span>
    </span>
  )
}
