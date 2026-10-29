import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

export type ClaudeSource = 'env' | 'user' | 'bundled'
export interface ClaudeBinaryInfo {
  /** undefined => let the SDK use its bundled binary. */
  path?: string
  version?: string
  source: ClaudeSource
  /** Why a user binary was rejected in favour of the bundled one. */
  note?: string
}

/** Parse the leading x.y.z of a version string (e.g. '2.1.312 (Claude Code)'). */
export function parseVersion(s: string | undefined): [number, number, number] | undefined {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(s ?? '')
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

/** -1 / 0 / 1; unparsable inputs compare as 0 (unknown => do not reject). */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! < pb[i]! ? -1 : 1
  }
  return 0
}

function readJsonVersion(file: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { version?: string }).version
  } catch {
    return undefined
  }
}

/** Versions of the installed SDK package and its bundled CLI (manifest.json), read via fs (no SDK import). */
export function readSdkVersions(): { cli?: string; sdk?: string } {
  const starts = [process.cwd(), typeof __dirname === 'string' ? __dirname : undefined].filter(
    (x): x is string => !!x
  )
  for (const start of starts) {
    let dir = start
    for (;;) {
      const base = join(dir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk')
      if (existsSync(join(base, 'package.json'))) {
        const cli = readJsonVersion(join(base, 'manifest.json'))
        const sdk = readJsonVersion(join(base, 'package.json'))
        return { ...(cli ? { cli } : {}), ...(sdk ? { sdk } : {}) }
      }
      const up = dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  return {}
}

function findUserClaude(): string | undefined {
  const isWin = process.platform === 'win32'
  try {
    const out = execFileSync(isWin ? 'where.exe' : 'which', ['claude'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    })
    const candidates = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    // On Windows prefer a real .exe (the SDK spawns it directly; .cmd shims need a shell).
    const exe = candidates.find((c) => c.toLowerCase().endsWith('.exe'))
    if (exe) return exe
    if (!isWin && candidates[0]) return candidates[0]
  } catch {
    /* not on PATH */
  }
  const local = join(homedir(), '.local', 'bin', isWin ? 'claude.exe' : 'claude')
  return existsSync(local) ? local : undefined
}

function probeVersion(path: string): string | undefined {
  try {
    const out = execFileSync(path, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
    return parseVersion(out)?.join('.')
  } catch {
    return undefined
  }
}

let cached: ClaudeBinaryInfo | undefined

/** Test hook. */
export function resetClaudeBinaryCache(): void {
  cached = undefined
}

/**
 * Choose the claude binary (D1). CCWRAP_CLAUDE_PATH always wins; else the user's install if its
 * version is not older than the SDK's bundled CLI; else the bundled one. Cached after first call.
 */
export function resolveClaudeBinary(): ClaudeBinaryInfo {
  if (cached) return cached
  const bundledVersion = readSdkVersions().cli
  const bundled = (note?: string): ClaudeBinaryInfo => ({
    ...(bundledVersion ? { version: bundledVersion } : {}),
    source: 'bundled',
    ...(note ? { note } : {})
  })
  const fromEnv = process.env['CCWRAP_CLAUDE_PATH']
  if (fromEnv && existsSync(fromEnv)) {
    const version = probeVersion(fromEnv)
    return (cached = { path: fromEnv, ...(version ? { version } : {}), source: 'env' })
  }
  const user = findUserClaude()
  if (!user) return (cached = bundled())
  const version = probeVersion(user)
  if (version && (!bundledVersion || compareVersions(version, bundledVersion) >= 0))
    return (cached = { path: user, version, source: 'user' })
  const note = version
    ? `user claude ${version} is older than bundled ${bundledVersion}; using bundled`
    : 'could not read user claude version; using bundled'
  console.warn('[ccwrap]', note)
  return (cached = bundled(note))
}

/** Path for the SDK's pathToClaudeCodeExecutable; undefined => SDK bundled binary. */
export function resolveClaudeExecutable(): string | undefined {
  return resolveClaudeBinary().path
}

/** Stable comparison key for a cwd: resolved, no trailing separator (except a bare root), lowercased on Windows. */
export function normalizeCwdKey(p: string): string {
  let r = resolve(p)
  const root = parse(r).root
  while (r.length > root.length && /[\\/]$/.test(r)) r = r.slice(0, -1)
  return process.platform === 'win32' ? r.toLowerCase() : r
}
