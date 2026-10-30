import { execFile, execFileSync } from 'node:child_process'
import { existsSync, promises as fsp, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { GitCode, GitCommit, GitDiff, GitErrorCode, GitFileChange, GitLog, GitStatus } from '../../shared/git'
import { isSafeRepoPath } from '../../shared/ipc'
import { detectShells } from './shells'

// D6: a READ-ONLY view over `git`. Only status / diff / log / rev-parse are ever run, via execFile
// (never a shell), with every knob that lets a repo's own config execute a program switched off.

export const MAX_ENTRIES = 2000
export const MAX_DIFF_BYTES = 1024 * 1024
export const MAX_DIFF_LINES = 5000
export const NUMSTAT_SKIP_ABOVE = 500
export const GIT_TIMEOUT_MS = 15_000
export const GIT_MAX_BUFFER = 8 * 1024 * 1024

export interface GitRunOpts {
  cwd: string
  timeoutMs?: number
  maxBuffer?: number
  /** GIT_* variables to add AFTER the ambient ones were dropped (GIT_INDEX_FILE only) */
  extraEnv?: Record<string, string>
}
export interface GitRunResult {
  code: number
  stdout: string
  stderr: string
  timedOut?: boolean
  /** stdout hit maxBuffer; stdout holds the partial output */
  overflow?: boolean
}
/** Injected runner. `args` is the COMPLETE git argument list (global flags included), no binary. */
export type GitRun = (args: string[], opts: GitRunOpts) => Promise<GitRunResult>

export interface GitServiceDeps {
  run?: GitRun
}

/** Flags placed before every subcommand. */
export const GLOBAL_FLAGS: readonly string[] = [
  '--no-optional-locks',
  '-c',
  'core.quotepath=false',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.pager=cat',
  '-c',
  'color.ui=false',
  '-c',
  'log.showSignature=false'
]
const DIFF_FLAGS = ['--no-ext-diff', '--no-textconv', '--no-color']
export const ALLOWED_COMMANDS: readonly string[] = ['status', 'diff', 'log', 'rev-parse']

// ---------- pure parsers ----------

const CODES = new Set(['M', 'A', 'D', 'R', 'C', 'T', 'U'])
const toCode = (c: string | undefined): GitCode => (c && CODES.has(c) ? (c as GitCode) : '.')

export interface ParsedStatus {
  branch?: string
  detached: boolean
  upstream?: string
  ahead: number
  behind: number
  files: GitFileChange[]
}

/** `status --porcelain=v2 --branch -z` output. Ignored ('!') entries are skipped. */
export function parseStatusV2(out: string): ParsedStatus {
  const res: ParsedStatus = { detached: false, ahead: 0, behind: 0, files: [] }
  const toks = out.split('\0')
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (!t) continue
    if (t.startsWith('# ')) {
      const [key, ...rest] = t.slice(2).split(' ')
      const val = rest.join(' ')
      if (key === 'branch.head') {
        if (val === '(detached)') res.detached = true
        else res.branch = val
      } else if (key === 'branch.upstream') res.upstream = val
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(val)
        if (m) {
          res.ahead = Number(m[1])
          res.behind = Number(m[2])
        }
      }
    } else if (t.startsWith('1 ')) {
      // 1 XY sub mH mI mW hH hI path
      const p = t.split(' ')
      const xy = p[1] ?? '..'
      res.files.push({ path: p.slice(8).join(' '), index: toCode(xy[0]), worktree: toCode(xy[1]) })
    } else if (t.startsWith('2 ')) {
      // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
      const p = t.split(' ')
      const xy = p[1] ?? '..'
      const orig = toks[++i] ?? ''
      res.files.push({
        path: p.slice(9).join(' '),
        origPath: orig,
        index: toCode(xy[0]),
        worktree: toCode(xy[1])
      })
    } else if (t.startsWith('u ')) {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const p = t.split(' ')
      res.files.push({ path: p.slice(10).join(' '), index: 'U', worktree: 'U', conflicted: true })
    } else if (t.startsWith('? ')) {
      const pth = t.slice(2)
      const f: GitFileChange = { path: pth, index: '?', worktree: '?', untracked: true }
      if (pth.endsWith('/')) f.isDir = true
      res.files.push(f)
    }
    // '! ' (ignored) and unknown lines are skipped
  }
  return res
}

export interface NumstatEntry {
  added?: number
  removed?: number
  binary?: boolean
}

/** `diff --numstat -z`. Returns a map keyed by the (new) path. */
export function parseNumstat(out: string): Map<string, NumstatEntry> {
  const map = new Map<string, NumstatEntry>()
  const toks = out.split('\0')
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (!t) continue
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(t)
    if (!m) continue
    let pth = m[3] ?? ''
    if (pth === '') {
      // rename: "a\tr\t\0old\0new"
      i++ // old
      pth = toks[++i] ?? ''
    }
    map.set(
      pth,
      m[1] === '-' ? { binary: true } : { added: Number(m[1]), removed: Number(m[2]) }
    )
  }
  return map
}

function mergeNumstat(a: NumstatEntry | undefined, b: NumstatEntry | undefined): NumstatEntry | undefined {
  if (!a) return b
  if (!b) return a
  if (a.binary || b.binary) return { binary: true }
  return { added: (a.added ?? 0) + (b.added ?? 0), removed: (a.removed ?? 0) + (b.removed ?? 0) }
}

/** `log --format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e` */
export function parseLog(out: string): GitCommit[] {
  const commits: GitCommit[] = []
  for (const rec of out.split('\x1e')) {
    const r = rec.replace(/^\r?\n/, '')
    if (!r) continue
    const [hash, short, subject, author, date] = r.split('\x1f')
    if (!hash || !short) continue
    commits.push({ hash, short, subject: subject ?? '', author: author ?? '', date: date ?? '' })
  }
  return commits
}

// ---------- error mapping ----------

export function mapGitFailure(r: Pick<GitRunResult, 'stderr' | 'timedOut'>): { code: GitErrorCode; message: string } {
  const msg = r.stderr.trim()
  if (r.timedOut) return { code: 'timeout', message: 'git timed out' }
  if (/not a git repository/i.test(msg)) return { code: 'not_repo', message: msg.split('\n')[0] ?? msg }
  if (/dubious ownership|safe\.directory/i.test(msg)) return { code: 'unsafe_repo', message: msg }
  return { code: 'error', message: msg.split('\n')[0] || 'git failed' }
}

const fail = (code: GitErrorCode, message: string): { ok: false; code: GitErrorCode; message: string } => ({
  ok: false,
  code,
  message
})

// ---------- binary + runner ----------

function whereGit(): string[] {
  try {
    return execFileSync('where.exe', ['git'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export interface ResolveDeps {
  exists: (p: string) => boolean
  where: () => string[]
  gitBash: () => string | undefined
}

/** where.exe git, then Program Files, then the Git Bash install that shells.ts detects. */
export function resolveGitBinary(
  d: ResolveDeps = {
    exists: existsSync,
    where: whereGit,
    gitBash: () => {
      try {
        return detectShells().find((s) => s.id === 'gitbash')?.path
      } catch {
        return undefined
      }
    }
  }
): string | undefined {
  for (const p of d.where()) if (/git\.exe$/i.test(p) && d.exists(p)) return p
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const std = path.win32.join(pf, 'Git', 'cmd', 'git.exe')
  if (d.exists(std)) return std
  const bash = d.gitBash()
  if (bash) {
    const cand = path.win32.join(path.win32.dirname(path.win32.dirname(bash)), 'cmd', 'git.exe')
    if (d.exists(cand)) return cand
  }
  return undefined
}

/** The repo-controlled/ambient GIT_* variables are dropped; ours are set explicitly. */
export function sanitizedEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue
    if (/^GIT_/i.test(k)) continue
    env[k] = v
  }
  env['GIT_OPTIONAL_LOCKS'] = '0'
  env['GIT_TERMINAL_PROMPT'] = '0'
  env['GIT_LITERAL_PATHSPECS'] = '1'
  env['GIT_PAGER'] = 'cat'
  env['LC_ALL'] = 'C'
  return env
}

let cachedBinary: string | undefined | null = null

export const execGit: GitRun = (args, opts) => {
  if (cachedBinary === null) cachedBinary = resolveGitBinary()
  const bin = cachedBinary
  if (!bin) return Promise.reject(Object.assign(new Error('git not found'), { code: 'ENOENT' }))
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        cwd: opts.cwd,
        env: { ...sanitizedEnv(), ...(opts.extraEnv ?? {}) },
        windowsHide: true,
        timeout: opts.timeoutMs ?? GIT_TIMEOUT_MS,
        maxBuffer: opts.maxBuffer ?? GIT_MAX_BUFFER,
        encoding: 'utf8'
      },
      (err, stdout, stderr) => {
        if (!err) return resolve({ code: 0, stdout, stderr })
        const e = err as NodeJS.ErrnoException & { killed?: boolean; stdout?: string; stderr?: string }
        if (e.code === 'ENOENT') return reject(e)
        if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
          return resolve({ code: 0, stdout: e.stdout ?? stdout ?? '', stderr: e.stderr ?? stderr ?? '', overflow: true })
        if (e.killed) return resolve({ code: -1, stdout, stderr, timedOut: true })
        resolve({ code: typeof e.code === 'number' ? e.code : 1, stdout, stderr: stderr || e.message })
      }
    )
  })
}

// ---------- service ----------

function truncateText(s: string): { text: string; truncated: boolean } {
  let truncated = false
  let text = s
  if (Buffer.byteLength(text) > MAX_DIFF_BYTES) {
    text = Buffer.from(text).subarray(0, MAX_DIFF_BYTES).toString('utf8').replace(/\uFFFD+$/, '')
    truncated = true
  }
  let idx = -1
  for (let n = 0; n < MAX_DIFF_LINES; n++) {
    idx = text.indexOf('\n', idx + 1)
    if (idx < 0) break
  }
  if (idx >= 0 && idx + 1 < text.length) {
    text = text.slice(0, idx + 1)
    truncated = true
  }
  return { text, truncated }
}

const isDirectory = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

export class GitService {
  private run: GitRun
  constructor(deps: GitServiceDeps = {}) {
    this.run = deps.run ?? execGit
  }

  private async git(
    cwd: string,
    cmd: string,
    args: string[],
    extra: Partial<GitRunOpts> = {}
  ): Promise<GitRunResult> {
    if (!ALLOWED_COMMANDS.includes(cmd)) throw new Error(`git command not allowed: ${cmd}`)
    const pre = cmd === 'diff' ? DIFF_FLAGS : []
    return this.run([...GLOBAL_FLAGS, cmd, ...pre, ...args], { cwd, ...extra })
  }

  /** Runs, converting spawn failures into a typed error result. */
  private async safe(
    cwd: string,
    cmd: string,
    args: string[],
    extra?: Partial<GitRunOpts>
  ): Promise<GitRunResult | { ok: false; code: GitErrorCode; message: string }> {
    try {
      return await this.git(cwd, cmd, args, extra)
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return fail('git_missing', 'git was not found')
      return fail('error', e instanceof Error ? e.message : String(e))
    }
  }

  private checkCwd(cwd: string): { ok: false; code: GitErrorCode; message: string } | undefined {
    if (typeof cwd !== 'string' || cwd.includes('\0') || !path.isAbsolute(cwd) || !isDirectory(cwd))
      return fail('bad_path', 'cwd must be an existing absolute directory')
    return undefined
  }

  private async toplevel(cwd: string) {
    const r = await this.safe(cwd, 'rev-parse', ['--show-toplevel', '--git-path', 'index'])
    if ('ok' in r) return r
    if (r.code !== 0 || r.timedOut) return fail(...failArgs(r))
    const [top, idx] = r.stdout.split(/\r?\n/)
    return {
      ok: true as const,
      root: path.normalize((top ?? '').trim()),
      indexPath: idx?.trim() ? path.resolve(cwd, idx.trim()) : undefined
    }
  }

  /**
   * `git diff` refreshes stat-dirty index entries and rewrites .git/index (taking index.lock) even
   * with --no-optional-locks; only `status` honours it. Run diffs against a throwaway COPY of the
   * index (GIT_INDEX_FILE) so the real index and its lock are never touched.
   */
  private async withIndexCopy<T>(indexPath: string | undefined, fn: (env: Record<string, string>) => Promise<T>): Promise<T> {
    let dir: string | undefined
    const env: Record<string, string> = {}
    if (indexPath && existsSync(indexPath)) {
      try {
        dir = await fsp.mkdtemp(path.join(tmpdir(), 'ccwrap-gitidx-'))
        const copy = path.join(dir, 'index')
        await fsp.copyFile(indexPath, copy)
        env['GIT_INDEX_FILE'] = copy
      } catch {
        env['GIT_INDEX_FILE'] = ''
        delete env.GIT_INDEX_FILE
      }
    }
    try {
      return await fn(env)
    } finally {
      if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async status(a: { cwd: string }): Promise<GitStatus> {
    const bad = this.checkCwd(a.cwd)
    if (bad) return bad
    const top = await this.toplevel(a.cwd)
    if (!top.ok) return top
    const root = top.root

    const st = await this.safe(root, 'status', ['--porcelain=v2', '--branch', '-z', '--untracked-files=normal'])
    if ('ok' in st) return st
    if (st.code !== 0 || st.timedOut) return fail(...failArgs(st))
    const parsed = parseStatusV2(st.stdout)
    const total = parsed.files.length
    const files = parsed.files.slice(0, MAX_ENTRIES)

    if (total > 0 && total <= NUMSTAT_SKIP_ABOVE) {
      const [wt, ix] = await this.withIndexCopy(top.indexPath, (extraEnv) =>
        Promise.all([
          this.safe(root, 'diff', ['--numstat', '-z'], { extraEnv }),
          this.safe(root, 'diff', ['--cached', '--numstat', '-z'], { extraEnv })
        ])
      )
      const wtMap = 'ok' in wt || wt.code !== 0 ? new Map<string, NumstatEntry>() : parseNumstat(wt.stdout)
      const ixMap = 'ok' in ix || ix.code !== 0 ? new Map<string, NumstatEntry>() : parseNumstat(ix.stdout)
      for (const f of files) {
        const n = mergeNumstat(ixMap.get(f.path), wtMap.get(f.path))
        if (!n) continue
        if (n.binary) f.binary = true
        else {
          f.added = n.added
          f.removed = n.removed
        }
      }
    }

    return {
      ok: true,
      root,
      branch: parsed.branch,
      detached: parsed.detached,
      upstream: parsed.upstream,
      ahead: parsed.ahead,
      behind: parsed.behind,
      files,
      truncated: total > MAX_ENTRIES,
      total
    }
  }

  async diff(a: { cwd: string; path: string; staged: boolean }): Promise<GitDiff> {
    const bad = this.checkCwd(a.cwd)
    if (bad) return bad
    if (!isSafeRepoPath(a.path)) return fail('bad_path', 'path must be repo-relative')
    const top = await this.toplevel(a.cwd)
    if (!top.ok) return top
    const root = top.root

    const isDirEntry = a.path.endsWith('/') || a.path.endsWith('\\')
    if (isDirEntry) return { ok: true, binary: false, truncated: false }

    const d = await this.withIndexCopy(top.indexPath, (extraEnv) =>
      this.safe(root, 'diff', [...(a.staged ? ['--cached'] : []), '-U3', '--', a.path], { extraEnv })
    )
    if ('ok' in d) return d
    if (d.code !== 0 || d.timedOut) return fail(...failArgs(d))

    if (d.stdout.trim() === '' && !a.staged) {
      const u = await this.untracked(root, a.path)
      if (u) return u
    }
    if (/^Binary files .* differ$/m.test(d.stdout) || /^GIT binary patch$/m.test(d.stdout))
      return { ok: true, binary: true, truncated: false }

    const { text, truncated } = truncateText(d.stdout)
    return { ok: true, patch: text, binary: false, truncated: truncated || !!d.overflow }
  }

  /** Returns a result when `rel` is an untracked entry, otherwise undefined. */
  private async untracked(root: string, rel: string): Promise<GitDiff | undefined> {
    const s = await this.safe(root, 'status', ['--porcelain=v2', '-z', '--untracked-files=normal', '--', rel])
    if ('ok' in s || s.code !== 0) return undefined
    const entry = parseStatusV2(s.stdout).files.find((f) => f.untracked)
    if (!entry) return undefined
    if (entry.isDir) return { ok: true, binary: false, truncated: false }
    const abs = path.resolve(root, rel)
    const relCheck = path.relative(root, abs)
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return fail('bad_path', 'path escapes the repository')
    try {
      const lst = await fsp.lstat(abs)
      if (!lst.isFile()) return { ok: true, binary: false, truncated: false }
      const fh = await fsp.open(abs, 'r')
      try {
        const buf = Buffer.alloc(Math.min(lst.size, MAX_DIFF_BYTES))
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
        const data = buf.subarray(0, bytesRead)
        if (data.subarray(0, 8000).includes(0)) return { ok: true, binary: true, truncated: false }
        const t = truncateText(data.toString('utf8').replace(/\uFFFD+$/, ''))
        return {
          ok: true,
          untrackedText: t.text,
          binary: false,
          truncated: t.truncated || lst.size > MAX_DIFF_BYTES
        }
      } finally {
        await fh.close()
      }
    } catch (e) {
      return fail('error', e instanceof Error ? e.message : String(e))
    }
  }

  async log(a: { cwd: string; limit: number }): Promise<GitLog> {
    const bad = this.checkCwd(a.cwd)
    if (bad) return bad
    const limit = Math.max(1, Math.min(200, Math.trunc(a.limit) || 1))
    const r = await this.safe(a.cwd, 'log', [`-n`, String(limit), '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e'])
    if ('ok' in r) return r
    if (r.code !== 0 || r.timedOut) {
      if (/does not have any commits yet|unknown revision|bad default revision/i.test(r.stderr))
        return { ok: true, commits: [] }
      return fail(...failArgs(r))
    }
    return { ok: true, commits: parseLog(r.stdout) }
  }
}

function failArgs(r: GitRunResult): [GitErrorCode, string] {
  const m = mapGitFailure(r)
  return [m.code, m.message]
}
