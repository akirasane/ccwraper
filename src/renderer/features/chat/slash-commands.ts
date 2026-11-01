import type { SlashCommandInfo } from '@shared/events'
import { fuzzyScore } from '../palette/fuzzy'

/** Shown before the session starts (no query yet, so no supportedCommands()). */
export const FALLBACK_COMMANDS: SlashCommandInfo[] = [
  ['compact', 'Summarize the conversation to free up context', '[instructions]'],
  ['clear', 'Clear the conversation and start fresh', ''],
  ['context', 'Show context window usage', ''],
  ['cost', 'Show token usage and cost', ''],
  ['usage', 'Show plan usage limits', ''],
  ['model', 'Switch the model', '[model]'],
  ['init', 'Create a CLAUDE.md for this project', ''],
  ['review', 'Review a pull request', '[pr]'],
  ['memory', 'Edit memory files', ''],
  ['help', 'Show help and available commands', ''],
  ['agents', 'Manage subagents', ''],
  ['mcp', 'Manage MCP servers', ''],
  ['permissions', 'Manage tool permissions', ''],
  ['config', 'Open settings', '']
].map(([name, description, argumentHint]) => ({ name: name!, description: description!, argumentHint: argumentHint!, builtin: true }))

/**
 * The text after "/" while the caret is still inside the first token (no whitespace typed yet);
 * null when the popup should be closed.
 */
export function slashQuery(text: string, caret: number): string | null {
  if (!text.startsWith('/')) return null
  const ws = text.search(/\s/)
  const end = ws < 0 ? text.length : ws
  if (caret < 1 || caret > end) return null
  return text.slice(1, end)
}

/** Fuzzy filter by name and aliases. Empty query keeps the given order. */
export function filterCommands(commands: SlashCommandInfo[], query: string): SlashCommandInfo[] {
  const seen = new Set<string>()
  const unique = commands.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)))
  if (!query) return unique
  const scored: Array<{ c: SlashCommandInfo; s: number; i: number }> = []
  unique.forEach((c, i) => {
    let best = fuzzyScore(query, c.name)
    for (const a of c.aliases ?? []) {
      const s = fuzzyScore(query, a)
      if (s !== null && (best === null || s * 0.8 > best)) best = s * 0.8
    }
    if (best !== null) scored.push({ c, s: best, i })
  })
  scored.sort((a, b) => b.s - a.s || a.i - b.i)
  return scored.map((x) => x.c)
}

export function commandTag(c: SlashCommandInfo): string | undefined {
  if (c.builtin) return 'built-in'
  if (c.name.includes(':')) return 'plugin'
  return c.description || c.argumentHint ? 'skill' : undefined
}
