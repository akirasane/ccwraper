import { create } from 'zustand'
import { MAX_EXTRA_DIRS } from '@shared/ipc'

const KEY = 'ccwrap.extraDirs.v1'

/** Comparison key: slash style, trailing slash and case do not distinguish folders on Windows. */
export const dirKey = (p: string): string => p.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()

function load(): Record<string, string[]> {
  try {
    const raw = window.localStorage.getItem(KEY)
    const v: unknown = raw ? JSON.parse(raw) : {}
    if (!v || typeof v !== 'object') return {}
    const out: Record<string, string[]> = {}
    for (const [k, dirs] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(dirs)) out[k] = dirs.filter((d): d is string => typeof d === 'string' && d.length > 0).slice(0, MAX_EXTRA_DIRS)
    }
    return out
  } catch {
    return {}
  }
}

function save(byCwd: Record<string, string[]>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(byCwd))
  } catch {
    /* storage unavailable: folders just will not persist */
  }
}

export type AddResult = { ok: true } | { ok: false; reason: string }

interface ExtraDirsState {
  /** Extra folders per project, keyed by `dirKey(cwd)`. Passed as `--add-dir` when a session starts. */
  byCwd: Record<string, string[]>
  dirsFor: (cwd: string) => string[]
  add: (cwd: string, dir: string) => AddResult
  remove: (cwd: string, dir: string) => void
}

const NONE: string[] = []

export const useExtraDirs = create<ExtraDirsState>((set, get) => ({
  byCwd: load(),
  dirsFor: (cwd) => get().byCwd[dirKey(cwd)] ?? NONE,
  add: (cwd, dir) => {
    const key = dirKey(cwd)
    const cur = get().byCwd[key] ?? []
    if (dirKey(dir) === key) return { ok: false, reason: 'That is already the project folder.' }
    if (cur.some((d) => dirKey(d) === dirKey(dir))) return { ok: false, reason: 'That folder is already added.' }
    if (cur.length >= MAX_EXTRA_DIRS) return { ok: false, reason: `At most ${MAX_EXTRA_DIRS} extra folders.` }
    const byCwd = { ...get().byCwd, [key]: [...cur, dir] }
    save(byCwd)
    set({ byCwd })
    return { ok: true }
  },
  remove: (cwd, dir) => {
    const key = dirKey(cwd)
    const next = (get().byCwd[key] ?? []).filter((d) => dirKey(d) !== dirKey(dir))
    const byCwd = { ...get().byCwd }
    if (next.length) byCwd[key] = next
    else delete byCwd[key]
    save(byCwd)
    set({ byCwd })
  }
}))

/** Selector helper with a stable empty array. */
export const selectExtraDirs = (cwd: string | undefined) => (s: ExtraDirsState): string[] =>
  cwd ? (s.byCwd[dirKey(cwd)] ?? NONE) : NONE
