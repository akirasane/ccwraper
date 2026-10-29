import * as React from 'react'
import { cn } from '@/lib/cn'
import type { DiffResult, DiffRow } from './compute-diff'

const ROW_LIMIT = 200

const rowTone: Record<DiffRow['kind'], string> = {
  add: 'bg-diff-add text-fg',
  del: 'bg-diff-del text-fg',
  ctx: 'text-fg-2',
  hunk: 'bg-bg-2 text-fg-3'
}
const gutterTone: Record<DiffRow['kind'], string> = {
  add: 'bg-[var(--diff-add-gutter)] text-ok',
  del: 'bg-[var(--diff-del-gutter)] text-danger',
  ctx: 'text-fg-muted',
  hunk: 'text-fg-muted'
}
const SIGN: Record<DiffRow['kind'], string> = { add: '+', del: '-', ctx: ' ', hunk: '' }

export interface DiffViewProps {
  diff: DiffResult
  /** Flash the changed rows once (set when the tool turns done). */
  flash?: boolean
  className?: string
}

/** Unified diff: two 36px gutters, 18px sign column, 20px rows. Long diffs show the first rows plus "show more". */
export function DiffView({ diff, flash = false, className }: DiffViewProps): React.JSX.Element {
  const [all, setAll] = React.useState(false)
  const rows = all ? diff.rows : diff.rows.slice(0, ROW_LIMIT)
  const hidden = diff.rows.length - rows.length
  return (
    <div className={cn('font-mono text-sm', className)} data-testid="diff-view">
      <div className="overflow-x-auto">
        {rows.map((r, i) => (
          <div
            key={i}
            data-kind={r.kind}
            className={cn('relative flex h-5 min-w-max items-center leading-5', rowTone[r.kind])}
          >
            {flash && (r.kind === 'add' || r.kind === 'del') && (
              <span
                aria-hidden
                data-testid="diff-flash"
                className="ccw-fade-out pointer-events-none absolute inset-0 bg-[var(--diff-flash)]"
              />
            )}
            <span className={cn('w-9 shrink-0 select-none px-1 text-right text-2xs', gutterTone[r.kind])}>
              {r.oldNo ?? ''}
            </span>
            <span className={cn('w-9 shrink-0 select-none px-1 text-right text-2xs', gutterTone[r.kind])}>
              {r.newNo ?? ''}
            </span>
            <span className={cn('w-[18px] shrink-0 select-none text-center', gutterTone[r.kind])} aria-hidden>
              {SIGN[r.kind]}
            </span>
            <span className="whitespace-pre pr-3">{r.text || ' '}</span>
          </div>
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="w-full rounded-xs px-3 py-1 text-left text-xs text-accent-text hover:bg-bg-3"
        >
          Show {hidden} more rows
        </button>
      )}
    </div>
  )
}
