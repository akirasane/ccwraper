import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import type { PtyDataPayload, PtyExitPayload, PtyOpenResult, ShellId, ShellProfile } from '../../shared/config'
import { SHELL_ARGS, detectShells } from './shells'

export const MAX_PTYS = 8
export const FLUSH_MS = 8
export const FLUSH_BYTES = 64 * 1024

/**
 * Use node-pty's bundled OpenConsole (conpty.dll) instead of the system conhost.exe.
 * Probe (P3 WP7): with the system conhost a shell that exits on its own leaves its
 * conhost.exe until the app quits and kill() after exit does not release it; with the
 * bundled OpenConsole, 0 host processes remain after a natural `exit` (pwsh, Git Bash).
 * Packaging (P4) must unpack node-pty's build/Release/conpty directory from the asar.
 */
export const USE_CONPTY_DLL = true

const STRIP_ENV =new Set(['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'ELECTRON_NO_ATTACH_CONSOLE'])

/** The subset of node-pty's IPty we use. */
export interface PtyLike {
  pid: number
  onData(cb: (data: string) => void): unknown
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): unknown
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export interface SpawnOptions {
  cwd: string
  cols: number
  rows: number
  env: Record<string, string>
  useConptyDll: boolean
}
export type PtySpawn = (file: string, args: string[], opts: SpawnOptions) => PtyLike

export interface PtyServiceDeps {
  spawn?: PtySpawn
  shells?: () => ShellProfile[]
  isDir?: (p: string) => boolean
  env?: Record<string, string | undefined>
  emitData: (ownerId: number, p: PtyDataPayload) => void
  emitExit: (ownerId: number, p: PtyExitPayload) => void
  flushMs?: number
  flushBytes?: number
  /** Kill a shell's whole process tree. Default: taskkill /T /F on win32 (node-pty's kill() leaves Git Bash children behind). */
  killTree?: (pid: number) => void
}

interface Entry {
  id: string
  ownerId: number
  pty: PtyLike
  buf: string
  timer?: ReturnType<typeof setTimeout>
  exited: boolean
}

const defaultIsDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

const defaultSpawn: PtySpawn = (file, args, opts) => {
  // Lazy: keeps the native module out of unit tests that inject a fake.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePty = require('node-pty') as typeof import('node-pty')
  return nodePty.spawn(file, args, {
    name: 'xterm-256color',
    cwd: opts.cwd,
    cols: opts.cols,
    rows: opts.rows,
    env: opts.env,
    useConpty: true,
    useConptyDll: opts.useConptyDll
  }) as unknown as PtyLike
}

const defaultKillTree = (pid: number): void => {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return
  execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.floor(n) || lo))

export function buildPtyEnv(src: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || STRIP_ENV.has(k.toUpperCase())) continue
    env[k] = v
  }
  env.TERM_PROGRAM = 'ccwraper'
  env.COLORTERM = 'truecolor'
  return env
}

export class PtyService {
  private readonly ptys = new Map<string, Entry>()
  private readonly spawn: PtySpawn
  private readonly shells: () => ShellProfile[]
  private readonly isDir: (p: string) => boolean
  private readonly env: Record<string, string | undefined>
  private readonly flushMs: number
  private readonly flushBytes: number

  private readonly killTree: (pid: number) => void

  constructor(private readonly deps: PtyServiceDeps) {
    this.spawn = deps.spawn ?? defaultSpawn
    this.shells = deps.shells ?? ((): ShellProfile[] => detectShells())
    this.isDir = deps.isDir ?? defaultIsDir
    this.env = deps.env ?? process.env
    this.flushMs = deps.flushMs ?? FLUSH_MS
    this.flushBytes = deps.flushBytes ?? FLUSH_BYTES
    this.killTree = deps.killTree ?? defaultKillTree
  }

  listShells(): ShellProfile[] {
    return this.shells()
  }

  get size(): number {
    return this.ptys.size
  }

  open(shellId: ShellId, cwd: string, cols: number, rows: number, ownerId: number): PtyOpenResult {
    const shell = this.shells().find((s) => s.id === shellId)
    if (!shell) throw new Error(`unknown or unavailable shell: ${String(shellId)}`)
    if (!this.isDir(cwd)) throw new Error('cwd is not an existing directory')
    if (this.ptys.size >= MAX_PTYS) throw new Error(`terminal limit reached (${MAX_PTYS})`)

    const pty = this.spawn(shell.path, SHELL_ARGS[shell.id] ?? [], {
      cwd,
      cols: clamp(cols, 2, 500),
      rows: clamp(rows, 2, 300),
      env: buildPtyEnv(this.env),
      useConptyDll: USE_CONPTY_DLL
    })
    const entry: Entry = { id: randomUUID(), ownerId, pty, buf: '', exited: false }
    this.ptys.set(entry.id, entry)

    pty.onData((data) => this.onData(entry, data))
    pty.onExit((e) => {
      entry.exited = true
      this.flush(entry)
      if (this.ptys.get(entry.id) === entry) {
        this.ptys.delete(entry.id)
        this.deps.emitExit(entry.ownerId, {
          ptyId: entry.id,
          exitCode: e.exitCode,
          ...(e.signal ? { signal: e.signal } : {})
        })
      }
    })
    return { ptyId: entry.id, pid: pty.pid, shellId: shell.id }
  }

  private onData(e: Entry, data: string): void {
    if (!this.ptys.has(e.id)) return
    e.buf += data
    if (e.buf.length >= this.flushBytes) {
      this.flush(e)
      return
    }
    e.timer ??= setTimeout(() => this.flush(e), this.flushMs)
  }

  private flush(e: Entry): void {
    if (e.timer) {
      clearTimeout(e.timer)
      e.timer = undefined
    }
    while (e.buf.length > 0) {
      const chunk = e.buf.slice(0, this.flushBytes)
      e.buf = e.buf.slice(chunk.length)
      this.deps.emitData(e.ownerId, { ptyId: e.id, data: chunk })
    }
  }

  private owned(ptyId: string, ownerId?: number): Entry | undefined {
    const e = this.ptys.get(ptyId)
    if (!e || e.exited) return undefined
    if (ownerId !== undefined && e.ownerId !== ownerId) return undefined
    return e
  }

  write(ptyId: string, data: string, ownerId?: number): void {
    const e = this.owned(ptyId, ownerId)
    if (!e) return
    try {
      e.pty.write(data)
    } catch {
      /* pty already gone */
    }
  }

  resize(ptyId: string, cols: number, rows: number, ownerId?: number): void {
    const e = this.owned(ptyId, ownerId)
    if (!e) return
    try {
      e.pty.resize(clamp(cols, 2, 500), clamp(rows, 2, 300))
    } catch {
      /* pty already gone */
    }
  }

  /** Silent kill: no exit event (the caller asked for it). */
  close(ptyId: string, ownerId?: number): void {
    const e = this.ptys.get(ptyId)
    if (!e || (ownerId !== undefined && e.ownerId !== ownerId)) return
    this.kill(e)
  }

  closeOwner(ownerId: number): void {
    for (const e of [...this.ptys.values()]) if (e.ownerId === ownerId) this.kill(e)
  }

  closeAll(): void {
    for (const e of [...this.ptys.values()]) this.kill(e)
  }

  private kill(e: Entry): void {
    this.ptys.delete(e.id)
    if (e.timer) clearTimeout(e.timer)
    e.timer = undefined
    e.buf = ''
    if (!e.exited) {
      try {
        this.killTree(e.pty.pid)
      } catch {
        /* best effort: pty.kill() below still runs */
      }
    }
    try {
      e.pty.kill()
    } catch {
      /* already dead */
    }
  }
}
