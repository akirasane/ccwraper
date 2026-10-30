// Frontmatter library (WP3). Pure: no node-only APIs, works in main and renderer.
// Untouched bytes stay verbatim: no ops -> the same string; the body is never re-serialized.

import { Document, Scalar, isMap, isScalar, parseDocument } from 'yaml'

export interface FrontmatterDoc {
  hasFrontmatter: boolean
  /** {} when absent or unparsable */
  data: Record<string, unknown>
  body: string
  bodyOffset: number
  yamlRange?: [number, number]
  error?: { message: string; from: number; to: number }
  /** strict parse failed, quote-fixed parse succeeded; data comes from the fixed text; error is kept (P4 D13 #4) */
  lenient?: { keys: string[] }
  eol: '\n' | '\r\n'
}

export type FmOp = { op: 'set'; key: string; value: unknown } | { op: 'delete'; key: string }

interface Parsed {
  info: FrontmatterDoc
  /** The parsed YAML document, only when the frontmatter parsed cleanly */
  doc?: Document.Parsed
  bomLen: number
}

const OPEN_RE = /^---[ \t]*$/
const CLOSE_RE = /^(?:---|\.\.\.)[ \t]*$/

function detectEol(text: string): '\n' | '\r\n' {
  const i = text.indexOf('\n')
  return i > 0 && text[i - 1] === '\r' ? '\r\n' : '\n'
}

/** Returns [lineStart, lineEnd (excl. EOL), nextLineStart] for the line at `pos`. */
function lineAt(text: string, pos: number): [number, number, number] {
  const nl = text.indexOf('\n', pos)
  if (nl < 0) return [pos, text.length, text.length]
  const end = nl > pos && text[nl - 1] === '\r' ? nl - 1 : nl
  return [pos, end, nl + 1]
}

function parseInternal(text: string, noLenient = false): Parsed {
  const bomLen = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const eol = detectEol(text)
  const none = (): Parsed => ({
    info: { hasFrontmatter: false, data: {}, body: text, bodyOffset: 0, eol },
    bomLen
  })

  if (text.length <= bomLen) return none()
  const [, openEnd, yamlStart] = lineAt(text, bomLen)
  if (!OPEN_RE.test(text.slice(bomLen, openEnd))) return none()

  // find the closing fence
  let pos = yamlStart
  let closeStart = -1
  let bodyOffset = -1
  while (pos < text.length) {
    const [ls, le, next] = lineAt(text, pos)
    if (CLOSE_RE.test(text.slice(ls, le))) {
      closeStart = ls
      bodyOffset = next
      break
    }
    pos = next
  }
  if (closeStart < 0) {
    return {
      info: {
        hasFrontmatter: true,
        data: {},
        body: text,
        bodyOffset: 0,
        eol,
        error: { message: 'Frontmatter is not closed: missing closing "---"', from: bomLen, to: openEnd }
      },
      bomLen
    }
  }

  const yamlText = text.slice(yamlStart, closeStart)
  const base = {
    hasFrontmatter: true,
    body: text.slice(bodyOffset),
    bodyOffset,
    yamlRange: [yamlStart, closeStart] as [number, number],
    eol
  }
  const fail = (message: string, from: number, to: number): Parsed => {
    const info: FrontmatterDoc = { ...base, data: {}, error: { message, from, to: Math.max(to, from) } }
    if (!noLenient) {
      const fixed = quoteUnsafeScalars(text)
      if (fixed.keys.length > 0) {
        const retry = parseInternal(fixed.text, true).info
        if (!retry.error && retry.hasFrontmatter) {
          info.data = retry.data
          info.lenient = { keys: fixed.keys }
        }
      }
    }
    return { info, bomLen }
  }

  let doc: Document.Parsed
  try {
    doc = parseDocument(yamlText, { prettyErrors: false })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), yamlStart, closeStart)
  }
  if (doc.errors.length > 0) {
    const err = doc.errors[0]
    const [a, b] = err?.pos ?? [0, 0]
    return fail(err?.message ?? 'Invalid YAML', yamlStart + a, yamlStart + b)
  }
  if (doc.contents !== null && !isMap(doc.contents)) {
    const r = doc.contents.range
    return fail(
      'Frontmatter must be a YAML mapping',
      yamlStart + (r ? r[0] : 0),
      yamlStart + (r ? r[1] : yamlText.length)
    )
  }
  let data: Record<string, unknown> = {}
  try {
    const js = doc.toJS()
    if (js && typeof js === 'object' && !Array.isArray(js)) data = js as Record<string, unknown>
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), yamlStart, closeStart)
  }
  return { info: { ...base, data }, doc, bomLen }
}

export function parseFrontmatter(text: string): FrontmatterDoc {
  return parseInternal(text).info
}

function toEol(s: string, eol: '\n' | '\r\n'): string {
  return eol === '\r\n' ? s.replace(/\r?\n/g, '\r\n') : s
}

function sameValue(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** Returns true when the document changed (no-op ops leave the bytes verbatim). */
function applyOps(doc: Document, ops: FmOp[]): boolean {
  let changed = false
  for (const op of ops) {
    if (op.op === 'delete') {
      if (doc.delete(op.key)) changed = true
      continue
    }
    const { key, value } = op
    if (doc.has(key) && sameValue(doc.get(key), value)) continue
    changed = true
    const multi = typeof value === 'string' && value.includes('\n')
    const cur = doc.get(key, true)
    const primitive = value === null || ['string', 'number', 'boolean'].includes(typeof value)
    if (isScalar(cur) && primitive) {
      // mutate in place: keeps the node's comments and position
      cur.value = value
      if (multi) cur.type = Scalar.BLOCK_LITERAL
    } else if (multi) {
      const s = new Scalar(value)
      s.type = Scalar.BLOCK_LITERAL
      doc.set(key, s)
    } else {
      doc.set(key, value)
    }
  }
  return changed
}

function serialize(doc: Document, eol: '\n' | '\r\n'): string {
  const c = doc.contents
  if (c === null || (isMap(c) && c.items.length === 0 && !doc.commentBefore && !doc.comment)) return ''
  return toEol(doc.toString({ lineWidth: 0, flowCollectionPadding: false }), eol)
}

/** Throws on unparsable frontmatter; [] -> the same string. */
export function patchFrontmatter(text: string, ops: FmOp[]): string {
  if (ops.length === 0) return text
  const { info, doc, bomLen } = parseInternal(text)
  if (info.error) throw new Error(`Cannot patch frontmatter: ${info.error.message}`)

  if (!info.hasFrontmatter || !doc) {
    if (!ops.some((o) => o.op === 'set')) return text
    const fresh = new Document({})
    applyOps(fresh, ops)
    const yamlOut = serialize(fresh, info.eol)
    if (yamlOut === '') return text
    const e = info.eol
    return text.slice(0, bomLen) + '---' + e + yamlOut + '---' + e + text.slice(bomLen)
  }

  if (!applyOps(doc, ops)) return text
  const [from, to] = info.yamlRange as [number, number]
  return text.slice(0, from) + serialize(doc, info.eol) + text.slice(to)
}

export function replaceBody(text: string, body: string): string {
  const { info, bomLen } = parseInternal(text)
  if (!info.hasFrontmatter) return text.slice(0, bomLen) + body
  if (!info.yamlRange) throw new Error(`Cannot replace body: ${info.error?.message ?? 'bad frontmatter'}`)
  return text.slice(0, info.bodyOffset) + body
}

/** Range of the first line of a top-level key, from the key start to the end of that line. */
export function keyRange(text: string, key: string): [number, number] | undefined {
  const { info, doc } = parseInternal(text)
  if (!doc || !info.yamlRange || !isMap(doc.contents)) return undefined
  for (const pair of doc.contents.items) {
    const k = pair.key
    if (isScalar(k) && k.value === key && k.range) {
      const start = info.yamlRange[0] + k.range[0]
      const [, end] = lineAt(text, start)
      return [start, end]
    }
  }
  return undefined
}

const KEY_LINE_RE = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]+(\S.*?)[ \t]*$/
const SPECIAL_START_RE = /^["'|>\[{&*!#%@`]/

/**
 * Quotes top-level plain scalars that contain ': ' (frontmatter only), so the CLI-accepted
 * `description: Use this agent: when ...` parses. Quoted values, block scalars, flow
 * collections, multi-line plain scalars, lists and the body are left untouched.
 */
export function quoteUnsafeScalars(text: string): { text: string; keys: string[] } {
  const bomLen = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const lines = text.split('\n')
  if (!OPEN_RE.test((lines[0] ?? '').slice(bomLen).replace(/\r$/, ''))) return { text, keys: [] }
  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (CLOSE_RE.test((lines[i] ?? '').replace(/\r$/, ''))) {
      close = i
      break
    }
  }
  if (close < 0) return { text, keys: [] }
  const keys: string[] = []
  for (let i = 1; i < close; i++) {
    const raw = lines[i] ?? ''
    const cr = raw.endsWith('\r') ? '\r' : ''
    const m = KEY_LINE_RE.exec(cr ? raw.slice(0, -1) : raw)
    if (!m) continue
    const key = m[1] as string
    const value = m[2] as string
    if (SPECIAL_START_RE.test(value) || !value.includes(': ')) continue
    const next = (lines[i + 1] ?? '').replace(/\r$/, '')
    if (i + 1 < close && /^[ \t]+\S/.test(next)) continue // multi-line plain scalar: leave alone
    lines[i] = `${key}: "${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"${cr}`
    keys.push(key)
  }
  return keys.length === 0 ? { text, keys } : { text: lines.join('\n'), keys }
}
