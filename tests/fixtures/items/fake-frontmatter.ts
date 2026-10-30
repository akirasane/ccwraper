// Stand-in for src/shared/frontmatter.ts while that file is still the WP0 stub (WP3 lands the yaml implementation).
// Handles only `key: value` lines between `---` fences; a line `!!broken` is a parse error.
export function parseFrontmatter(text: string) {
  const eol = text.includes('\r\n') ? ('\r\n' as const) : ('\n' as const)
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!m) return { hasFrontmatter: false, data: {} as Record<string, unknown>, body: text, bodyOffset: 0, eol }
  const data: Record<string, unknown> = {}
  for (const line of m[1]!.split(/\r?\n/)) {
    if (line.startsWith('!!broken')) {
      return {
        hasFrontmatter: true,
        data: {} as Record<string, unknown>,
        body: text.slice(m[0].length),
        bodyOffset: m[0].length,
        error: { message: 'bad YAML', from: 4, to: 8 },
        eol
      }
    }
    const kv = /^([A-Za-z-]+):\s*(.*)$/.exec(line)
    if (kv) data[kv[1]!] = kv[2]
  }
  return { hasFrontmatter: true, data, body: text.slice(m[0].length), bodyOffset: m[0].length, eol }
}
export const patchFrontmatter = (t: string) => t
export const replaceBody = (t: string) => t
export const keyRange = () => undefined
