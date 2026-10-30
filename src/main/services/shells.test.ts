import { describe, expect, it } from 'vitest'
import { detectShellsWith } from './shells'
import type { ShellDeps } from './shells'

const PWSH7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
const SHIM = 'C:\\Users\\u\\.dotnet\\tools\\pwsh.exe'
const WINPS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const CMD = 'C:\\Windows\\System32\\cmd.exe'
const BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
const WSL = 'C:\\Windows\\System32\\wsl.exe'

function deps(existing: string[], where: Record<string, string[]> = {}): ShellDeps {
  const set = new Set(existing.map((s) => s.toLowerCase()))
  return {
    exists: (p) => set.has(p.toLowerCase()),
    where: (n) => where[n] ?? [],
    env: { ProgramFiles: 'C:\\Program Files', SystemRoot: 'C:\\Windows', ComSpec: CMD }
  }
}

describe('detectShellsWith', () => {
  it('detects all five in order with pwsh default', () => {
    const r = detectShellsWith(deps([PWSH7, WINPS, CMD, BASH, WSL]))
    expect(r.map((s) => s.id)).toEqual(['pwsh', 'powershell', 'cmd', 'gitbash', 'wsl'])
    expect(r[0]!.isDefault).toBe(true)
    expect(r.filter((s) => s.isDefault)).toHaveLength(1)
  })

  it('prefers Program Files pwsh over the dotnet shim', () => {
    const r = detectShellsWith(deps([PWSH7, SHIM], { pwsh: [SHIM, PWSH7] }))
    expect(r.find((s) => s.id === 'pwsh')?.path).toBe(PWSH7)
    expect(r.filter((s) => s.id === 'pwsh')).toHaveLength(1)
  })

  it('falls back to where.exe pwsh, shim last', () => {
    const other = 'D:\\tools\\pwsh.exe'
    const r = detectShellsWith(deps([SHIM, other], { pwsh: [SHIM, other] }))
    expect(r.find((s) => s.id === 'pwsh')?.path).toBe(other)
    const r2 = detectShellsWith(deps([SHIM], { pwsh: [SHIM] }))
    expect(r2.find((s) => s.id === 'pwsh')?.path).toBe(SHIM)
  })

  it('defaults to powershell when pwsh is missing', () => {
    const r = detectShellsWith(deps([WINPS, CMD]))
    expect(r.map((s) => s.id)).toEqual(['powershell', 'cmd'])
    expect(r[0]!.isDefault).toBe(true)
  })

  it('derives git bash from where git', () => {
    const git = 'D:\\Git\\cmd\\git.exe'
    const bash = 'D:\\Git\\bin\\bash.exe'
    const r = detectShellsWith(deps([bash, CMD], { git: [git] }))
    expect(r.find((s) => s.id === 'gitbash')?.path).toBe(bash)
  })

  it('omits shells that do not exist', () => {
    expect(detectShellsWith(deps([]))).toEqual([])
  })
})
