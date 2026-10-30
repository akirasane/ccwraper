import { useVirtualizer } from '@tanstack/react-virtual'
import * as React from 'react'
import type { GitFileChange } from '@shared/git'
import { cn } from '@/lib/cn'

export type ChangeGroup = 'conflicted' | 'staged' | 'unstaged' | 'untracked'

export interface ChangeSelection {
  group: ChangeGroup
  path: string
}

export const GROUP_LABEL: Record<ChangeGroup, string> = {
  conflicted: 'Conflicts',
  staged: 'Staged',
  unstaged: 'Changes',
  untracked: 'Untracked'
}
const GROUP_ORDER: ChangeGroup[] = ['conflicted', 'staged', 'unstaged', 'untracked']

export function groupChanges(files: GitFileChange[]): Record<ChangeGroup, GitFileChange[]> {
  const g: Record<ChangeGroup, GitFileChange[]> = { conflicted: [], staged: [], unstaged: [], untracked: [] }
  for (const f of files) {
    if (f.conflicted) g.conflicted.push(f)
    else if (f.untracked) g.untracked.push(f)
    else {
      if (f.index !== '.') g.staged.push(f)
      if (f.worktree !== '.') g.unstaged.push(f)
    }
  }
  return g
}

function letterOf(group: ChangeGroup, f: GitFileChange): string {
  if (group === 'conflicted') return 'U'
  if (group === 'untracked') return '?'
  return group === 'staged' ? f.index : f.worktree
}

const letterTone: Record<string, string> = {
  M: 'text-warn',
  A: 'text-ok',
  D: 'text-danger',
  R: 'text-info',
  C: 'text-info',
  T: 'text-warn',
  U: 'text-danger',
  '?': 'text-fg-3'
}

type Item =
  | { kind: 'head'; group: ChangeGroup; count: number }
  | { kind: 'file'; group: ChangeGroup; file: GitFileChange }

const ROW_H = 28
export const VIRTUALIZE_ABOVE = 200

export interface ChangeListProps {
  files: GitFileChange[]
  selected: ChangeSelection | undefined
  onSelect: (s: ChangeSelection) => void
}

export function ChangeList({ files, selected, onSelect }: ChangeListProps): React.JSX.Element {
  const items = React.useMemo<Item[]>(() => {
    const g = groupChanges(files)
    const out: Item[] = []
    for (const group of GROUP_ORDER) {
      if (g[group].length === 0) continue
      out.push({ kind: 'head', group, count: g[group].length })
      for (const file of g[group]) out.push({ kind: 'file', group, file })
    }
    return out
  }, [files])

  const scrollRef = React.useRef<HTMLDivElement>(null)
  const virtual = items.length > VIRTUALIZE_ABOVE
  const virtualizer = useVirtualizer({
    count: virtual ? items.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12
  })

  const renderItem = (it: Item): React.JSX.Element => {
    if (it.kind === 'head') {
      return (
        <div
          key={`h:${it.group}`}
          role="presentation"
          data-testid={`group-${it.group}`}
          className="flex h-7 items-center gap-2 px-3 text-2xs font-medium uppercase tracking-wide text-fg-3"
        >
          {GROUP_LABEL[it.group]}
          <span className="rounded-xs bg-bg-3 px-1 text-fg-2">{it.count}</span>
        </div>
      )
    }
    const { group, file } = it
    const letter = letterOf(group, file)
    const active = selected?.group === group && selected.path === file.path
    return (
      <button
        key={`${group}:${file.path}`}
        type="button"
        role="option"
        aria-selected={active}
        data-testid="change-row"
        data-group={group}
        onClick={() => onSelect({ group, path: file.path })}
        className={cn(
          'flex h-7 w-full items-center gap-2 px-3 text-left text-sm transition-colors duration-fast',
          active ? 'bg-bg-3 text-fg' : 'text-fg-2 hover:bg-bg-2 hover:text-fg'
        )}
      >
        <span aria-label={`status ${letter}`} className={cn('w-3 shrink-0 text-center font-mono', letterTone[letter])}>
          {letter}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>
          {file.origPath ? `${file.origPath} -> ${file.path}` : file.path}
        </span>
        {file.added !== undefined && file.removed !== undefined && !file.binary && (
          <span className="shrink-0 font-mono text-2xs">
            <span className="text-ok">+{file.added}</span> <span className="text-danger">-{file.removed}</span>
          </span>
        )}
        {file.binary && <span className="shrink-0 text-2xs text-fg-muted">binary</span>}
      </button>
    )
  }

  if (!virtual) {
    return (
      <div ref={scrollRef} role="listbox" aria-label="Changed files" className="min-h-0 flex-1 overflow-y-auto py-1">
        {items.map(renderItem)}
      </div>
    )
  }
  return (
    <div ref={scrollRef} role="listbox" aria-label="Changed files" className="min-h-0 flex-1 overflow-y-auto py-1">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const it = items[v.index]
          if (!it) return null
          return (
            <div
              key={v.key}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_H, transform: `translateY(${v.start}px)` }}
            >
              {renderItem(it)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
