import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ALLOWED_COMMANDS,
  GitService,
  GLOBAL_FLAGS,
  mapGitFailure,
  parseLog,
  parseNumstat,
  parseStatusV2,
  resolveGitBinary,
  sanitizedEnv,
  type GitRun
} from './git-service'

const GIT = resolveGitBinary()
const hasGit = !!GIT
const BASE = existsSync('D:\\claude-tmp') ? 'D:\\claude-tmp' : tmpdir()
const made: string[] = []
afterAll(() => {
  for (const d of made) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

const ident = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.invalid'
}
/** Fixture-only git (always inside a mkdtemp dir). */
function g(cwd: string, ...args: string[]): string {
  return execFileSync(GIT as string, ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...ident },
    windowsHide: true
  })
}
function tmp(prefix = 'ccwrap-git-'): string {
  const d = mkdtempSync(join(BASE, prefix))
  made.push(d)
  return d
}
function repo(): string {
  const d = tmp()
  g(d, 'init', '-q', '-b', 'main')
  return d
}
const w = (d: string, rel: string, content: string | Buffer): void => {
  const p = join(d, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, content)
}
const commitAll = (d: string, msg = 'c'): void => {
  g(d, 'add', '-A')
  g(d, 'commit', '-q', '-m', msg)
}

describe('parsers', () => {
  it('parses porcelain v2 -z', () => {
    const out = [
      '# branch.oid abc',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 h h src/a b.ts',
      '2 R. N... 100644 100644 100644 h h R100 new.ts',
      'old.ts',
      'u UU N... 1 2 3 4 h1 h2 h3 conf.txt',
      '? dir/',
      '? f.txt',
      '! ignored.log',
      ''
    ].join('\0')
    const p = parseStatusV2(out)
    expect(p).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, detached: false })
    expect(p.files).toEqual([
      { path: 'src/a b.ts', index: 'M', worktree: '.' },
      { path: 'new.ts', origPath: 'old.ts', index: 'R', worktree: '.' },
      { path: 'conf.txt', index: 'U', worktree: 'U', conflicted: true },
      { path: 'dir/', index: '?', worktree: '?', untracked: true, isDir: true },
      { path: 'f.txt', index: '?', worktree: '?', untracked: true }
    ])
  })
  it('detects detached head', () => {
    const p = parseStatusV2('# branch.oid abc\0# branch.head (detached)\0')
    expect(p.detached).toBe(true)
    expect(p.branch).toBeUndefined()
  })
  it('parses numstat incl. binary and rename', () => {
    const m = parseNumstat('3\t1\ta.ts\0-\t-\tb.png\0' + '2\t0\t\0old.ts\0new.ts\0')
    expect(m.get('a.ts')).toEqual({ added: 3, removed: 1 })
    expect(m.get('b.png')).toEqual({ binary: true })
    expect(m.get('new.ts')).toEqual({ added: 2, removed: 0 })
  })
  it('parses log records', () => {
    const c = parseLog('h1\x1fs1\x1fsubj one\x1fAnn\x1f2026-01-01T00:00:00+00:00\x1e\nh2\x1fs2\x1fsubj\x1fBob\x1f2026-01-02T00:00:00+00:00\x1e')
    expect(c.map((x) => x.hash)).toEqual(['h1', 'h2'])
    expect(c[0]).toMatchObject({ short: 's1', subject: 'subj one', author: 'Ann' })
  })
  it('maps errors', () => {
    expect(mapGitFailure({ stderr: 'fatal: not a git repository (or any...)' }).code).toBe('not_repo')
    expect(mapGitFailure({ stderr: "fatal: detected dubious ownership in repository at 'x'" }).code).toBe('unsafe_repo')
    expect(mapGitFailure({ stderr: '', timedOut: true }).code).toBe('timeout')
    expect(mapGitFailure({ stderr: 'boom\nmore' })).toEqual({ code: 'error', message: 'boom' })
  })
  it('sanitizes env', () => {
    const e = sanitizedEnv({ PATH: 'p', GIT_EXTERNAL_DIFF: 'x', git_dir: 'y', GIT_CONFIG_COUNT: '1' })
    expect(e['PATH']).toBe('p')
    expect(Object.keys(e).filter((k) => /^GIT_/i.test(k)).sort()).toEqual(
      ['GIT_LITERAL_PATHSPECS', 'GIT_OPTIONAL_LOCKS', 'GIT_PAGER', 'GIT_TERMINAL_PROMPT']
    )
    expect(e['GIT_OPTIONAL_LOCKS']).toBe('0')
  })
})

describe('argument lists (injected runner)', () => {
  const calls: string[][] = []
  const run: GitRun = async (args) => {
    calls.push(args)
    if (args.includes('rev-parse')) return { code: 0, stdout: 'D:/x\n', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  it('always carries the hardening flags and runs only allowed commands', async () => {
    const svc = new GitService({ run })
    const cwd = tmpdir()
    await svc.status({ cwd })
    await svc.diff({ cwd, path: 'a b.txt', staged: false })
    await svc.diff({ cwd, path: 'a.txt', staged: true })
    await svc.log({ cwd, limit: 5 })
    expect(calls.length).toBeGreaterThan(4)
    for (const args of calls) {
      expect(args.slice(0, GLOBAL_FLAGS.length)).toEqual([...GLOBAL_FLAGS])
      expect(args).toContain('--no-optional-locks')
      expect(args.join(' ')).toContain('-c core.fsmonitor=false')
      const cmd = args[GLOBAL_FLAGS.length] as string
      expect(ALLOWED_COMMANDS).toContain(cmd)
      if (cmd === 'diff') {
        expect(args).toContain('--no-ext-diff')
        expect(args).toContain('--no-textconv')
      }
      // never any write verbs
      for (const bad of ['add', 'commit', 'checkout', 'reset', 'stash', 'clean', 'push', 'fetch', 'merge'])
        expect(args).not.toContain(bad)
    }
    const d = calls.find((a) => a.includes('a b.txt'))!
    expect(d[d.length - 2]).toBe('--')
    expect(d[d.length - 1]).toBe('a b.txt')
  })
  it('rejects bad paths before running git', async () => {
    let ran = 0
    const svc = new GitService({ run: async () => (ran++, { code: 0, stdout: '', stderr: '' }) })
    const cwd = tmpdir()
    for (const p of ['../x', 'a/../../x', 'C:\\x', 'C:x', '/etc/passwd', '\\\\srv\\s', 'a\0b', '']) {
      const r = await svc.diff({ cwd, path: p, staged: false })
      expect(r).toMatchObject({ ok: false, code: 'bad_path' })
    }
    expect(await svc.status({ cwd: 'relative/dir' })).toMatchObject({ ok: false, code: 'bad_path' })
    expect(await svc.status({ cwd: join(cwd, 'does-not-exist-xyz') })).toMatchObject({ ok: false, code: 'bad_path' })
    expect(ran).toBe(0)
  })
  it('maps ENOENT to git_missing and not-a-repo / timeout', async () => {
    const cwd = tmpdir()
    const enoent = new GitService({ run: () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOENT' })) })
    expect(await enoent.status({ cwd })).toMatchObject({ ok: false, code: 'git_missing' })
    const nr = new GitService({ run: async () => ({ code: 128, stdout: '', stderr: 'fatal: not a git repository' }) })
    expect(await nr.status({ cwd })).toMatchObject({ ok: false, code: 'not_repo' })
    const to = new GitService({ run: async () => ({ code: -1, stdout: '', stderr: '', timedOut: true }) })
    expect(await to.status({ cwd })).toMatchObject({ ok: false, code: 'timeout' })
    const du = new GitService({
      run: async () => ({ code: 128, stdout: '', stderr: "fatal: detected dubious ownership in repository at 'D:/x'" })
    })
    expect(await du.log({ cwd, limit: 3 })).toMatchObject({ ok: false, code: 'unsafe_repo' })
  })
})

describe.skipIf(!hasGit)('real git, temp repos', { timeout: 90_000 }, () => {
  const svc = new GitService()

  it('not a repo', async () => {
    const d = tmp()
    expect(await svc.status({ cwd: d })).toMatchObject({ ok: false, code: 'not_repo' })
  })

  it('staged / unstaged / renamed / deleted / untracked / unicode / spaces', async () => {
    const d = repo()
    w(d, 'staged.txt', 'a\n')
    w(d, 'unstaged.txt', 'a\n')
    w(d, 'old name.txt', 'rename me, content long enough\nline2\nline3\n')
    w(d, 'gone.txt', 'x\n')
    w(d, 'sp ace/in dir.txt', 'a\n')
    w(d, 'ทดสอบ é.txt', 'a\n')
    commitAll(d)
    w(d, 'staged.txt', 'a\nb\nc\n')
    g(d, 'add', 'staged.txt')
    w(d, 'unstaged.txt', 'z\n')
    g(d, 'mv', 'old name.txt', 'new name.txt')
    rmSync(join(d, 'gone.txt'))
    w(d, 'sp ace/in dir.txt', 'changed\n')
    w(d, 'ทดสอบ é.txt', 'changed\n')
    w(d, 'fresh.txt', 'new\n')
    w(d, 'newdir/inner.txt', 'new\n')

    const r = await svc.status({ cwd: d })
    if (!r.ok) throw new Error(r.message)
    expect(r.branch).toBe('main')
    expect(r.detached).toBe(false)
    expect(r.truncated).toBe(false)
    const by = new Map(r.files.map((f) => [f.path, f]))
    expect(by.get('staged.txt')).toMatchObject({ index: 'M', worktree: '.', added: 2, removed: 0 })
    expect(by.get('unstaged.txt')).toMatchObject({ index: '.', worktree: 'M', added: 1, removed: 1 })
    expect(by.get('new name.txt')).toMatchObject({ index: 'R', origPath: 'old name.txt' })
    expect(by.get('gone.txt')).toMatchObject({ index: '.', worktree: 'D' })
    expect(by.get('sp ace/in dir.txt')).toMatchObject({ worktree: 'M' })
    expect(by.get('ทดสอบ é.txt')).toMatchObject({ worktree: 'M' })
    expect(by.get('fresh.txt')).toMatchObject({ untracked: true, index: '?', worktree: '?' })
    expect(by.get('newdir/')).toMatchObject({ untracked: true, isDir: true })
    // CI temp dirs use 8.3 short names (RUNNER~1); git reports the long form.
    expect(realpathSync.native(r.root).toLowerCase()).toBe(realpathSync.native(d).toLowerCase())
  })

  it('conflicts from a merge', async () => {
    const d = repo()
    w(d, 'f.txt', 'base\n')
    commitAll(d)
    g(d, 'checkout', '-q', '-b', 'other')
    w(d, 'f.txt', 'other\n')
    commitAll(d, 'o')
    g(d, 'checkout', '-q', 'main')
    w(d, 'f.txt', 'main\n')
    commitAll(d, 'm')
    try {
      g(d, 'merge', 'other')
    } catch {
      /* conflict expected */
    }
    const r = await svc.status({ cwd: d })
    if (!r.ok) throw new Error(r.message)
    expect(r.files.find((f) => f.path === 'f.txt')).toMatchObject({ conflicted: true, index: 'U', worktree: 'U' })
  })

  it('ahead / behind against a bare remote and detached head', async () => {
    const base = tmp('ccwrap-git-remote-')
    const bare = join(base, 'bare.git')
    g(base, 'init', '-q', '--bare', '-b', 'main', bare)
    const a = join(base, 'a')
    g(base, 'clone', '-q', bare, a)
    g(a, 'checkout', '-q', '-b', 'main')
    w(a, 'x.txt', '1\n')
    commitAll(a, 'first')
    g(a, 'push', '-q', '-u', 'origin', 'main')
    const b = join(base, 'b')
    g(base, 'clone', '-q', bare, b)
    w(b, 'y.txt', '1\n')
    commitAll(b, 'from b')
    g(b, 'push', '-q', 'origin', 'main')
    g(a, 'fetch', '-q')
    w(a, 'z.txt', '1\n')
    commitAll(a, 'local')
    const r = await svc.status({ cwd: a })
    if (!r.ok) throw new Error(r.message)
    expect(r).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 1, behind: 1 })

    g(a, 'checkout', '-q', '--detach', 'HEAD')
    const d = await svc.status({ cwd: a })
    expect(d).toMatchObject({ ok: true, detached: true })
    if (d.ok) expect(d.branch).toBeUndefined()
  })

  it('log lists commits and empty repo gives none', async () => {
    const d = repo()
    expect(await svc.log({ cwd: d, limit: 5 })).toEqual({ ok: true, commits: [] })
    w(d, 'a.txt', '1\n')
    commitAll(d, 'first subject')
    w(d, 'a.txt', '2\n')
    commitAll(d, 'second subject')
    const r = await svc.log({ cwd: d, limit: 1 })
    if (!r.ok) throw new Error(r.message)
    expect(r.commits).toHaveLength(1)
    expect(r.commits[0]).toMatchObject({ subject: 'second subject', author: 't' })
    expect(r.commits[0]!.hash).toMatch(/^[0-9a-f]{40}$/)
  })

  it('does not execute repo-configured programs (fsmonitor, diff.external, textconv, pager)', async () => {
    const d = repo()
    const markers = {
      fsm: join(d, '..', `${Date.now()}-fsm.marker`),
      ext: join(d, '..', `${Date.now()}-ext.marker`),
      tc: join(d, '..', `${Date.now()}-tc.marker`),
      pg: join(d, '..', `${Date.now()}-pg.marker`)
    }
    made.push(...Object.values(markers))
    const sh = (m: string): string => `echo x > '${m.replace(/\\/g, '/')}'`
    w(d, 'a.txt', 'one\n')
    w(d, '.gitattributes', '*.txt diff=evil\n')
    commitAll(d)
    w(d, 'a.txt', 'two\n')
    w(d, 'b.txt', 'untracked\n')
    const cfgPath = join(d, '.git', 'config')
    const cfg = [
      '[core]',
      `\tfsmonitor = ${sh(markers.fsm)}`,
      `\tpager = ${sh(markers.pg)}`,
      '[diff]',
      `\texternal = ${sh(markers.ext).replace(/'/g, '')}`,
      '[diff "evil"]',
      `\ttextconv = ${sh(markers.tc)}`
    ].join('\n')
    writeFileSync(cfgPath, `${readFileSync(cfgPath, 'utf8')}\n${cfg}\n`)

    // Control: the same repo with a bare, unhardened git DOES run the programs (proves the fixture).
    try {
      g(d, '--no-pager', 'diff')
    } catch {
      /* ignore */
    }
    try {
      g(d, 'status')
    } catch {
      /* ignore */
    }
    const controlRan = Object.values(markers).filter((m) => existsSync(m))
    expect(controlRan.length).toBeGreaterThan(0)
    for (const m of Object.values(markers)) rmSync(m, { force: true })

    const s = await svc.status({ cwd: d })
    expect(s.ok).toBe(true)
    const df = await svc.diff({ cwd: d, path: 'a.txt', staged: false })
    expect(df.ok).toBe(true)
    if (df.ok) expect(df.patch).toContain('+two')
    await svc.diff({ cwd: d, path: 'b.txt', staged: false })
    await svc.log({ cwd: d, limit: 3 })
    for (const m of Object.values(markers)) expect(existsSync(m)).toBe(false)
  })

  it('leaves .git/index untouched (optional locks)', async () => {
    const d = repo()
    w(d, 'a.txt', 'same\n')
    commitAll(d)
    // Stat-dirty the file without changing content so a refreshing status would rewrite the index.
    const later = new Date(Date.now() + 60_000)
    utimesSync(join(d, 'a.txt'), later, later)
    const idx = join(d, '.git', 'index')
    const before = statSync(idx).mtimeMs
    const r = await svc.status({ cwd: d })
    expect(r.ok).toBe(true)
    await svc.diff({ cwd: d, path: 'a.txt', staged: false })
    expect(statSync(idx).mtimeMs).toBe(before)
    expect(existsSync(join(d, '.git', 'index.lock'))).toBe(false)
  })

  it('caps at 2000 entries with truncated and total', async () => {
    const d = repo()
    w(d, 'seed.txt', 's\n')
    commitAll(d)
    for (let i = 0; i < 3000; i++) writeFileSync(join(d, `u${i}.txt`), 'x')
    const r = await svc.status({ cwd: d })
    if (!r.ok) throw new Error(r.message)
    expect(r.truncated).toBe(true)
    expect(r.total).toBe(3000)
    expect(r.files).toHaveLength(2000)
  }, 60_000)

  it('diff: tracked patch, staged, binary, truncation, untracked text and dir', async () => {
    const d = repo()
    w(d, 'a.txt', 'one\n')
    w(d, 'big.txt', 'x\n')
    w(d, 'bin.dat', Buffer.from([0, 1, 2, 3, 0, 255]))
    commitAll(d)
    w(d, 'a.txt', 'two\n')
    g(d, 'add', 'a.txt')
    w(d, 'a.txt', 'three\n')
    w(d, 'big.txt', Array.from({ length: 30_000 }, (_, i) => `line ${i} ${'y'.repeat(60)}`).join('\n') + '\n')
    w(d, 'bin.dat', Buffer.from([0, 9, 9, 9, 0, 254]))
    w(d, 'note.txt', 'hello\nuntracked\n')
    w(d, 'blob.bin', Buffer.from([1, 0, 2, 0]))
    w(d, 'folder/x.txt', 'x')

    const wt = await svc.diff({ cwd: d, path: 'a.txt', staged: false })
    expect(wt).toMatchObject({ ok: true, binary: false, truncated: false })
    if (wt.ok) expect(wt.patch).toContain('+three')
    const st = await svc.diff({ cwd: d, path: 'a.txt', staged: true })
    if (st.ok) expect(st.patch).toContain('+two')

    const big = await svc.diff({ cwd: d, path: 'big.txt', staged: false })
    expect(big).toMatchObject({ ok: true, truncated: true })
    if (big.ok) expect(Buffer.byteLength(big.patch ?? '')).toBeLessThanOrEqual(1024 * 1024)

    expect(await svc.diff({ cwd: d, path: 'bin.dat', staged: false })).toMatchObject({ ok: true, binary: true })

    const ut = await svc.diff({ cwd: d, path: 'note.txt', staged: false })
    expect(ut).toMatchObject({ ok: true, binary: false, untrackedText: 'hello\nuntracked\n' })
    expect(await svc.diff({ cwd: d, path: 'blob.bin', staged: false })).toMatchObject({ ok: true, binary: true })
    const dir = await svc.diff({ cwd: d, path: 'folder/', staged: false })
    expect(dir).toMatchObject({ ok: true, binary: false })
    if (dir.ok) {
      expect(dir.patch).toBeUndefined()
      expect(dir.untrackedText).toBeUndefined()
    }
  }, 60_000)

  it('a 2 MB untracked text file is truncated', async () => {
    const d = repo()
    w(d, 'seed.txt', 's\n')
    commitAll(d)
    w(d, 'huge.txt', 'a'.repeat(99) + '\n'.repeat(1) + ('b'.repeat(99) + '\n').repeat(20_000))
    const r = await svc.diff({ cwd: d, path: 'huge.txt', staged: false })
    expect(r).toMatchObject({ ok: true, truncated: true })
    if (r.ok) expect(Buffer.byteLength(r.untrackedText ?? '')).toBeLessThanOrEqual(1024 * 1024)
  })

  it('real runner rejects ../x and C:\\x as bad_path', async () => {
    const d = repo()
    expect(await svc.diff({ cwd: d, path: '../x', staged: false })).toMatchObject({ ok: false, code: 'bad_path' })
    expect(await svc.diff({ cwd: d, path: 'C:\\x', staged: false })).toMatchObject({ ok: false, code: 'bad_path' })
  })
})
