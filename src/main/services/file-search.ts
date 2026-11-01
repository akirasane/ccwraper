import { execFile } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fuzzyScore } from '../../shared/fuzzy'

// Backs the composer's @file mentions. Lists files under a session's cwd (git-aware, never follows
// symlinks) and ranks them for a query. Read-only; results are always relative to cwd.

export const MAX_FILES = 20_000
export const CACHE_TTL_MS = 15_000
const GIT_TIMEOUT_MS = 8_000
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', 'build', '.next', '.cache', '__pycache__', '.venv'])

export type ListFiles = (cwd: string) => Promise<string[]>

function gitLs(cwd: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return resolve(null)
        resolve(stdout.split('\0').filter(Boolean).slice(0, MAX_FILES))
      }
    )
  })
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = []
  const queue: string[] = ['']
  while (queue.length && out.length < MAX_FILES) {
    const rel = queue.shift()!
    let entries
    try {
      entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) queue.push(r)
      } else if (e.isFile()) {
        out.push(r)
        if (out.length >= MAX_FILES) break
      }
    }
  }
  return out
}

export async function listProjectFiles(cwd: string): Promise<string[]> {
  const viaGit = await gitLs(cwd)
  const files = viaGit && viaGit.length > 0 ? viaGit : await walk(cwd)
  return files.map((f) => f.replace(/\\/g, '/'))
}

/** Pure ranking: filename matches beat full-path matches; empty query favours short, shallow paths. */
export function rankFiles(files: readonly string[], query: string, limit: number): string[] {
  const q = query.trim()
  if (!q) {
    return [...files].sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length || a.localeCompare(b)).slice(0, limit)
  }
  const scored: Array<{ f: string; s: number }> = []
  for (const f of files) {
    const base = f.slice(f.lastIndexOf('/') + 1)
    const bs = fuzzyScore(q, base)
    const ps = fuzzyScore(q, f)
    if (bs === null && ps === null) continue
    // Literal substring / prefix hits in the filename dominate scattered subsequence matches.
    const lb = base.toLowerCase()
    const lq = q.toLowerCase()
    const bonus = lb.startsWith(lq) ? 120 : lb.includes(lq) ? 60 : f.toLowerCase().includes(lq) ? 30 : 0
    // Shorter paths win ties.
    scored.push({ f, s: Math.max((bs ?? 0) * 2, ps ?? 0) + bonus - f.length * 0.01 })
  }
  scored.sort((a, b) => b.s - a.s || a.f.localeCompare(b.f))
  return scored.slice(0, limit).map((x) => x.f)
}

export class FileSearchService {
  private cache = new Map<string, { at: number; files: Promise<string[]> }>()
  constructor(
    private list: ListFiles = listProjectFiles,
    private now: () => number = Date.now
  ) {}

  async search(args: { cwd: string; query: string; limit: number }): Promise<string[]> {
    const st = await fsp.stat(args.cwd).catch(() => null)
    if (!st?.isDirectory()) return []
    const key = path.resolve(args.cwd)
    let hit = this.cache.get(key)
    if (!hit || this.now() - hit.at > CACHE_TTL_MS) {
      hit = { at: this.now(), files: this.list(key).catch(() => []) }
      this.cache.set(key, hit)
      if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value as string)
    }
    return rankFiles(await hit.files, args.query, args.limit)
  }
}
