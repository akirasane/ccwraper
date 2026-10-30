import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

export type ClaudeSource = 'env' | 'user' | 'bundled'
export interface ClaudeBinaryInfo {
  /** undefined => let the SDK use its bundled binary. */
  path?: string
  version?: string
  source: ClaudeSource
  /** Why a user binary was rejected in favour of the bundled one. */
  note?: string
}

/** Parse the leading x.y.z of a version string (e.g. '2.1.312 (Claude Code)'). */
export function parseVersion(s: string | undefined): [number, number, number] | undefined {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(s ?? '')
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

/** -1 / 0 / 1; unparsable inputs compare as 0 (unknown => do not reject). */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! < pb[i]! ? -1 : 1
  }
  return 0
}

function readJsonVersion(file: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { version?: string }).version
  } catch {
    return undefined
  }
}

const ASAR_SEG = /([\\/])app\.asar(?=[\\/]|$)/i

/** True when `p` points inside an `app.asar` archive (spawning or loading native files from there fails). */
export function isInsideAsar(p: string): boolean {
  return ASAR_SEG.test(p)
}

/** Maps `<sep>app.asar<sep>` to `<sep>app.asar.unpacked<sep>` (electron-builder `asarUnpack` target). Other paths are unchanged. */
export function toUnpackedPath(p: string): string {
  return p.replace(ASAR_SEG, '$1app.asar.unpacked')
}

/**
 * Directories to start the node_modules walk from. Normally cwd then this module's dir; inside an asar only the
 * module's dir, so a packaged app launched from a folder with its own node_modules never loads a foreign SDK.
 */
export function sdkSearchStarts(cwd: string | undefined, moduleDir: string | undefined): string[] {
  if (moduleDir && isInsideAsar(moduleDir)) return [moduleDir]
  return [cwd, moduleDir].filter((x): x is string => !!x)
}

function searchStarts(): string[] {
  return sdkSearchStarts(process.cwd(), typeof __dirname === 'string' ? __dirname : undefined)
}

/** Versions of the installed SDK package and its bundled CLI (manifest.json), read via fs (no SDK import). */
export function readSdkVersions(): { cli?: string; sdk?: string } {
  for (const start of searchStarts()) {
    let dir = start
    for (;;) {
      const base = join(dir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk')
      if (existsSync(join(base, 'package.json'))) {
        const cli = readJsonVersion(join(base, 'manifest.json'))
        const sdk = readJsonVersion(join(base, 'package.json'))
        return { ...(cli ? { cli } : {}), ...(sdk ? { sdk } : {}) }
      }
      const up = dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  return {}
}

function findUserClaude(): string | undefined {
  const isWin = process.platform === 'win32'
  try {
    const out = execFileSync(isWin ? 'where.exe' : 'which', ['claude'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    })
    const candidates = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    // On Windows prefer a real .exe (the SDK spawns it directly; .cmd shims need a shell).
    const exe = candidates.find((c) => c.toLowerCase().endsWith('.exe'))
    if (exe) return exe
    if (!isWin && candidates[0]) return candidates[0]
  } catch {
    /* not on PATH */
  }
  const local = join(homedir(), '.local', 'bin', isWin ? 'claude.exe' : 'claude')
  return existsSync(local) ? local : undefined
}

function probeVersion(path: string): string | undefined {
  try {
    const out = execFileSync(path, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
    return parseVersion(out)?.join('.')
  } catch {
    return undefined
  }
}

let cached: ClaudeBinaryInfo | undefined

/** Test hook. */
export function resetClaudeBinaryCache(): void {
  cached = undefined
}

/**
 * Choose the claude binary (D1). CCWRAP_CLAUDE_PATH always wins; else the user's install if its
 * version is not older than the SDK's bundled CLI; else the bundled one. Cached after first call.
 */
export function resolveClaudeBinary(): ClaudeBinaryInfo {
  if (cached) return cached
  const bundledVersion = readSdkVersions().cli
  const bundled = (note?: string): ClaudeBinaryInfo => ({
    ...(bundledVersion ? { version: bundledVersion } : {}),
    source: 'bundled',
    ...(note ? { note } : {})
  })
  // Test-only override: the packaged smoke uses it to prove the bundled (unpacked) binary spawns.
  if (process.env['CCWRAP_CLAUDE_SOURCE'] === 'bundled') return (cached = bundled('forced by CCWRAP_CLAUDE_SOURCE=bundled'))
  const fromEnv = process.env['CCWRAP_CLAUDE_PATH']
  if (fromEnv && existsSync(fromEnv)) {
    const version = probeVersion(fromEnv)
    return (cached = { path: fromEnv, ...(version ? { version } : {}), source: 'env' })
  }
  const user = findUserClaude()
  if (!user) return (cached = bundled())
  const version = probeVersion(user)
  if (version && (!bundledVersion || compareVersions(version, bundledVersion) >= 0))
    return (cached = { path: user, version, source: 'user' })
  const note = version
    ? `user claude ${version} is older than bundled ${bundledVersion}; using bundled`
    : 'could not read user claude version; using bundled'
  console.warn('[ccwrap]', note)
  return (cached = bundled(note))
}

/** The chosen user/env binary, else the bundled one mapped out of any asar. undefined only when nothing is installed. */
export function pickClaudeExecutable(info: ClaudeBinaryInfo, bundled: string | undefined): string | undefined {
  if (info.path) return info.path
  return bundled ? toUnpackedPath(bundled) : undefined
}

/**
 * Path for the SDK's pathToClaudeCodeExecutable. Always explicit when any binary exists, so the SDK never
 * resolves `claude.exe` inside `app.asar` (where it cannot be spawned).
 */
export function resolveClaudeExecutable(): string | undefined {
  return pickClaudeExecutable(resolveClaudeBinary(), bundledClaudePath())
}

/** Stable comparison key for a cwd: resolved, no trailing separator (except a bare root), lowercased on Windows. */
export function normalizeCwdKey(p: string): string {
  let r = resolve(p)
  const root = parse(r).root
  while (r.length > root.length && /[\\/]$/.test(r)) r = r.slice(0, -1)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

// ---- P2: config locations (pure; all take env/home so tests never touch the real config) ----

export type EnvLike = Readonly<Record<string, string | undefined>>

/** `$CLAUDE_CONFIG_DIR` when set, else `<home>/.claude`. User settings and memory live here. */
export function claudeConfigDir(env: EnvLike = process.env, home: string = homedir()): string {
  const d = env['CLAUDE_CONFIG_DIR']
  return d ? resolve(d) : join(home, '.claude')
}

/** The CLI's global state file: `$CLAUDE_CONFIG_DIR/.claude.json` when set, else `<home>/.claude.json`. */
export function claudeGlobalConfigPath(env: EnvLike = process.env, home: string = homedir()): string {
  const d = env['CLAUDE_CONFIG_DIR']
  return d ? join(resolve(d), '.claude.json') : join(home, '.claude.json')
}

/** Enterprise managed settings file (read-only for us). */
export function managedSettingsPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode\\managed-settings.json'
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json'
  return '/etc/claude-code/managed-settings.json'
}

function needCwd(cwd: string | undefined, what: string): string {
  if (!cwd) throw new Error(`cwd is required for ${what}`)
  return cwd
}

export function settingsFilePath(
  scope: 'user' | 'project' | 'local',
  cwd?: string,
  env: EnvLike = process.env,
  home: string = homedir()
): string {
  if (scope === 'user') return join(claudeConfigDir(env, home), 'settings.json')
  const dir = join(needCwd(cwd, `${scope} settings`), '.claude')
  return join(dir, scope === 'project' ? 'settings.json' : 'settings.local.json')
}

export function memoryFilePath(
  scope: 'user' | 'project' | 'projectDotClaude' | 'local',
  cwd?: string,
  env: EnvLike = process.env,
  home: string = homedir()
): string {
  if (scope === 'user') return join(claudeConfigDir(env, home), 'CLAUDE.md')
  const root = needCwd(cwd, `${scope} memory`)
  if (scope === 'project') return join(root, 'CLAUDE.md')
  if (scope === 'projectDotClaude') return join(root, '.claude', 'CLAUDE.md')
  return join(root, 'CLAUDE.local.md')
}

// ---- P3: skills / commands / agents ----

export type ItemKindName = 'skill' | 'command' | 'agent'

const ITEM_DIR: Record<ItemKindName, string> = { skill: 'skills', command: 'commands', agent: 'agents' }

/** Root folder of one item kind: user `<configDir>/<plural>`, project `<cwd>/.claude/<plural>`. */
export function itemsRoot(
  kind: ItemKindName,
  scope: 'user' | 'project',
  cwd?: string,
  env: EnvLike = process.env,
  home: string = homedir()
): string {
  if (scope === 'user') return join(claudeConfigDir(env, home), ITEM_DIR[kind])
  return join(needCwd(cwd, `project ${kind}s`), '.claude', ITEM_DIR[kind])
}

/**
 * File of one item under `root`: skill `<root>/<name>/SKILL.md`, command `<root>/<a>[/<b>].md`, agent `<root>/<name>.md`.
 * Both slash forms are accepted in `name`. Throws when the name is empty, absolute, has a `..`/empty segment, or the
 * resolved path would leave `root`.
 */
export function itemFilePath(kind: ItemKindName, root: string, name: string): string {
  if (!name || /^[\\/]/.test(name) || /^[A-Za-z]:/.test(name) || name.includes('\0')) throw new Error(`Invalid item name: ${name}`)
  const segs = name.split(/[\\/]/)
  if (segs.some((s) => s === '' || s === '.' || s === '..')) throw new Error(`Invalid item name: ${name}`)
  if (kind !== 'command' && segs.length !== 1) throw new Error(`Invalid item name: ${name}`)
  const file =
    kind === 'skill' ? join(root, ...segs, 'SKILL.md') : join(root, ...segs.slice(0, -1), `${segs[segs.length - 1]}.md`)
  const rel = relative(resolve(root), resolve(file))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Item path escapes its root: ${name}`)
  return file
}

/** Where deleted items are moved: `<userData>/trash`. */
export function trashDir(userDataDir: string): string {
  return join(userDataDir, 'trash')
}

/** Injectable bundle of the above; services take this instead of reading env/os.homedir() themselves. */
export interface ConfigPaths {
  configDir: string
  globalConfigPath: string
  settingsFile(scope: 'user' | 'project' | 'local', cwd?: string): string
  memoryFile(scope: 'user' | 'project' | 'projectDotClaude' | 'local', cwd?: string): string
  itemsRoot(kind: ItemKindName, scope: 'user' | 'project', cwd?: string): string
}

export function createConfigPaths(env: EnvLike = process.env, home: string = homedir()): ConfigPaths {
  return {
    configDir: claudeConfigDir(env, home),
    globalConfigPath: claudeGlobalConfigPath(env, home),
    settingsFile: (scope, cwd) => settingsFilePath(scope, cwd, env, home),
    memoryFile: (scope, cwd) => memoryFilePath(scope, cwd, env, home),
    itemsRoot: (kind, scope, cwd) => itemsRoot(kind, scope, cwd, env, home)
  }
}

/**
 * The SDK's bundled claude binary (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude[.exe]`),
 * found by walking node_modules like readSdkVersions. undefined when not installed.
 */
export function bundledClaudePath(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | undefined {
  const rel = join('node_modules', '@anthropic-ai', `claude-agent-sdk-${platform}-${arch}`, platform === 'win32' ? 'claude.exe' : 'claude')
  for (const start of searchStarts()) {
    let dir = start
    for (;;) {
      const p = join(dir, rel)
      if (existsSync(p)) return p
      const up = dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  return undefined
}

// ---- P4: userData files and transcripts ----

export function prefsPath(userDataDir: string): string {
  return join(userDataDir, 'prefs.json')
}
export function windowStatePath(userDataDir: string): string {
  return join(userDataDir, 'window-state.json')
}
export function usageCachePath(userDataDir: string): string {
  return join(userDataDir, 'usage-cache.json')
}
export function usageLedgerPath(userDataDir: string): string {
  return join(userDataDir, 'usage-ledger.jsonl')
}

/** Root of the CLI's session transcripts: `<configDir>/projects`. */
export function transcriptsRoot(env: EnvLike = process.env, home: string = homedir()): string {
  return join(claudeConfigDir(env, home), 'projects')
}
