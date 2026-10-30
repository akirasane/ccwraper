import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import type { ConfigFileRef, ConfigSnapshot, ConfigWriteResult } from '../../shared/config'
import { parseFrontmatter } from '../../shared/frontmatter'
import { itemFilePath, normalizeCwdKey } from '../paths'
import type { ConfigPaths, ItemKindName } from '../paths'
import type { PluginRegistry } from './plugin-registry'
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
  /** Plugin dirs reported by session init; needed to resolve plugin item refs. */
  registry?: PluginRegistry
}

/** Existing item files are accepted with this segment rule (new names are stricter, see items-service). */
const REF_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const ITEM_DIR_NAME: Record<ItemKindName, string> = { skill: 'skills', command: 'commands', agent: 'agents' }
/** How long a null-hash (removal / directory) event stays "ours". The watcher debounces at 150 ms. */
const OWN_TOUCH_TTL_MS = 5000

/** Throws unless `name` is a valid existing-item name for `kind` (1 segment, commands 1-3). */
export function assertRefName(kind: ItemKindName, name: string): void {
  const segs = name.split('/')
  const max = kind === 'command' ? 3 : 1
  if (segs.length < 1 || segs.length > max || segs.some((s) => !REF_SEGMENT.test(s))) throw new Error(`Invalid item name: ${name}`)
}

/**
 * Throws when any existing component of `file` below `root` is a symlink (so a link inside the tree can never
 * redirect a read or write outside it). The root itself may be a link the user set up. Missing components end the walk.
 */
export async function assertNoSymlinkEscape(root: string, file: string): Promise<void> {
  const rel = relative(resolve(root), resolve(file))
  if (!rel || rel.startsWith('..')) throw new Error('Item path escapes its root')
  let cur = resolve(root)
  for (const seg of rel.split(/[\\/]/)) {
    cur = join(cur, seg)
    try {
      if ((await lstat(cur)).isSymbolicLink()) throw new Error(`Refusing to follow a symlink: ${cur}`)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return
      throw err
    }
  }
}

export class ConfigService {
  private readonly backedUp = new Set<string>()
  private readonly ownWrites = new Map<string, string>()
  private readonly ownTouched = new Map<string, number>()

  constructor(
    private readonly paths: ConfigPaths,
    private readonly backupDir: string,
    private readonly opts: ConfigServiceOptions = {}
  ) {}

  /** Resolve a typed ref to a path. Throws on a missing cwd (callers map that to bad_ref). */
  resolvePath(ref: ConfigFileRef): string {
    if (ref.kind === 'settings') return this.paths.settingsFile(ref.scope, ref.cwd)
    if (ref.kind === 'memory') return this.paths.memoryFile(ref.scope, ref.cwd)
    return this.resolveItem(ref).path
  }

  /** Root folder + file of an item ref (user / project via paths, plugin via the registry). Throws on a bad ref. */
  resolveItem(ref: Extract<ConfigFileRef, { kind: 'skill' | 'command' | 'agent' }>): { root: string; path: string } {
    assertRefName(ref.kind, ref.name)
    let root: string
    if (ref.scope === 'plugin') {
      const plugin = this.opts.registry?.get(ref.plugin)
      if (!plugin) throw new Error(`Unknown plugin: ${ref.plugin}`)
      root = join(plugin.path, ITEM_DIR_NAME[ref.kind])
    } else {
      root = this.paths.itemsRoot(ref.kind, ref.scope, ref.cwd)
    }
    return { root, path: itemFilePath(ref.kind, root, ref.name) }
  }

  /** True when `hash` is the content we last wrote to `path`, or (null hash) the path was touched by us recently. */
  isOwnWrite(path: string, hash: string | null): boolean {
    if (hash === null) {
      const until = this.ownTouched.get(fileKey(path))
      return until !== undefined && until > (this.opts.now ?? Date.now)()
    }
    return this.ownWrites.get(fileKey(path)) === hash
  }

  clearOwnWrite(path: string): void {
    this.ownWrites.delete(fileKey(path))
    this.ownTouched.delete(fileKey(path))
  }

  /** Register a removal / directory change we made ourselves (no content hash), so the watcher stays quiet. */
  markOwnPath(path: string): void {
    this.ownTouched.set(fileKey(path), (this.opts.now ?? Date.now)() + OWN_TOUCH_TTL_MS)
  }

  async read(ref: ConfigFileRef): Promise<ConfigSnapshot> {
    const path = this.resolvePath(ref)
    if (ref.kind !== 'settings' && ref.kind !== 'memory') await assertNoSymlinkEscape(this.resolveItem(ref).root, path)
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
      const isItem = ref.kind !== 'settings' && ref.kind !== 'memory'
      if (isItem) {
        if (ref.scope === 'plugin') return { ok: false, code: 'read_only', message: 'Plugin items are read-only' }
        await assertNoSymlinkEscape(this.resolveItem(ref).root, path)
        const fm = parseFrontmatter(body)
        if (fm.error) return { ok: false, code: 'invalid_frontmatter', message: fm.error.message }
      }
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

      if ((ref.kind === 'memory' || isItem) && current.exists) {
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
