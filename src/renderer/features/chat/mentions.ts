export interface MentionMatch {
  /** Text typed after the "@". */
  query: string
  /** Index of the "@" in the draft. */
  start: number
}

/**
 * The active `@mention` token ending at the caret, or null. The "@" must start the text or follow
 * whitespace (so emails and `a@b` do not trigger it) and the token has no whitespace yet.
 */
export function mentionAt(text: string, caret: number): MentionMatch | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)))
  const m = /(?:^|\s)@([^\s@]*)$/.exec(before)
  if (!m) return null
  const query = m[1]!
  return { query, start: before.length - query.length - 1 }
}

/** Mention text for a path; quoted when it contains whitespace. */
export const mentionText = (path: string): string => (/\s/.test(path) ? `@"${path}"` : `@${path}`)

/** Replace the active token with the chosen path plus a trailing space. Returns the new text and caret. */
export function applyMention(text: string, caret: number, m: MentionMatch, path: string): { text: string; caret: number } {
  const insert = `${mentionText(path)} `
  const next = text.slice(0, m.start) + insert + text.slice(caret)
  return { text: next, caret: m.start + insert.length }
}
