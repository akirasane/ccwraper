import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { isTransientFsError, retryDelayMs } from './atomic-write'

export const TRASH_MANIFEST = 'ccwrap-trash.json'

export interface TrashStat {
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
  size: number
}

/** Filesystem seam so tests can simulate EXDEV / EPERM / a corrupt copy. `rm` is only used for the verified EXDEV fallback. */
export interface TrashFs {
  rename(from: string, to: string): Promise<void>
  mkdir(dir: string): Promise<void>
  cp(from: string, to: string): Promise<void>
  rm(path: string): Promise<void>
  lstat(path: string): Promise<TrashStat>
  readdir(dir: string): Promise<string[]>
  readFile(path: string): Promise<Buffer>
  writeFile(path: string, data: string): Promise<void>
}

export const nodeTrashFs: TrashFs = {
  rename,
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true })
  },
  cp: (from, to) => cp(from, to, { recursive: true, errorOnExist: true, force: false, dereference: false }),
  rm: (path) => rm(path, { recursive: true, force: false }),
  lstat,
  readdir: (dir) => readdir(dir),
  readFile: (p) => readFile(p),
  writeFile: (p, d) => writeFile(p, d, 'utf8')
}

export interface TrashMeta {
  kind: string
  scope: string
  name: string
}

export interface TrashManifest {
  originalPath: string
  kind: string
  scope: string
  name: string
  trashedAt: string
  payload: string
  method: 'rename' | 'copy'
}

export interface TrashOptions {
  fs?: TrashFs
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Retries after the first attempt for EPERM / EBUSY / EACCES (default 5). */
  retries?: number
}

function within(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return !!rel && !rel.startsWith('..') && !/^[A-Za-z]:/.test(rel) && !rel.startsWith('/') && !rel.startsWith('\\')
}

/** relative path -> `d` for a directory or `f:<size>:<sha256>` for a file; throws on a symlink or other entry type. */
async function fingerprint(fs: TrashFs, root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const walk = async (abs: string, rel: string): Promise<void> => {
    const st = await fs.lstat(abs)
    if (st.isSymbolicLink()) throw new Error(`Refusing to move a symlink: ${abs}`)
    if (st.isDirectory()) {
      out.set(rel, 'd')
      for (const name of (await fs.readdir(abs)).sort()) await walk(join(abs, name), rel ? `${rel}/${name}` : name)
    } else if (st.isFile()) {
      out.set(rel, `f:${st.size}:${createHash('sha256').update(await fs.readFile(abs)).digest('hex')}`)
    } else {
      throw new Error(`Unsupported file type: ${abs}`)
    }
  }
  await walk(root, '')
  return out
}

/**
 * "Delete" = move into `<trashRoot>/<stamp>-<kind>-<scope>-<name>/<basename>` plus a manifest.
 * rename first (retrying transient Windows errors); on EXDEV copy, verify (same entries, sizes, sha256) and only then
 * remove the source. A failed verify leaves the source untouched. There is no other removal of user content.
 */
export class Trash {
  private readonly fs: TrashFs
  private readonly sleep: (ms: number) => Promise<void>

  constructor(
    readonly root: string,
    private readonly opts: TrashOptions = {}
  ) {
    this.fs = opts.fs ?? nodeTrashFs
    this.sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  }

  /** Returns the trash entry directory (what the toast shows). Throws on failure; the source is intact then. */
  async move(src: string, meta: TrashMeta): Promise<string> {
    if (within(this.root, src)) throw new Error('Refusing to trash something that is already inside the trash')
    const st = await this.fs.lstat(src)
    if (st.isSymbolicLink()) throw new Error(`Refusing to trash a symlink: ${src}`)

    const stamp = new Date((this.opts.now ?? Date.now)()).toISOString().replace(/[:.]/g, '-')
    const label = `${stamp}-${meta.kind}-${meta.scope}-${meta.name.replace(/[\\/]/g, '__')}`.replace(/[<>:"|?*]/g, '_')
    let entry = join(this.root, label)
    for (let n = 2; await this.exists(entry); n++) entry = join(this.root, `${label}-${n}`)
    await this.fs.mkdir(entry)

    const payload = join(entry, basename(src))
    let method: TrashManifest['method'] = 'rename'
    try {
      await this.renameWithRetry(src, payload)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
      method = 'copy'
      await this.copyVerifyRemove(src, payload)
    }

    const manifest: TrashManifest = {
      originalPath: src,
      kind: meta.kind,
      scope: meta.scope,
      name: meta.name,
      trashedAt: new Date((this.opts.now ?? Date.now)()).toISOString(),
      payload: basename(src),
      method
    }
    try {
      await this.fs.writeFile(join(entry, TRASH_MANIFEST), JSON.stringify(manifest, null, 2))
    } catch (err) {
      console.warn('[ccwrap] trash manifest failed', err instanceof Error ? err.message : err)
    }
    return entry
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await this.fs.lstat(p)
      return true
    } catch {
      return false
    }
  }

  private async renameWithRetry(from: string, to: string): Promise<void> {
    const retries = this.opts.retries ?? 5
    for (let attempt = 0; ; attempt++) {
      try {
        await this.fs.rename(from, to)
        return
      } catch (err) {
        if (!isTransientFsError(err) || attempt >= retries) throw err
        await this.sleep(retryDelayMs(attempt))
      }
    }
  }

  private async copyVerifyRemove(src: string, payload: string): Promise<void> {
    try {
      await this.fs.cp(src, payload)
      const [a, b] = [await fingerprint(this.fs, src), await fingerprint(this.fs, payload)]
      const same = a.size === b.size && [...a].every(([k, v]) => b.get(k) === v)
      if (!same) throw new Error('Trash copy did not match the source; the source was left in place')
    } catch (err) {
      // Our own incomplete copy in the trash is the only thing ever removed on this path.
      try {
        if (await this.exists(payload)) await this.fs.rm(payload)
      } catch {
        /* best effort */
      }
      throw err instanceof Error ? err : new Error(String(err))
    }
    await this.fs.rm(src)
  }
}
