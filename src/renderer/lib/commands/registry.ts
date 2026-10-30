import { scoreCommand } from '@/features/palette/fuzzy'
import type { CommandGroup, PaletteCommand } from './types'

/** Fixed group order for query results (P4 D7). 'Recent' is only a display group. */
export const GROUP_ORDER: readonly CommandGroup[] = [
  'Recent',
  'Tabs',
  'Actions',
  'Navigation',
  'Sessions',
  'Projects',
  'Skills',
  'Commands',
  'Agents',
  'Slash commands'
]

export const MAX_ROWS = 50
/** With an empty query only these groups show (after Recent). */
const EMPTY_QUERY_GROUPS: readonly CommandGroup[] = ['Actions', 'Navigation']

export interface PaletteRow {
  /** Unique within the list (a recent copy of a command has its own key). */
  key: string
  group: CommandGroup
  command: PaletteCommand
}

/**
 * Filter and order commands for display.
 * Empty query: Recent (last runs, newest first) then Actions and Navigation.
 * Query: groups in fixed order, then score, then recency. At most MAX_ROWS rows.
 */
export function rankCommands(commands: PaletteCommand[], query: string, recentIds: string[]): PaletteRow[] {
  const byId = new Map<string, PaletteCommand>()
  for (const c of commands) if (!byId.has(c.id)) byId.set(c.id, c)
  const recentIdx = new Map(recentIds.map((id, i) => [id, i]))
  const rows: PaletteRow[] = []

  if (query.trim() === '') {
    const recents = recentIds.map((id) => byId.get(id)).filter((c): c is PaletteCommand => !!c)
    const seen = new Set<string>()
    for (const c of recents) {
      seen.add(c.id)
      rows.push({ key: `recent:${c.id}`, group: 'Recent', command: c })
    }
    for (const g of EMPTY_QUERY_GROUPS) {
      for (const c of byId.values()) {
        if (c.group === g && !seen.has(c.id)) rows.push({ key: c.id, group: g, command: c })
      }
    }
    return rows.slice(0, MAX_ROWS)
  }

  const scored: Array<{ c: PaletteCommand; score: number }> = []
  for (const c of byId.values()) {
    const s = scoreCommand(query, c)
    if (s !== null) scored.push({ c, score: s })
  }
  const rank = (g: CommandGroup): number => GROUP_ORDER.indexOf(g)
  scored.sort(
    (a, b) =>
      rank(a.c.group) - rank(b.c.group) ||
      b.score - a.score ||
      (recentIdx.get(a.c.id) ?? Infinity) - (recentIdx.get(b.c.id) ?? Infinity)
  )
  return scored.slice(0, MAX_ROWS).map(({ c }) => ({ key: c.id, group: c.group, command: c }))
}
