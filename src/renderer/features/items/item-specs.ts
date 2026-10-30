import type { ItemKind } from '@shared/config'
import { agentSpec } from './kinds/agent'
import { commandSpec } from './kinds/command'
import { skillSpec } from './kinds/skill'
import type { ItemKindSpec } from './kinds/types'

const SPECS: Record<ItemKind, ItemKindSpec> = { skill: skillSpec, command: commandSpec, agent: agentSpec }

export function specFor(kind: ItemKind): ItemKindSpec {
  return SPECS[kind]
}
