// STUB (WP0). WP3 implements this file with the `yaml` library; the signatures are frozen.

export interface FrontmatterDoc {
  hasFrontmatter: boolean
  /** {} when absent or unparsable */
  data: Record<string, unknown>
  body: string
  bodyOffset: number
  yamlRange?: [number, number]
  error?: { message: string; from: number; to: number }
  eol: '\n' | '\r\n'
}

export type FmOp = { op: 'set'; key: string; value: unknown } | { op: 'delete'; key: string }

const NOT_IMPLEMENTED = 'frontmatter.ts is a WP0 stub; WP3 implements it'

export function parseFrontmatter(_text: string): FrontmatterDoc {
  throw new Error(NOT_IMPLEMENTED)
}

/** Throws on unparsable frontmatter; [] -> the same string. */
export function patchFrontmatter(_text: string, _ops: FmOp[]): string {
  throw new Error(NOT_IMPLEMENTED)
}

export function replaceBody(_text: string, _body: string): string {
  throw new Error(NOT_IMPLEMENTED)
}

export function keyRange(_text: string, _key: string): [number, number] | undefined {
  throw new Error(NOT_IMPLEMENTED)
}
