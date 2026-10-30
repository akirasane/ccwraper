// Zod-free. Best knowledge of current Claude Code docs (P3 D9); WP11 cross-checks agents live.
import type { ItemKind } from './config'

/**
 * Winner order (first beats later) for the same name in several scopes.
 * `null` = no documented winner: both rows get a conflict warning.
 */
export const ITEM_PRECEDENCE: Record<ItemKind, readonly ('user' | 'project' | 'plugin')[] | null> = {
  skill: ['user', 'project'],
  agent: ['project', 'user', 'plugin'],
  command: null
}

/** A skill with the same name as a command shadows the command. */
export const SKILL_SHADOWS_COMMAND = true
