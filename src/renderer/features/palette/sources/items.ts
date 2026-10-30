import { useQueries } from '@tanstack/react-query'
import { Bot, Sparkles, Terminal } from 'lucide-react'
import type { ConfigItemList, ItemKind } from '@shared/config'
import { configKeys } from '@/lib/config-queries'
import type { CommandGroup, PaletteCommand } from '@/lib/commands/types'
import { useWorkspaceStore } from '@/stores/workspace-store'

const KINDS: ItemKind[] = ['skill', 'command', 'agent']
const META = {
  skill: { group: 'Skills', icon: Sparkles, view: 'skills' },
  command: { group: 'Commands', icon: Terminal, view: 'skills' },
  agent: { group: 'Agents', icon: Bot, view: 'agents' }
} as const satisfies Record<ItemKind, { group: CommandGroup; icon: unknown; view: 'skills' | 'agents' }>

/** Running an item command opens its page and asks it to select that item (`focusItem`). */
export function buildItemCommands(lists: Partial<Record<ItemKind, ConfigItemList | undefined>>): PaletteCommand[] {
  const out: PaletteCommand[] = []
  for (const kind of KINDS) {
    const m = META[kind]
    for (const it of lists[kind]?.items ?? []) {
      out.push({
        id: `item:${kind}:${it.scope}:${it.plugin ?? ''}:${it.name}`,
        title: kind === 'command' ? `/${it.name}` : it.name,
        subtitle: it.description,
        group: m.group,
        keywords: [it.scope, ...(it.plugin ? [it.plugin] : [])],
        icon: m.icon,
        run: () => {
          const s = useWorkspaceStore.getState()
          s.setFocusItem({ kind, name: it.name })
          s.setView(m.view)
        }
      })
    }
  }
  return out
}

/** `items.list` for the current cwd, cached by configKeys.items (fetched on open if missing). */
export function useItemCommands(): PaletteCommand[] {
  const cwd = useWorkspaceStore((s) => s.cwd)
  const results = useQueries({
    queries: KINDS.map((kind) => ({
      queryKey: configKeys.items(kind, cwd),
      queryFn: () => window.ccwrap.items.list({ kind, ...(cwd ? { cwd } : {}) }),
      enabled: !!window.ccwrap?.items
    }))
  })
  const lists: Partial<Record<ItemKind, ConfigItemList | undefined>> = {}
  KINDS.forEach((k, i) => (lists[k] = results[i]?.data))
  return buildItemCommands(lists)
}
