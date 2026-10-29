import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, parse, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

/**
 * Locate the user's installed `claude` binary. Returns undefined to let the
 * SDK fall back to its bundled executable (optional dep @anthropic-ai/claude-agent-sdk-<platform>).
 * Order: CCWRAP_CLAUDE_PATH env -> `where`/`which` on PATH -> ~/.local/bin.
 */
export function resolveClaudeExecutable(): string | undefined {
  const fromEnv = process.env['CCWRAP_CLAUDE_PATH']
  if (fromEnv && existsSync(fromEnv)) return fromEnv

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
  if (existsSync(local)) return local
  return undefined
}

/** Stable comparison key for a cwd: resolved, no trailing separator (except a bare root), lowercased on Windows. */
export function normalizeCwdKey(p: string): string {
  let r = resolve(p)
  const root = parse(r).root
  while (r.length > root.length && /[\\/]$/.test(r)) r = r.slice(0, -1)
  return process.platform === 'win32' ? r.toLowerCase() : r
}
