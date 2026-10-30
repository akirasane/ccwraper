import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync } from 'node:fs'
import type { PtyDataPayload, PtyExitPayload, ShellProfile } from '../../shared/config'
import { MAX_PTYS, PtyService, buildPtyEnv } from './pty-service'
import type { PtyLike, SpawnOptions } from './pty-service'

class FakePty implements PtyLike {
  pid = 1000 + Math.floor(Math.random() * 1000)
  killed = false
  written: string[] = []
  sizes: Array<[number, number]> = []
  dataCb: (d: string) => void = () => {}
  exitCb: (e: { exitCode: number; signal?: number }) => void = () => {}
  onData(cb: (d: string) => void): void {
    this.dataCb = cb
  }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void {
    this.exitCb = cb
  }
  write(d: string): void {
    this.written.push(d)
  }
  resize(c: number, r: number): void {
    this.sizes.push([c, r])
  }
  kill(): void {
    this.killed = true
  }
}

const SHELLS: ShellProfile[] = [
  { id: 'pwsh', label: 'PowerShell 7', path: 'C:\\pwsh.exe', isDefault: true },
  { id: 'gitbash', label: 'Git Bash', path: 'C:\\bash.exe' }
]

function make(extra: Partial<ConstructorParameters<typeof PtyService>[0]> = {}) {
  const ptys: FakePty[] = []
  const spawned: Array<{ file: string; args: string[]; opts: SpawnOptions }> = []
  const data: Array<[number, PtyDataPayload]> = []
  const exits: Array<[number, PtyExitPayload]> = []
  const treeKilled: number[] = []
  const svc = new PtyService({
    spawn: (file, args, opts) => {
      const p = new FakePty()
      ptys.push(p)
      spawned.push({ file, args, opts })
      return p
    },
    shells: () => SHELLS,
    isDir: (p) => p !== 'C:\\missing',
    env: { PATH: 'x', ELECTRON_RUN_AS_NODE: '1', ELECTRON_RENDERER_URL: 'u', SECRET: 's' },
    emitData: (o, p) => data.push([o, p]),
    emitExit: (o, p) => exits.push([o, p]),
    killTree: (pid) => treeKilled.push(pid),
    ...extra
  })
  return { svc, ptys, spawned, data, exits, treeKilled }
}

describe('PtyService (fake pty)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('open spawns the detected shell with fixed args and filtered env', () => {
    const { svc, spawned } = make()
    const r = svc.open('gitbash', 'C:\\proj', 100, 30, 1)
    expect(r.shellId).toBe('gitbash')
    expect(spawned[0]!.file).toBe('C:\\bash.exe')
    expect(spawned[0]!.args).toEqual(['--login', '-i'])
    const env = spawned[0]!.opts.env
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.ELECTRON_RENDERER_URL).toBeUndefined()
    expect(env.TERM_PROGRAM).toBe('ccwraper')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env.PATH).toBe('x')
  })

  it('spawns with the bundled OpenConsole so a self-exited shell leaves no conhost', () => {
    const { svc, spawned, ptys, treeKilled, exits } = make()
    const r = svc.open('pwsh', 'C:\\proj', 80, 24, 1)
    expect(spawned[0]!.opts.useConptyDll).toBe(true)
    ptys[0]!.exitCb({ exitCode: 0 })
    svc.close(r.ptyId, 1)
    svc.closeAll()
    expect(exits).toHaveLength(1)
    // natural exit needs no tree kill, and close() after exit never runs one
    expect(treeKilled).toEqual([])
  })

  it('buildPtyEnv strips electron vars case-insensitively', () => {
    const e = buildPtyEnv({ electron_run_as_node: '1', ELECTRON_NO_ATTACH_CONSOLE: '1', A: 'b', U: undefined })
    expect(Object.keys(e).sort()).toEqual(['A', 'COLORTERM', 'TERM_PROGRAM'])
  })

  it('rejects unknown shell id and missing cwd', () => {
    const { svc, spawned } = make()
    expect(() => svc.open('wsl', 'C:\\proj', 80, 24, 1)).toThrow(/shell/)
    expect(() => svc.open('C:\\evil.exe' as never, 'C:\\proj', 80, 24, 1)).toThrow(/shell/)
    expect(() => svc.open('pwsh', 'C:\\missing', 80, 24, 1)).toThrow(/cwd/)
    expect(spawned).toHaveLength(0)
  })

  it('enforces the cap', () => {
    const { svc } = make()
    for (let i = 0; i < MAX_PTYS; i++) svc.open('pwsh', 'C:\\p', 80, 24, 1)
    expect(() => svc.open('pwsh', 'C:\\p', 80, 24, 1)).toThrow(/limit/)
    expect(svc.size).toBe(MAX_PTYS)
  })

  it('merges chunks into one flush after 8ms', () => {
    const { svc, ptys, data } = make()
    const { ptyId } = svc.open('pwsh', 'C:\\p', 80, 24, 7)
    ptys[0]!.dataCb('a')
    ptys[0]!.dataCb('b')
    ptys[0]!.dataCb('c')
    expect(data).toHaveLength(0)
    vi.advanceTimersByTime(8)
    expect(data).toEqual([[7, { ptyId, data: 'abc' }]])
  })

  it('flushes immediately at 64KB, in chunks of at most 64KB', () => {
    const { svc, ptys, data } = make()
    svc.open('pwsh', 'C:\\p', 80, 24, 1)
    ptys[0]!.dataCb('x'.repeat(64 * 1024 + 10))
    expect(data.map(([, p]) => p.data.length)).toEqual([64 * 1024, 10])
  })

  it('exit flushes pending data first, emits exit, and cleans up', () => {
    const { svc, ptys, data, exits } = make()
    const { ptyId } = svc.open('pwsh', 'C:\\p', 80, 24, 3)
    ptys[0]!.dataCb('bye')
    ptys[0]!.exitCb({ exitCode: 2 })
    expect(data[0]![1].data).toBe('bye')
    expect(exits).toEqual([[3, { ptyId, exitCode: 2 }]])
    expect(svc.size).toBe(0)
    svc.resize(ptyId, 100, 40)
    svc.write(ptyId, 'x')
    expect(ptys[0]!.sizes).toHaveLength(0)
    expect(ptys[0]!.written).toHaveLength(0)
  })

  it('write and resize forward; resize is clamped; foreign owner ignored', () => {
    const { svc, ptys } = make()
    const { ptyId } = svc.open('pwsh', 'C:\\p', 80, 24, 1)
    svc.write(ptyId, 'ls', 1)
    svc.write(ptyId, 'evil', 2)
    svc.resize(ptyId, 9999, 0, 1)
    svc.resize(ptyId, 90, 30, 2)
    expect(ptys[0]!.written).toEqual(['ls'])
    expect(ptys[0]!.sizes).toEqual([[500, 2]])
  })

  it('close kills silently and drops buffered data; other owner cannot close', () => {
    const { svc, ptys, data, exits } = make()
    const { ptyId } = svc.open('pwsh', 'C:\\p', 80, 24, 1)
    ptys[0]!.dataCb('pending')
    svc.close(ptyId, 2)
    expect(ptys[0]!.killed).toBe(false)
    svc.close(ptyId, 1)
    expect(ptys[0]!.killed).toBe(true)
    vi.advanceTimersByTime(50)
    expect(data).toHaveLength(0)
    expect(exits).toHaveLength(0)
    expect(svc.size).toBe(0)
  })

  it('close kills the whole process tree of a live shell, not of an exited one', () => {
    const { svc, ptys, treeKilled } = make()
    const a = svc.open('gitbash', 'C:\p', 80, 24, 1)
    svc.close(a.ptyId, 1)
    expect(treeKilled).toEqual([ptys[0]!.pid])
    const b = svc.open('pwsh', 'C:\p', 80, 24, 1)
    ptys[1]!.exitCb({ exitCode: 0 })
    svc.close(b.ptyId, 1)
    expect(treeKilled).toHaveLength(1)
  })

  it('closeOwner kills only that owner; closeAll kills the rest', () => {
    const { svc, ptys } = make()
    svc.open('pwsh', 'C:\\p', 80, 24, 1)
    svc.open('pwsh', 'C:\\p', 80, 24, 2)
    svc.open('pwsh', 'C:\\p', 80, 24, 1)
    svc.closeOwner(1)
    expect(ptys.map((p) => p.killed)).toEqual([true, false, true])
    expect(svc.size).toBe(1)
    svc.closeAll()
    expect(ptys.every((p) => p.killed)).toBe(true)
    expect(svc.size).toBe(0)
  })
})

describe.runIf(process.platform === 'win32')('PtyService (real node-pty)', () => {
  it('cmd.exe /c echo round-trips with exit code 0', async () => {
    const cwd = 'D:\\claude-tmp'
    if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true })
    let out = ''
    const done = new Promise<PtyExitPayload>((resolve) => {
      const svc = new PtyService({
        shells: () => [{ id: 'cmd', label: 'cmd', path: process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe' }],
        emitData: (_o, p) => {
          out += p.data
        },
        emitExit: (_o, p) => resolve(p)
      })
      // Test-only: pass extra args through a wrapping spawn is not allowed by the service,
      // so drive the real shell by writing the command to it.
      const { ptyId } = svc.open('cmd', cwd, 80, 24, 1)
      svc.write(ptyId, 'echo ccwrap-pty-ok\r')
      svc.write(ptyId, 'exit 0\r')
    })
    const exit = await done
    expect(exit.exitCode).toBe(0)
    expect(out).toContain('ccwrap-pty-ok')
  }, 20000)
})
