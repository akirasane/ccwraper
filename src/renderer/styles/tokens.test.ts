/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')
const rendererDir = resolve(__dirname, '..')

describe('design tokens', () => {
  it('renderer copy is byte-identical to docs/design/tokens.css', () => {
    const source = readFileSync(join(root, 'docs/design/tokens.css'))
    const copy = readFileSync(join(rendererDir, 'styles/tokens.css'))
    expect(copy.equals(source)).toBe(true)
  })

  it('theme.css maps every color token it references to a defined token', () => {
    const tokens = readFileSync(join(rendererDir, 'styles/tokens.css'), 'utf8')
    const theme = readFileSync(join(rendererDir, 'styles/theme.css'), 'utf8')
    const refs = [...theme.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1])
    const missing = refs.filter((r) => !new RegExp(`${r}\\s*:`).test(tokens))
    expect(missing).toEqual([])
  })

  it('styles.css no longer carries the obsolete P0 --text* vars', () => {
    const css = readFileSync(join(rendererDir, 'styles.css'), 'utf8')
    expect(css).not.toMatch(/--text(-[23])?\s*:/)
    for (const f of ['styles/base.css', 'styles/theme.css']) {
      expect(readFileSync(join(rendererDir, f), 'utf8')).not.toMatch(/var\(--text-[23]\)|var\(--text\)/)
    }
  })
})

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

describe('no hex literals in components', () => {
  it('components/** and features/** contain no #rgb / #rrggbb(aa) literals', () => {
    const files = [...walk(join(rendererDir, 'components')), ...walk(join(rendererDir, 'features'))].filter(
      (f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f)
    )
    const hits: string[] = []
    for (const f of files) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line: string, i: number) => {
          if (/#[0-9a-fA-F]{3,8}\b/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`)
        })
    }
    expect(hits).toEqual([])
  })
})
