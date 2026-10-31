import type { CommandSourceHook, PaletteCommand } from '@/lib/commands/types'
import { useActionCommands } from './actions'
import { useModeCommands } from './modes'
import { useItemCommands } from './items'
import { useNavigationCommands } from './navigation'
import { useProjectCommands } from './projects'
import { useSessionCommands } from './sessions'
import { useSlashCommands } from './slash'
import { useTabCommands } from './tabs'

/** The one registry: every source hook. Call order is fixed, so hooks inside are stable. */
export const COMMAND_SOURCES: readonly CommandSourceHook[] = [
  useTabCommands,
  useActionCommands,
  useModeCommands,
  useNavigationCommands,
  useSessionCommands,
  useProjectCommands,
  useItemCommands,
  useSlashCommands
]

/** Collect all commands. Only mount where the palette is open. */
export function useAllCommands(): PaletteCommand[] {
  const out: PaletteCommand[] = []
  for (const source of COMMAND_SOURCES) out.push(...source())
  return out
}
