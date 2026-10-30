import { lstat, mkdir, open, readdir, rename, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type {
  ConfigErrorCode,
  ConfigFileRef,
  ConfigSnapshot,
  ConfigItemList,
  ConfigItemSummary,
  ItemKind,
  ItemMutationResult,
  ItemScope
} from '../../shared/config'
import { parseFrontmatter } from '../../shared/frontmatter'
import { normalizeCwdKey } from '../paths'
import type { ConfigPaths } from '../paths'
import { isTransientFsError, retryDelayMs } from './atomic-write'
import { assertNoSymlinkEscape, assertRefName } from './config-service'
import type { ConfigService } from './config-service'
import type { PluginRegistry } from './plugin-registry'
import type { Trash } from './trash'

export const FRONTMATTER_READ_BYTES = 64 * 1024
export const MAX_ITEM_FILE_BYTES = 1024 * 1024
export const MAX_SKILL_FILES = 50
const MAX_COMMAND_DEPTH = 3
const PLUGIN_NAME = /^[A-Za-z0-9_.@-]{1,128}$/
const REF_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const NEW_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SKIP_DIRS = new Set(['node_modules', '.git'])
const DIR_NAME: Record<ItemKind, string> = { skill: 'skills', command: 'commands', agent: 'agents' }

export interface ItemsServiceOptions {
  sleep?: (ms: number) => Promise<void>
  /** Override fs.rename (tests simulate EPERM). */
  rename?: (from: string, to: string) => Promise<void>
}

type NonPluginRef = { kind: ItemKind; scope: ItemScope; cwd?: string; name: string }

function fail(code: ConfigErrorCode, message: string, current?: ConfigSnapshot): ItemMutationResult {
  return { ok: false, code, message, ...(current ? { current } : {}) }
}

function isItemRef(ref: ConfigFileRef): ref is Extract<ConfigFileRef, { kind: ItemKind }> {
  return ref.kind === 'skill' || ref.kind === 'command' || ref.kind === 'agent'
}

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code
}

/** Strict rule for new names (create / rename). */
export function validateNewName(kind: ItemKind, name: string): string | undefined {
  if (!name || name.length > 64) return 'Name must be 1-64 characters'
  const segs = name.split('/')
  const max = kind === 'command' ? 3 : 1
  if (segs.length > max) return kind === 'command' ? 'At most 3 levels' : 'Folders are not allowed in this name'
  if (segs.some((s) => !NEW_SEGMENT.test(s))) return 'Use lowercase letters, digits and single hyphens'
  return undefined
}

export class ItemsService {
  private readonly sleep: (ms: number) => Promise<void>
  private readonly renameFn: (from: string, to: string) => Promise<void>

  constructor(
    private readonly paths: ConfigPaths,
    private readonly registry: PluginRegistry,
    private readonly config: ConfigService,
    private readonly trash: Trash,
    opts: ItemsServiceOptions = {}
  ) {
    this.sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
    this.renameFn = opts.rename ?? rename
  }

  // ---- list ----

  async list(kind: ItemKind, cwd?: string): Promise<ConfigItemList> {
    const items: ConfigItemSummary[] = []
    const roots: ConfigItemList['roots'] = []
    const scopes: Array<[ItemScope, string]> = [['user', this.paths.itemsRoot(kind, 'user')]]
    if (cwd) scopes.push(['project', this.paths.itemsRoot(kind, 'project', cwd)])
    for (const [scope, root] of scopes) {
      const exists = await isDir(root)
      roots.push({ scope, path: root, exists })
      if (!exists) continue
      const base = { scope, ...(scope === 'project' && cwd ? { cwd } : {}) }
      items.push(...(await this.scan(kind, root, (name) => ({ kind, ...base, name }) as ConfigFileRef, scope)))
    }
    for (const p of this.registry.list()) {
      if (!PLUGIN_NAME.test(p.name)) continue
      const root = join(p.path, DIR_NAME[kind])
      if (!(await isDir(root))) continue
      const found = await this.scan(kind, root, (name) => ({ kind, scope: 'plugin', plugin: p.name, name }) as ConfigFileRef, 'plugin')
      for (const it of found) {
        it.plugin = p.name
        if (p.version) it.pluginVersion = p.version
      }
      items.push(...found)
    }
    const order = { project: 0, user: 1, plugin: 2 } as const
    items.sort((a, b) => a.name.localeCompare(b.name) || order[a.scope] - order[b.scope] || (a.plugin ?? '').localeCompare(b.plugin ?? ''))
    return { kind, items, roots, pluginsKnown: this.registry.known }
  }

  private async scan(
    kind: ItemKind,
    root: string,
    refOf: (name: string) => ConfigFileRef,
    scope: ItemScope | 'plugin'
  ): Promise<ConfigItemSummary[]> {
    const candidates: Array<{ name: string; file: string; dir?: string }> = []
    if (kind === 'skill') {
      for (const e of await safeReaddir(root)) {
        if (!e.isDirectory() || !REF_SEGMENT.test(e.name)) continue
        candidates.push({ name: e.name, file: join(root, e.name, 'SKILL.md'), dir: join(root, e.name) })
      }
    } else if (kind === 'agent') {
      for (const e of await safeReaddir(root)) {
        if (!e.isFile() || !e.name.endsWith('.md')) continue
        const stem = e.name.slice(0, -3)
        if (REF_SEGMENT.test(stem)) candidates.push({ name: stem, file: join(root, e.name) })
      }
    } else {
      const walk = async (dir: string, prefix: string[]): Promise<void> => {
        for (const e of await safeReaddir(dir)) {
          if (e.isDirectory()) {
            if (prefix.length + 1 < MAX_COMMAND_DEPTH && REF_SEGMENT.test(e.name) && !SKIP_DIRS.has(e.name))
              await walk(join(dir, e.name), [...prefix, e.name])
          } else if (e.isFile() && e.name.endsWith('.md')) {
            const stem = e.name.slice(0, -3)
            if (REF_SEGMENT.test(stem)) candidates.push({ name: [...prefix, stem].join('/'), file: join(dir, e.name) })
          }
        }
      }
      await walk(root, [])
    }

    const out: ConfigItemSummary[] = []
    for (const c of candidates) {
      let st
      try {
        st = await lstat(c.file)
      } catch {
        continue // a skill dir without SKILL.md is not a skill
      }
      if (!st.isFile()) continue
      const summary: ConfigItemSummary = {
        ref: refOf(c.name),
        kind,
        scope,
        name: c.name,
        path: c.file,
        mtimeMs: st.mtimeMs,
        readOnly: scope === 'plugin'
      }
      if (st.size > MAX_ITEM_FILE_BYTES) {
        summary.error = 'File is larger than 1 MB; not read'
      } else {
        try {
          const head = await readHead(c.file, FRONTMATTER_READ_BYTES)
          const fm = parseFrontmatter(head)
          if (fm.error && !fm.lenient) summary.error = fm.error.message
          else {
            if (fm.lenient) summary.warning = 'Non-strict YAML (the CLI accepts it)'
            if (typeof fm.data['description'] === 'string') summary.description = fm.data['description']
            if (typeof fm.data['name'] === 'string') summary.frontmatterName = fm.data['name']
          }
        } catch (err) {
          summary.error = err instanceof Error ? err.message : String(err)
        }
      }
      if (c.dir) summary.files = await listSkillFiles(c.dir)
      out.push(summary)
    }
    return out
  }

  // ---- create ----

  async create(args: { kind: ItemKind; scope: ItemScope; cwd?: string; name: string; text: string }): Promise<ItemMutationResult> {
    const bad = validateNewName(args.kind, args.name)
    if (bad) return fail('bad_name', bad)
    const ref = this.refOf(args.kind, args.scope, args.cwd, args.name)
    if (!ref) return fail('bad_ref', 'A project item needs a working directory')
    let resolved: { root: string; path: string }
    try {
      resolved = this.config.resolveItem(ref)
      await assertNoSymlinkEscape(resolved.root, resolved.path)
      if (args.kind === 'skill') await assertNoSymlinkEscape(resolved.root, dirname(resolved.path))
    } catch (err) {
      return fail('bad_ref', err instanceof Error ? err.message : String(err))
    }
    const target = args.kind === 'skill' ? dirname(resolved.path) : resolved.path
    if (await exists(target)) return fail('exists', `${args.name} already exists`)
    try {
      const res = await this.config.write(ref, args.text, null)
      if (!res.ok) return fail(res.code === 'conflict' ? 'exists' : res.code, res.message, res.current)
      this.markChain(resolved.root, resolved.path)
      return { ok: true, ref, snapshot: res.snapshot, ...(res.backupPath ? { backupPath: res.backupPath } : {}) }
    } catch (err) {
      return fail('io', err instanceof Error ? err.message : String(err))
    }
  }

  // ---- rename ----

  async rename(args: { ref: ConfigFileRef; newName: string; baseHash: string; text?: string }): Promise<ItemMutationResult> {
    const src = this.editable(args.ref)
    if ('ok' in src) return src
    const { ref } = src
    const bad = validateNewName(ref.kind, args.newName)
    if (bad) return fail('bad_name', bad)
    let from: { root: string; path: string }
    let to: { root: string; path: string }
    const newRef = { ...ref, name: args.newName } as NonPluginRef
    try {
      from = this.config.resolveItem(ref)
      to = this.config.resolveItem(newRef)
      await assertNoSymlinkEscape(from.root, from.path)
      await assertNoSymlinkEscape(to.root, to.path)
      if (ref.kind === 'skill') await assertNoSymlinkEscape(to.root, dirname(to.path))
    } catch (err) {
      return fail('bad_ref', err instanceof Error ? err.message : String(err))
    }
    if (args.text !== undefined) {
      try {
        const fm = parseFrontmatter(args.text)
        if (fm.error) return fail('invalid_frontmatter', fm.error.message)
      } catch (err) {
        return fail('io', err instanceof Error ? err.message : String(err))
      }
    }
    const current = await this.config.read(ref)
    if (!current.exists) return fail('not_found', `${ref.name} no longer exists`, current)
    if (current.hash !== args.baseHash) return fail('conflict', 'The file changed on disk since it was read', current)

    const fromUnit = ref.kind === 'skill' ? dirname(from.path) : from.path
    const toUnit = ref.kind === 'skill' ? dirname(to.path) : to.path
    const caseOnly = normalizeCwdKey(fromUnit) === normalizeCwdKey(toUnit)
    if (!caseOnly && (await exists(toUnit))) return fail('exists', `${args.newName} already exists`)
    if (normalizeCwdKey(fromUnit) === normalizeCwdKey(toUnit) && fromUnit === toUnit) return fail('exists', 'The name did not change')
    try {
      await mkdir(dirname(toUnit), { recursive: true })
      await this.renameWithRetry(fromUnit, toUnit)
    } catch (err) {
      return fail('io', err instanceof Error ? err.message : String(err))
    }
    this.markChain(from.root, from.path)
    this.markChain(to.root, to.path)
    this.config.markOwnPath(fromUnit)
    this.config.markOwnPath(from.path)
    this.config.markOwnPath(toUnit)
    this.config.markOwnPath(to.path)

    try {
      if (args.text !== undefined) {
        const res = await this.config.write(newRef, args.text, current.hash)
        if (!res.ok) return fail(res.code, `Renamed, but rewriting the file failed: ${res.message}`, res.current)
        return { ok: true, ref: newRef, snapshot: res.snapshot, ...(res.backupPath ? { backupPath: res.backupPath } : {}) }
      }
      return { ok: true, ref: newRef, snapshot: await this.config.read(newRef) }
    } catch (err) {
      return fail('io', err instanceof Error ? err.message : String(err))
    }
  }

  // ---- delete (move to trash) ----

  async delete(args: { ref: ConfigFileRef; baseHash: string }): Promise<ItemMutationResult> {
    const src = this.editable(args.ref)
    if ('ok' in src) return src
    const { ref } = src
    let at: { root: string; path: string }
    try {
      at = this.config.resolveItem(ref)
      await assertNoSymlinkEscape(at.root, at.path)
    } catch (err) {
      return fail('bad_ref', err instanceof Error ? err.message : String(err))
    }
    const current = await this.config.read(ref)
    if (!current.exists) return fail('not_found', `${ref.name} no longer exists`, current)
    if (current.hash !== args.baseHash) return fail('conflict', 'The file changed on disk since it was read', current)
    const unit = ref.kind === 'skill' ? dirname(at.path) : at.path
    this.config.markOwnPath(unit)
    this.config.markOwnPath(at.path)
    try {
      const trashPath = await this.trash.move(unit, { kind: ref.kind, scope: ref.scope, name: ref.name })
      this.markChain(at.root, at.path)
      return { ok: true, ref, trashPath }
    } catch (err) {
      return fail('io', err instanceof Error ? err.message : String(err))
    }
  }

  // ---- helpers ----

  private editable(ref: ConfigFileRef): { ref: NonPluginRef } | ItemMutationResult {
    if (!isItemRef(ref)) return fail('bad_ref', 'Not an item reference')
    if (ref.scope === 'plugin') return fail('read_only', 'Plugin items are read-only')
    try {
      assertRefName(ref.kind, ref.name)
    } catch (err) {
      return fail('bad_ref', err instanceof Error ? err.message : String(err))
    }
    return { ref: ref as NonPluginRef }
  }

  private refOf(kind: ItemKind, scope: ItemScope, cwd: string | undefined, name: string): NonPluginRef | undefined {
    if (scope === 'project') return cwd ? ({ kind, scope, cwd, name } as NonPluginRef) : undefined
    return { kind, scope, name } as NonPluginRef
  }

  /** Mark every directory from the item up to (not including) the root, plus the file, as our own change. */
  private markChain(root: string, file: string): void {
    const stop = resolve(root)
    let cur = resolve(file)
    this.config.markOwnPath(cur)
    while (cur !== stop) {
      cur = dirname(cur)
      if (cur === stop || cur === dirname(cur)) break
      this.config.markOwnPath(cur)
    }
  }

  private async renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.renameFn(from, to)
        return
      } catch (err) {
        if (!isTransientFsError(err) || attempt >= 5) throw err
        await this.sleep(retryDelayMs(attempt))
      }
    }
  }
}

// ---- fs utilities ----

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch {
    return false
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    const st = await lstat(p)
    if (st.isDirectory()) return true
    if (st.isSymbolicLink()) return (await stat(p)).isDirectory()
    return false
  } catch {
    return false
  }
}

async function safeReaddir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function readHead(file: string, bytes: number): Promise<string> {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await fh.read(buf, 0, bytes, 0)
    const text = buf.subarray(0, bytesRead).toString('utf8')
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  } finally {
    await fh.close()
  }
}

/** Other files in a skill dir (relative, '/' separated, no symlinks, at most MAX_SKILL_FILES). */
async function listSkillFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (abs: string, prefix: string, depth: number): Promise<void> => {
    for (const e of await safeReaddir(abs)) {
      if (out.length >= MAX_SKILL_FILES) return
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (depth < 3 && !SKIP_DIRS.has(e.name)) await walk(join(abs, e.name), rel, depth + 1)
      } else if (e.isFile() && rel !== 'SKILL.md') out.push(rel)
    }
  }
  await walk(dir, '', 0)
  return out.sort()
}
