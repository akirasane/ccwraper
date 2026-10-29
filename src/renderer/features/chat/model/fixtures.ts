// Typed access to tests/fixtures/events/*.json (shared by WP4-WP8 tests and the design page).
import type { SessionEvent } from '@shared/events'
import doubleInit from '../../../../../tests/fixtures/events/double-init.json'
import historyReplay from '../../../../../tests/fixtures/events/history-replay.json'
import interruptedTurn from '../../../../../tests/fixtures/events/interrupted-turn.json'
import permissionFlow from '../../../../../tests/fixtures/events/permission-flow.json'
import textTurn from '../../../../../tests/fixtures/events/text-turn.json'
import toolEditTurn from '../../../../../tests/fixtures/events/tool-edit-turn.json'

const as = (x: unknown): SessionEvent[] => x as SessionEvent[]

export const eventFixtures = {
  textTurn: as(textTurn),
  toolEditTurn: as(toolEditTurn),
  permissionFlow: as(permissionFlow),
  interruptedTurn: as(interruptedTurn),
  doubleInit: as(doubleInit),
  historyReplay: as(historyReplay)
} as const
