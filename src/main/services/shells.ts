import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ShellId, ShellProfile } from '../../shared/config'

export interface ShellDeps {
  exists: (p: string) => boolean
  /** Resolve an executable name like `where.exe` does. Returns [] when absent. */
  where: (name: string) => string[]
  env: Record<string, string | undefined>
}

/** Args per shell id. The renderer never supplies these. */
export const SHELL_ARGS: Record<ShellId, string[]> = {
  pwsh: ['-NoLogo'],
  powershell: ['-NoLogo'],
  cmd: [],
  gitbash: ['--login', '-i'],
  wsl: []
}

function defaultWhere(name: string): string[] {
  try {
    const out = execFileSync('where.exe', [name], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export const realShellDeps = (): ShellDeps => ({ exists: existsSync, where: defaultWhere, env: process.env })

const lower = (p: string): string => p.toLowerCase()

function pickPwsh(d: ShellDeps): string | undefined {
  const pf = d.env.ProgramFiles ?? 'C:\\Program Files'
  const preferred = path.win32.join(pf, 'PowerShell', '7', 'pwsh.exe')
  if (d.exists(preferred)) return preferred
  const found = d
    .where('pwsh')
    .filter((p) => d.exists(p))
    // The dotnet global-tool shim is a launcher, not the real binary: use it last.
    .sort((a, b) => Number(lower(a).includes('.dotnet')) - Number(lower(b).includes('.dotnet')))
  return found[0]
}

function pickGitBash(d: ShellDeps): string | undefined {
  const pf = d.env.ProgramFiles ?? 'C:\\Program Files'
  const candidates = [path.win32.join(pf, 'Git', 'bin', 'bash.exe')]
  for (const g of d.where('git')) {
    // ...\Git\cmd\git.exe -> ...\Git\bin\bash.exe
    candidates.push(path.win32.join(path.win32.dirname(path.win32.dirname(g)), 'bin', 'bash.exe'))
  }
  return candidates.find((c) => d.exists(c))
}

/** Pure detection (uncached). Order: pwsh, powershell, cmd, gitbash, wsl. */
export function detectShellsWith(d: ShellDeps): ShellProfile[] {
  const out: ShellProfile[] = []
  const sysRoot = d.env.SystemRoot ?? d.env.windir ?? 'C:\\Windows'

  const pwsh = pickPwsh(d)
  if (pwsh) out.push({ id: 'pwsh', label: 'PowerShell 7', path: pwsh })

  const winPs = path.win32.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (d.exists(winPs)) out.push({ id: 'powershell', label: 'Windows PowerShell', path: winPs })

  const cmd = d.env.ComSpec ?? path.win32.join(sysRoot, 'System32', 'cmd.exe')
  if (d.exists(cmd)) out.push({ id: 'cmd', label: 'Command Prompt', path: cmd })

  const bash = pickGitBash(d)
  if (bash) out.push({ id: 'gitbash', label: 'Git Bash', path: bash })

  const wsl = path.win32.join(sysRoot, 'System32', 'wsl.exe')
  if (d.exists(wsl)) out.push({ id: 'wsl', label: 'WSL', path: wsl })

  const def = out.find((s) => s.id === 'pwsh') ?? out.find((s) => s.id === 'powershell')
  if (def) def.isDefault = true
  return out
}

let cache: ShellProfile[] | undefined

export function detectShells(deps?: ShellDeps): ShellProfile[] {
  if (deps) return detectShellsWith(deps)
  cache ??= detectShellsWith(realShellDeps())
  return cache
}

export function resetShellCache(): void {
  cache = undefined
}
