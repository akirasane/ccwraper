// Shared helpers for the item kind specs (WP5): tool-list parsing, D7 hand checks, zod issue mapping.
import type { ZodType } from 'zod'
import type { FrontmatterDoc } from '@shared/frontmatter'
import type { ItemIssue, ItemValidationCtx } from './types'

export type ToolListStyle = 'string' | 'list'

export interface ParsedToolList {
  style: ToolListStyle
  items: string[]
}

/** Split on commas / whitespace, but not inside parentheses (`Bash(git add:*, x)`). */
export function splitToolString(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && (ch === ',' || /\s/.test(ch))) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/** Undefined when the value is neither a string nor a string list. */
export function parseToolList(value: unknown): ParsedToolList | undefined {
  if (typeof value === 'string') return { style: 'string', items: splitToolString(value) }
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return { style: 'list', items: (value as string[]).map((v) => v.trim()).filter(Boolean) }
  }
  return undefined
}

/** Items back out in the given style: a string stays a string (", " joined), a list stays a list. */
export function formatToolList(items: string[], style: ToolListStyle): string | string[] {
  return style === 'string' ? items.join(', ') : [...items]
}

/** Apply a form edit to the original value, keeping its style (default: list when there was none). */
export function editToolList(original: unknown, items: string[]): string | string[] {
  return formatToolList(items, parseToolList(original)?.style ?? 'list')
}

export const TOOL_RULE_RE = /^[A-Za-z0-9_*:-]+(\(.*\))?$/
export const MODEL_ALIASES = ['opus', 'sonnet', 'fable', 'haiku'] as const

export function fileStem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  return base.replace(/\.md$/i, '')
}

/** The frontmatter parse error is the only `error` severity issue. */
export function parseErrorIssues(doc: FrontmatterDoc): ItemIssue[] {
  return doc.error ? [{ message: doc.error.message, severity: 'error' }] : []
}

/** Type issues from a zod schema, as warnings keyed by the top-level field. */
export function schemaIssues(schema: ZodType, data: Record<string, unknown>): ItemIssue[] {
  const res = schema.safeParse(data)
  if (res.success) return []
  return res.error.issues.map((i) => {
    const key = typeof i.path[0] === 'string' ? i.path[0] : undefined
    return { key, message: key ? `${key}: ${i.message}` : i.message, severity: 'warning' as const }
  })
}

/** Tool-rule shape (warning) and unknown tool names (info). */
export function toolListIssues(key: string, value: unknown, ctx: ItemValidationCtx): ItemIssue[] {
  const parsed = parseToolList(value)
  if (!parsed) return []
  const out: ItemIssue[] = []
  for (const entry of parsed.items) {
    if (!TOOL_RULE_RE.test(entry)) {
      out.push({ key, message: `"${entry}" is not a valid tool rule`, severity: 'warning' })
      continue
    }
    const name = entry.replace(/\(.*$/, '')
    if (ctx.knownTools && !name.startsWith('mcp__') && !ctx.knownTools.includes(name)) {
      out.push({ key, message: `"${name}" is not a tool in the current session`, severity: 'info' })
    }
  }
  return out
}

export function isKnownModel(model: string, ctx: ItemValidationCtx): boolean {
  if (model === 'inherit' || model === 'default') return true
  if ((MODEL_ALIASES as readonly string[]).includes(model)) return true
  if (model.startsWith('claude-')) return true
  return !!ctx.models?.some((m) => m.value === model || m.resolvedModel === model)
}

export function modelIssues(value: unknown, ctx: ItemValidationCtx): ItemIssue[] {
  if (typeof value !== 'string' || value === '') return []
  return isKnownModel(value, ctx)
    ? []
    : [{ key: 'model', message: `Unknown model "${value}"`, severity: 'warning' }]
}

export function missingTextIssue(data: Record<string, unknown>, key: string): ItemIssue[] {
  const v = data[key]
  return typeof v === 'string' && v.trim() !== '' ? [] : [{ key, message: `${key} is missing or empty`, severity: 'warning' }]
}
