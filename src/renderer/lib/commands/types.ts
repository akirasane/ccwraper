// Frozen by WP0 (P4 plan 2.10). Changes go through the lead.
import type { LucideIcon } from 'lucide-react'

export type CommandGroup =
  | 'Recent'
  | 'Tabs'
  | 'Actions'
  | 'Navigation'
  | 'Sessions'
  | 'Projects'
  | 'Skills'
  | 'Commands'
  | 'Agents'
  | 'Slash commands'

export interface PaletteCommand {
  id: string
  title: string
  group: CommandGroup
  subtitle?: string
  keywords?: string[]
  shortcut?: string[]
  icon?: LucideIcon
  disabled?: boolean
  run(): void | Promise<void>
}

/** A hook that returns commands from the current state. Collected when the palette opens. */
export type CommandSourceHook = () => PaletteCommand[]
