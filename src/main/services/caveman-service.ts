import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import { CAVEMAN_MODES, EMPTY_CAVEMAN } from '../../shared/limits'
import type { CavemanState } from '../../shared/limits'

/** The caveman plugin's two status files, in the Claude config dir. */
export const CAVEMAN_ACTIVE_FILE = '.caveman-active'
export const CAVEMAN_SUFFIX_FILE = '.caveman-statusline-suffix'
export const CAVEMAN_MAX_BYTES = 64
export const CAVEMAN_POLL_MS = 15_000

/** Reads at most CAVEMAN_MAX_BYTES of a regular file; undefined for a symlink, a non-file, a missing or unreadable file. */
export async function readCapped(file: string): Promise<string | undefined> {
  try {
    const st = await lstat(file)
    if (st.isSymbolicLink() || !st.isFile()) return undefined
    const fh = await open(file, 'r')
    try {
      const buf = Buffer.alloc(CAVEMAN_MAX_BYTES)
      const { bytesRead } = await fh.read(buf, 0, CAVEMAN_MAX_BYTES, 0)
      return buf.subarray(0, bytesRead).toString('utf8')
    } finally {
      await fh.close()
    }
  } catch {
    return undefined
  }
}

/** Lowercased, trimmed and whitelisted mode; null for anything else and for "off". */
export function parseCavemanMode(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const m = raw.replace(/[\x00-\x1f\x7f]/g, '').trim().toLowerCase()
  if (m === 'off' || !(CAVEMAN_MODES as readonly string[]).includes(m)) return null
  return m
}

/** Strips ANSI/ESC sequences, control bytes and a truncated multi-byte tail; null when nothing printable is left. */
export function sanitizeSuffix(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const s = raw
    // CSI (ESC [ ... final), OSC (ESC ] ... BEL/ST) and two-byte ESC sequences
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
    .replace(/\x1b[\s\S]?/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/�/g, '')
    .trim()
  return s || null
}

export interface CavemanServiceDeps {
  /** The Claude config dir (paths.claudeConfigDir()). */
  configDir: string
  broadcast: (state: CavemanState) => void
  pollMs?: number
}

/**
 * READ-ONLY view of the caveman plugin's status files. Polls on an interval (and on demand via refresh()) and
 * broadcasts only changes. Never writes, deletes or follows symlinks.
 */
export class CavemanService {
  private state: CavemanState = EMPTY_CAVEMAN
  private timer: ReturnType<typeof setInterval> | undefined
  private inFlight: Promise<CavemanState> | undefined

  constructor(private deps: CavemanServiceDeps) {}

  getState(): CavemanState {
    return this.state
  }

  start(): void {
    if (this.timer) return
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), this.deps.pollMs ?? CAVEMAN_POLL_MS)
    this.timer.unref?.()
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  /** Re-read the files now; resolves with the (possibly unchanged) state. */
  refresh(): Promise<CavemanState> {
    this.inFlight ??= this.read().finally(() => {
      this.inFlight = undefined
    })
    return this.inFlight
  }

  private async read(): Promise<CavemanState> {
    const mode = parseCavemanMode(await readCapped(join(this.deps.configDir, CAVEMAN_ACTIVE_FILE)))
    const suffix = mode ? sanitizeSuffix(await readCapped(join(this.deps.configDir, CAVEMAN_SUFFIX_FILE))) : null
    const next: CavemanState = { mode, suffix }
    if (next.mode !== this.state.mode || next.suffix !== this.state.suffix) {
      this.state = next
      this.deps.broadcast(next)
    }
    return this.state
  }
}
