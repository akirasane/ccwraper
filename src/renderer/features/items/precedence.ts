// Pure: which item wins when several share a name (P3 D9), plus the "loaded in session" lookup.
import type { ConfigItemSummary, ItemKind } from '@shared/config'
import { ITEM_PRECEDENCE, SKILL_SHADOWS_COMMAND } from '@shared/item-precedence'

export interface ItemChips {
  /** This item wins over another scope with the same name. */
  overrides?: string
  /** This item loses to the given scope. */
  shadowedBy?: string
  /** No documented winner: every row with the name warns. */
  conflict?: boolean
  /** A command hidden by a skill of the same name. */
  shadowedBySkill?: boolean
}

/** The name the CLI resolves: the frontmatter name for skills and agents, the path for commands. */
export function effectiveName(item: ConfigItemSummary): string {
  const n = item.kind === 'command' ? item.name.replaceAll('/', ':') : (item.frontmatterName ?? item.name)
  return n.toLowerCase()
}

export function computeChips(items: ConfigItemSummary[], kind: ItemKind, skillItems: ConfigItemSummary[] = []): Map<ConfigItemSummary, ItemChips> {
  const out = new Map<ConfigItemSummary, ItemChips>()
  const byName = new Map<string, ConfigItemSummary[]>()
  for (const it of items) {
    const k = effectiveName(it)
    const g = byName.get(k)
    if (g) g.push(it)
    else byName.set(k, [it])
  }
  const order = ITEM_PRECEDENCE[kind]
  for (const group of byName.values()) {
    if (group.length < 2) continue
    if (order === null) {
      for (const it of group) out.set(it, { ...out.get(it), conflict: true })
      continue
    }
    const rank = (s: string): number => {
      const i = order.indexOf(s as 'user' | 'project' | 'plugin')
      return i === -1 ? order.length : i
    }
    const sorted = [...group].sort((a, b) => rank(a.scope) - rank(b.scope))
    const winner = sorted[0]!
    const losers = sorted.slice(1).filter((l) => l.scope !== winner.scope)
    if (losers.length === 0) {
      // same scope twice: nothing documented, flag both
      for (const it of group) out.set(it, { ...out.get(it), conflict: true })
      continue
    }
    out.set(winner, { ...out.get(winner), overrides: losers.map((l) => l.scope).join(', ') })
    for (const l of losers) out.set(l, { ...out.get(l), shadowedBy: winner.scope })
  }
  if (kind === 'command' && SKILL_SHADOWS_COMMAND && skillItems.length > 0) {
    const skillNames = new Set(skillItems.map((s) => effectiveName(s)))
    for (const it of items) {
      if (skillNames.has(effectiveName(it))) out.set(it, { ...out.get(it), shadowedBySkill: true })
    }
  }
  return out
}

/** True when the active session reports this item as loaded. Plugin entries are `plugin:name`. */
export function isLoadedInSession(item: ConfigItemSummary, loaded: { skills?: string[]; agents?: string[]; slashCommands?: string[] } | undefined): boolean {
  if (!loaded) return false
  const list = item.kind === 'skill' ? loaded.skills : item.kind === 'agent' ? loaded.agents : loaded.slashCommands
  if (!list || list.length === 0) return false
  const want = effectiveName(item)
  return list.some((raw) => {
    const n = raw.replace(/^\//, '').toLowerCase()
    if (n === want) return true
    return item.scope === 'plugin' && n === `${(item.plugin ?? '').toLowerCase()}:${want}`
  })
}
