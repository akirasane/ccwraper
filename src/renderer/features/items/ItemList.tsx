import { Lock, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ConfigItemList, ConfigItemSummary } from '@shared/config'
import { Button, Chip, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { refKey } from '@/lib/config-queries'
import { isLoadedInSession, type ItemChips } from './precedence'

export interface SessionLoaded {
  skills?: string[]
  agents?: string[]
  slashCommands?: string[]
}

function groupLabel(it: ConfigItemSummary): string {
  if (it.scope === 'plugin') return `Plugin: ${it.plugin ?? 'unknown'}`
  return it.scope === 'project' ? 'Project' : 'User'
}

function Row({
  item,
  chips,
  loaded,
  selected,
  onSelect
}: {
  item: ConfigItemSummary
  chips: ItemChips | undefined
  loaded: boolean
  selected: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        data-testid="item-row"
        className={cn(
          'flex w-full flex-col gap-1 rounded-md border px-2.5 py-2 text-left transition-colors duration-fast',
          selected ? 'border-accent-from/50 bg-accent-tint' : 'border-transparent hover:bg-bg-2'
        )}
      >
        <span className="flex items-center gap-1.5">
          {item.readOnly && <Lock size={12} aria-label="Read-only" className="shrink-0 text-fg-3" />}
          <span className="min-w-0 flex-1 truncate font-mono text-base text-fg">{item.kind === 'command' ? `/${item.name.replaceAll('/', ':')}` : item.name}</span>
        </span>
        {item.description && <span className="line-clamp-2 text-sm text-fg-3">{item.description}</span>}
        <span className="flex flex-wrap gap-1">
          {item.error && <Chip variant="danger">Broken frontmatter</Chip>}
          {item.warning && !item.error && <Chip variant="warn">{item.warning}</Chip>}
          {chips?.conflict && <Chip variant="danger">Conflict</Chip>}
          {chips?.shadowedBy && <Chip variant="warn">Shadowed by {chips.shadowedBy}</Chip>}
          {chips?.overrides && <Chip variant="ok">Overrides {chips.overrides}</Chip>}
          {chips?.shadowedBySkill && <Chip variant="warn">Shadowed by skill</Chip>}
          {loaded && <Chip variant="running">Loaded in session</Chip>}
          {item.readOnly && <Chip>Plugin (read-only)</Chip>}
        </span>
      </button>
    </li>
  )
}

export function ItemList({
  list,
  chips,
  loaded,
  selectedKey,
  onSelect,
  onNew,
  singular
}: {
  list: ConfigItemList
  chips: Map<ConfigItemSummary, ItemChips>
  loaded: SessionLoaded | undefined
  selectedKey: string | undefined
  onSelect: (item: ConfigItemSummary) => void
  onNew: () => void
  singular: string
}): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const m = new Map<string, ConfigItemSummary[]>()
    for (const it of list.items) {
      if (q && !`${it.name} ${it.description ?? ''} ${it.plugin ?? ''}`.toLowerCase().includes(q)) continue
      const g = groupLabel(it)
      const arr = m.get(g)
      if (arr) arr.push(it)
      else m.set(g, [it])
    }
    const rank = (g: string): number => (g === 'Project' ? 0 : g === 'User' ? 1 : 2)
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
  }, [list.items, filter])
  const missing = list.roots.filter((r) => !r.exists)

  return (
    <div className="flex min-h-0 w-[320px] shrink-0 flex-col gap-2 border-r border-border pr-3">
      <div className="flex gap-1.5">
        <Input aria-label={`Filter ${singular}s`} placeholder="Filter..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Button variant="primary" onClick={onNew}>
          <Plus size={14} /> New
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" role="region" aria-label={`${singular} list`}>
        {groups.map(([label, items]) => (
          <section key={label} className="mb-3" aria-label={label}>
            <h3 className="px-1 pb-1 text-xs font-medium uppercase tracking-wide text-fg-3">{label}</h3>
            <ul className="flex flex-col gap-0.5">
              {items.map((it) => (
                <Row
                  key={refKey(it.ref)}
                  item={it}
                  chips={chips.get(it)}
                  loaded={isLoadedInSession(it, loaded)}
                  selected={refKey(it.ref) === selectedKey}
                  onSelect={() => onSelect(it)}
                />
              ))}
            </ul>
          </section>
        ))}
        {list.items.length === 0 && <p className="px-1 text-base text-fg-3">No {singular}s found.</p>}
        {list.items.length > 0 && groups.length === 0 && <p className="px-1 text-base text-fg-3">Nothing matches the filter.</p>}
        <div className="mt-2 flex flex-col gap-1 px-1 text-sm text-fg-3">
          {list.roots.map((r) => (
            <p key={r.scope} className="break-all">
              <span className="font-medium text-fg-2">{r.scope}:</span> <code className="font-mono">{r.path}</code>
              {!r.exists && ' (folder does not exist yet)'}
            </p>
          ))}
          {missing.length > 0 && <p>It is created when you add the first {singular}.</p>}
          {!list.pluginsKnown && <p>Plugin {singular}s appear after a session has started.</p>}
        </div>
      </div>
    </div>
  )
}
