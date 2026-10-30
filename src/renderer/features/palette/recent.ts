// Recently run palette commands (P4 D7). Stored as a JSON string array under ccwrap.palette.recent.

export const RECENT_KEY = 'ccwrap.palette.recent'
export const RECENT_MAX = 8

export function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX)
  } catch {
    return []
  }
}

/** Newest first, deduped, at most RECENT_MAX. Returns the stored list. */
export function recordRecent(id: string): string[] {
  const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX)
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable: recents are a convenience only */
  }
  return next
}
