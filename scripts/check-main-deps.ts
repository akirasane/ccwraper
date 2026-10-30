// Asserts every require("x") / import("x") / bare `from "x"` in out/main/index.js is a declared dependency or a Node builtin.
// Run after `npm run build`: npx tsx scripts/check-main-deps.ts
import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
const declared = new Set(Object.keys(pkg.dependencies ?? {}))
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]))
builtins.add('electron')

function pkgName(spec: string): string {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec)
}

const files = ['out/main/index.js', 'out/preload/index.js']
let bad = 0
for (const f of files) {
  let src: string
  try {
    src = readFileSync(join(root, f), 'utf8')
  } catch {
    console.log(`SKIP ${f} (not built)`)
    continue
  }
  const specs = new Set<string>()
  for (const m of src.matchAll(/\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/g)) specs.add(m[1]!)
  for (const m of src.matchAll(/^\s*(?:import|export)\s[^;'"]*?from\s*["']([^"']+)["']/gm)) specs.add(m[1]!)
  for (const s of [...specs].sort()) {
    if (s.startsWith('.') || s.startsWith('/')) continue
    const ok = builtins.has(s) || declared.has(pkgName(s))
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${f}: ${s}`)
    if (!ok) bad++
  }
}
if (bad) {
  console.error(`${bad} undeclared runtime import(s) in the main/preload bundle`)
  process.exit(1)
}
console.log('main-deps check passed')
