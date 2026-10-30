import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ConfigFileRef, ConfigSnapshot, ConfigWriteResult } from '../../shared/config'
import { normalizeCwdKey } from '../paths'
import type { ConfigPaths } from '../paths'
import { writeFileAtomic } from './atomic-write'
import type { AtomicFs } from './atomic-write'

export const BACKUPS_KEPT = 5

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

function fileKey(path: string): string {
  return normalizeCwdKey(path)
}

export interface ConfigServiceOptions {
  fs?: AtomicFs
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export class ConfigService {
  private readonly backedUp = new Set<string>()
  private readonly ownWrites = new Map<string, string>()

  constructor(
    private readonly paths: ConfigPaths,
    private readonly backupDir: string,
    private readonly opts: ConfigServiceOptions = {}
  ) {}

  /** Resolve a typed ref to a path. Throws on a missing cwd (callers map that to bad_ref). */
  resolvePath(ref: ConfigFileRef): string {
    return ref.kind === 'settings' ? this.paths.settingsFile(ref.scope, ref.cwd) : this.paths.memoryFile(ref.scope, ref.cwd)
  }

  /** True when `hash` is the content we last wrote to `path` (watcher uses this to drop our own events). */
  isOwnWrite(path: string, hash: string | null): boolean {
    return hash !== null && this.ownWrites.get(fileKey(path)) === hash
  }

  clearOwnWrite(path: string): void {
    this.ownWrites.delete(fileKey(path))
  }

  async read(ref: ConfigFileRef): Promise<ConfigSnapshot> {
    const path = this.resolvePath(ref)
    return this.snapshot(ref, path)
  }

  private async snapshot(ref: ConfigFileRef, path: string): Promise<ConfigSnapshot> {
    let buf: Buffer
    try {
      buf = await readFile(path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ENOTDIR')
        return { ref, path, exists: false, text: '', hash: null }
      throw err
    }
    let mtimeMs: number | undefined
    try {
      mtimeMs = (await stat(path)).mtimeMs
    } catch {
      /* raced with a delete; fine */
    }
    return {
      ref,
      path,
      exists: true,
      text: stripBom(buf.toString('utf8')),
      hash: sha256(buf),
      ...(mtimeMs !== undefined ? { mtimeMs } : {})
    }
  }

  async write(ref: ConfigFileRef, text: string, baseHash: string | null): Promise<ConfigWriteResult> {
    let path: string
    try {
      path = this.resolvePath(ref)
    } catch (err) {
      return { ok: false, code: 'bad_ref', message: err instanceof Error ? err.message : String(err) }
    }
    try {
      let body = stripBom(text)
      if (ref.kind === 'settings') {
        let parsed: unknown
        try {
          parsed = JSON.parse(body)
        } catch (err) {
          return { ok: false, code: 'invalid_json', message: err instanceof Error ? err.message : 'Invalid JSON' }
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
          return { ok: false, code: 'not_object', message: 'Settings must be a JSON object' }
      }

      const current = await this.snapshot(ref, path)
      if (current.hash !== baseHash)
        return { ok: false, code: 'conflict', message: 'The file changed on disk since it was read', current }

      if (ref.kind === 'memory' && current.exists) {
        const eol = /\r\n/.test(current.text) ? '\r\n' : /\n/.test(current.text) ? '\n' : undefined
        if (eol) body = body.replace(/\r\n/g, '\n').replace(/\n/g, eol)
      }

      const backupPath = current.exists ? await this.backupOnce(path) : undefined
      const bytes = Buffer.from(body, 'utf8')
      await writeFileAtomic(path, bytes, {
        ...(this.opts.fs ? { fs: this.opts.fs } : {}),
        ...(this.opts.sleep ? { sleep: this.opts.sleep } : {})
      })
      const hash = sha256(bytes)
      this.ownWrites.set(fileKey(path), hash)
      const snap = await this.snapshot(ref, path)
      return { ok: true, snapshot: snap, ...(backupPath ? { backupPath } : {}) }
    } catch (err) {
      return { ok: false, code: 'io', message: err instanceof Error ? err.message : String(err) }
    }
  }

  /** One backup per file per app run, in backupDir (never next to project files). Failure never blocks the write. */
  private async backupOnce(path: string): Promise<string | undefined> {
    const key = fileKey(path)
    if (this.backedUp.has(key)) return undefined
    try {
      await mkdir(this.backupDir, { recursive: true })
      const prefix = `${createHash('sha1').update(key).digest('hex').slice(0, 12)}-${basename(path)}.`
      const stamp = new Date((this.opts.now ?? Date.now)()).toISOString().replace(/[:.]/g, '-')
      const dest = join(this.backupDir, `${prefix}${stamp}.bak`)
      await copyFile(path, dest)
      this.backedUp.add(key)
      await this.prune(prefix)
      return dest
    } catch (err) {
      console.warn('[ccwrap] config backup failed', err instanceof Error ? err.message : err)
      return undefined
    }
  }

  private async prune(prefix: string): Promise<void> {
    const names = (await readdir(this.backupDir)).filter((n) => n.startsWith(prefix) && n.endsWith('.bak')).sort()
    for (const n of names.slice(0, Math.max(0, names.length - BACKUPS_KEPT))) {
      try {
        await unlink(join(this.backupDir, n))
      } catch {
        /* best effort */
      }
    }
  }
}
