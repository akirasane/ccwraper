// Pure path-patch helpers for the settings form. The form never re-serializes from a schema:
// it parses the current text, applies path ops, and serializes with the file's own indent / EOL.
// Key order is kept and untouched keys keep their values exactly (P2 D4).

export type PatchOp = { op: 'set'; path: string[]; value: unknown } | { op: 'delete'; path: string[] }

export interface TextFormat {
  /** A string of spaces/tabs, or a number of spaces. Default 2. */
  indent: string | number
  eol: '\n' | '\r\n'
  trailingNewline: boolean
}

export type ParseResult = { ok: true; value: Record<string, unknown> } | { ok: false; message: string }

/** Parse a settings buffer. Empty / whitespace-only text is an empty object (missing file). */
export function parseSettingsText(text: string): ParseResult {
  if (text.trim() === '') return { ok: true, value: {} }
  try {
    const v: unknown = JSON.parse(text)
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return { ok: false, message: 'Root must be a JSON object' }
    return { ok: true, value: v as Record<string, unknown> }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export function detectFormat(text: string): TextFormat {
  const eol: TextFormat['eol'] = text.includes('\r\n') ? '\r\n' : '\n'
  const trailingNewline = text.length === 0 ? true : /\n\s*$/.test(text)
  let indent: string | number = 2
  const m = /\r?\n([ \t]+)\S/.exec(text)
  if (m?.[1]) indent = m[1].includes('\t') ? '\t' : m[1].length
  return { indent, eol, trailingNewline }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

// Keys that must never be walked into (prototype pollution through a hostile key).
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Apply ops to the JSON text and return the new text.
 * - `set` creates missing intermediate objects (and remembers that it created them).
 * - `delete` removes the leaf; a parent emptied by it is removed only when this patch created that parent.
 * - Throws when the text does not parse as an object (callers gate on parseSettingsText first).
 */
export function applyPatch(text: string, ops: PatchOp[]): string {
  const parsed = parseSettingsText(text)
  if (!parsed.ok) throw new Error(parsed.message)
  const fmt = detectFormat(text)
  const root = parsed.value
  const created = new Set<Record<string, unknown>>()

  for (const op of ops) {
    if (op.path.length === 0 || op.path.some((k) => BAD_KEYS.has(k))) throw new Error('Invalid path')
    const chain: Array<{ obj: Record<string, unknown>; key: string }> = []
    let cur = root
    for (let i = 0; i < op.path.length - 1; i++) {
      const key = op.path[i]!
      let next = Object.hasOwn(cur, key) ? cur[key] : undefined
      if (!isObj(next)) {
        if (op.op === 'delete') {
          next = undefined
          break
        }
        next = {}
        cur[key] = next
        created.add(next as Record<string, unknown>)
      }
      chain.push({ obj: cur, key })
      cur = next as Record<string, unknown>
    }
    const leaf = op.path[op.path.length - 1]!
    if (op.op === 'set') {
      cur[leaf] = op.value
    } else if (chain.length === op.path.length - 1) {
      delete cur[leaf]
      // prune parents this patch created and that are now empty
      for (let i = chain.length - 1; i >= 0; i--) {
        const { obj, key } = chain[i]!
        const child = obj[key] as Record<string, unknown>
        if (created.has(child) && Object.keys(child).length === 0) delete obj[key]
        else break
      }
    }
  }

  let out = JSON.stringify(root, null, fmt.indent)
  if (fmt.eol === '\r\n') out = out.replaceAll('\n', '\r\n')
  return fmt.trailingNewline ? out + fmt.eol : out
}

/** Read a value at a path from a parsed object. */
export function getAt(obj: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = obj
  for (const k of path) {
    if (!isObj(cur) || !Object.hasOwn(cur, k)) return undefined
    cur = cur[k]
  }
  return cur
}
