import { useQueries } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { ConfigFileRef, ConfigItemSummary, ItemKind } from '@shared/config'
import { Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { configKeys, refKey } from '@/lib/config-queries'
import { useChatStore } from '@/stores/chat-store'
import { useDirtyRegistry } from '@/stores/dirty-registry'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { loadCachedModels } from '../settings/FormTab'
import { ItemEditor } from './ItemEditor'
import { ItemList } from './ItemList'
import { NewItemDialog } from './ItemDialogs'
import { specFor } from './item-specs'
import { computeChips } from './precedence'

const EMPTY: never[] = []

/** List + editor for one or several item kinds (D10: Skills page = skill + command tabs, Agents page = agent). */
export function ItemsWorkspace({ kinds, cwd }: { kinds: ItemKind[]; cwd?: string }): React.JSX.Element {
  const [kind, setKind] = useState<ItemKind>(kinds[0]!)
  const [selected, setSelected] = useState<string | undefined>()
  const [tab, setTab] = useState<'form' | 'raw'>('form')
  const [creating, setCreating] = useState(false)
  const guard = useDirtyRegistry((s) => s.guard)

  // The skill list also feeds the "command shadowed by a skill" chip, so every shown kind is fetched.
  const wanted: ItemKind[] = kinds.includes('command') && !kinds.includes('skill') ? [...kinds, 'skill'] : kinds
  const results = useQueries({
    queries: wanted.map((k) => ({
      queryKey: configKeys.items(k, cwd),
      queryFn: () => window.ccwrap.items.list({ kind: k, cwd })
    }))
  })
  const byKind = new Map(wanted.map((k, i) => [k, results[i]!] as const))
  const current = byKind.get(kind)!
  const list = current.data
  const skillItems = byKind.get('skill')?.data?.items ?? EMPTY

  const chips = useMemo(() => (list ? computeChips(list.items, kind, skillItems) : new Map<ConfigItemSummary, never>()), [list, kind, skillItems])

  const activeConvId = useWorkspaceStore((s) => s.activeConvId)
  const meta = useChatStore((s) => (activeConvId ? s.convs[activeConvId]?.meta : undefined))
  const models = useMemo(() => loadCachedModels(), [])
  const knownTools = meta?.tools && meta.tools.length > 0 ? meta.tools : undefined

  const item = list?.items.find((i) => refKey(i.ref) === selected)
  const spec = specFor(kind)

  const switchKind = (k: ItemKind): void => {
    if (k === kind) return
    guard(() => {
      setKind(k)
      setSelected(undefined)
    })
  }
  const select = (it: ConfigItemSummary): void => {
    const key = refKey(it.ref)
    if (key === selected) return
    guard(() => setSelected(key))
  }
  const selectRef = (ref: ConfigFileRef): void => setSelected(refKey(ref))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-3">
      {kinds.length > 1 && (
        <div role="tablist" aria-label="Item kind" className="inline-flex w-fit gap-1 rounded-md border border-border bg-bg-1 p-0.5">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={k === kind}
              onClick={() => switchKind(k)}
              className={cn(
                'h-6 rounded-sm px-3 text-base transition-colors duration-fast',
                k === kind ? 'bg-accent-tint text-accent-text' : 'text-fg-2 hover:text-fg'
              )}
            >
              {specFor(k).plural}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-3">
        {current.isLoading || !list ? (
          current.error ? (
            <p role="alert" className="text-danger">
              Could not list {spec.plural.toLowerCase()}: {current.error instanceof Error ? current.error.message : String(current.error)}
            </p>
          ) : (
            <div role="status" className="flex items-center gap-2 text-fg-3">
              <Spinner size={14} /> Loading&hellip;
            </div>
          )
        ) : (
          <>
            <ItemList
              list={list}
              chips={chips}
              loaded={meta}
              selectedKey={selected}
              onSelect={select}
              onNew={() => setCreating(true)}
              singular={spec.label.toLowerCase()}
            />
            {item ? (
              <ItemEditor
                key={refKey(item.ref)}
                item={item}
                models={models}
                knownTools={knownTools}
                tab={tab}
                onTabChange={setTab}
                onRenamed={selectRef}
                onDeleted={() => setSelected(undefined)}
              />
            ) : (
              <p className="px-2 py-1 text-base text-fg-3">Select a {spec.label.toLowerCase()} to edit it, or create a new one.</p>
            )}
          </>
        )}
      </div>
      {creating && (
        <NewItemDialog
          kind={kind}
          cwd={cwd}
          open
          onOpenChange={setCreating}
          onCreated={(ref) => {
            setCreating(false)
            selectRef(ref)
          }}
        />
      )}
    </div>
  )
}
