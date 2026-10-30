// Tiny bridge: the command palette inserts text (e.g. "/review ") into the mounted composer.
// Same pattern as terminal-bus. Frozen by WP0 (P4 plan 2.10); WP5 registers the inserter in Composer.

type Inserter = (text: string) => void

let inserter: Inserter | undefined

/** Composer side: register on mount, pass undefined on unmount. The latest registration wins. */
export function setComposerInserter(fn: Inserter | undefined): void {
  inserter = fn
}

/** Palette side. Returns false when no composer is mounted. */
export function insertIntoComposer(text: string): boolean {
  if (!inserter) return false
  inserter(text)
  return true
}
