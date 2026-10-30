// Pure hooks model (P3 D8). Hooks are plain data in settings.hooks; nothing here (or anywhere in this
// feature) executes, tests or previews a hook command.
import { HookEntrySchema } from '@shared/config-schemas'
import { HOOK_EVENTS, MATCHER_HINTS, TOOL_MATCHER_EVENTS, type HookEventName } from '@shared/hook-events'
import type { PatchOp } from '@/features/settings/model/settings-patch'

export type RawObj = Record<string, unknown>
/** A matcher group as stored: `matcher?`, `hooks`, and any unknown keys (kept as-is). */
export interface HookGroup extends RawObj {
  matcher?: string
  hooks: RawObj[]
}

export const KNOWN_ENTRY_TYPES = ['command', 'prompt', 'agent', 'http', 'mcp_tool'] as const
export type KnownEntryType = (typeof KNOWN_ENTRY_TYPES)[number]

export interface HookEventView {
  event: string
  /** False when the event name is not in HOOK_EVENTS (newer CLI?). Kept, never dropped. */
  known: boolean
  groups: HookGroup[]
  /** The stored value was not an array of {hooks:[...]} groups: shown read-only and left untouched. */
  malformed: boolean
}

export interface HooksView {
  events: HookEventView[]
  /** `settings.hooks` exists but is not an object. */
  malformed: boolean
}

function isObj(v: unknown): v is RawObj {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function isKnownEventName(e: string): e is HookEventName {
  return (HOOK_EVENTS as readonly string[]).includes(e)
}

export function entryType(entry: RawObj): string {
  return typeof entry.type === 'string' ? entry.type : ''
}

export function isKnownEntryType(t: string): t is KnownEntryType {
  return (KNOWN_ENTRY_TYPES as readonly string[]).includes(t)
}

/** Read `settings.hooks` into events / groups / entries. Unknown events and entry types are kept. */
export function readHooks(settings: RawObj | undefined): HooksView {
  const raw = settings && Object.hasOwn(settings, 'hooks') ? settings.hooks : undefined
  if (raw === undefined) return { events: [], malformed: false }
  if (!isObj(raw)) return { events: [], malformed: true }
  const events: HookEventView[] = []
  for (const [event, value] of Object.entries(raw)) {
    const ok = Array.isArray(value) && value.every((g) => isObj(g) && Array.isArray(g.hooks) && g.hooks.every(isObj))
    events.push({
      event,
      known: isKnownEventName(event),
      groups: ok ? (value as HookGroup[]) : [],
      malformed: !ok
    })
  }
  return { events, malformed: false }
}

/**
 * The applyPatch ops that write one event (D8). An event with no group left is deleted; the `hooks`
 * object itself is only removed by applyPatch if the same patch created it.
 */
export function opsForEvent(event: string, groups: HookGroup[]): PatchOp[] {
  const kept = groups.filter((g) => g.hooks.length > 0)
  if (kept.length === 0) return [{ op: 'delete', path: ['hooks', event] }]
  return [{ op: 'set', path: ['hooks', event], value: kept }]
}

export function defaultEntry(type: KnownEntryType = 'command'): RawObj {
  switch (type) {
    case 'command':
      return { type, command: '' }
    case 'prompt':
    case 'agent':
      return { type, prompt: '' }
    case 'http':
      return { type, url: '' }
    case 'mcp_tool':
      return { type, server: '', tool: '' }
  }
}

export function newGroup(): HookGroup {
  return { hooks: [defaultEntry('command')] }
}

// ---- validation ----

export interface HookIssue {
  event: string
  /** group index; -1 for an event-level issue */
  group: number
  /** entry index; undefined for a group-level issue */
  entry?: number
  severity: 'error' | 'warning' | 'info'
  message: string
}

/** A matcher is fine when empty, `*`, a word list, or a RegExp that compiles. */
export function matcherProblem(matcher: string): string | undefined {
  if (matcher === '' || matcher === '*') return undefined
  try {
    new RegExp(matcher)
    return undefined
  } catch (e) {
    return `Matcher is not a valid regular expression: ${e instanceof Error ? e.message : String(e)}`
  }
}

const UNION_INDEX: Record<KnownEntryType, number> = { command: 0, prompt: 1, agent: 1, http: 2, mcp_tool: 3 }

/** Validate one known-type entry against the HookEntrySchema member for its type. */
export function entryProblem(entry: RawObj): string | undefined {
  const t = entryType(entry)
  if (!isKnownEntryType(t)) return undefined
  const member = HookEntrySchema.options[UNION_INDEX[t]]
  const res = member?.safeParse(entry)
  if (!res || res.success) return undefined
  const issue = res.error.issues[0]
  const field = issue?.path.join('.') || 'entry'
  const first = String(issue?.path[0] ?? '')
  const missing = first !== '' && (entry[first] === undefined || entry[first] === '')
  return missing ? `${field} is required` : `${field}: ${issue?.message ?? 'invalid'}`
}

export function validateHooks(settings: RawObj | undefined): HookIssue[] {
  const out: HookIssue[] = []
  const view = readHooks(settings)
  if (view.malformed) out.push({ event: '', group: -1, severity: 'warning', message: '"hooks" is not an object; edit it as raw JSON in Settings' })
  for (const ev of view.events) {
    if (!ev.known) out.push({ event: ev.event, group: -1, severity: 'info', message: 'unknown event (newer CLI?)' })
    if (ev.malformed) {
      out.push({ event: ev.event, group: -1, severity: 'warning', message: 'This event is not a list of { hooks: [...] } groups. It is kept as is.' })
      continue
    }
    ev.groups.forEach((g, gi) => {
      if (g.matcher !== undefined && typeof g.matcher !== 'string') {
        out.push({ event: ev.event, group: gi, severity: 'warning', message: 'matcher should be a string' })
      } else if (typeof g.matcher === 'string') {
        const p = matcherProblem(g.matcher)
        if (p) out.push({ event: ev.event, group: gi, severity: 'warning', message: p })
      }
      g.hooks.forEach((e, ei) => {
        const t = entryType(e)
        if (!t) out.push({ event: ev.event, group: gi, entry: ei, severity: 'error', message: 'type is required' })
        else if (!isKnownEntryType(t)) {
          out.push({ event: ev.event, group: gi, entry: ei, severity: 'info', message: `unknown hook type "${t}" (newer CLI?); edit it in the JSON box` })
        } else {
          const p = entryProblem(e)
          if (p) out.push({ event: ev.event, group: gi, entry: ei, severity: 'error', message: p })
        }
      })
    })
  }
  return out
}

export function hasErrors(issues: HookIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}

/** The per-event matcher hint (D8). */
export function matcherHint(event: string): string {
  if (!isKnownEventName(event)) return 'Matcher meaning depends on the event'
  const hint = MATCHER_HINTS[event]
  if (hint) return hint
  return 'matcher usually unused'
}

export function isToolMatcherEvent(event: string): boolean {
  return (TOOL_MATCHER_EVENTS as readonly string[]).includes(event)
}

// ---- executables for the confirm dialog ----

export interface ChangedExecutable {
  event: string
  kind: 'command' | 'http' | 'mcp_tool'
  /** The exact command line, URL or server/tool. Header values are never included. */
  text: string
  change: 'added' | 'changed'
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
  return JSON.stringify(v) ?? 'null'
}

function execDisplay(e: RawObj): { kind: ChangedExecutable['kind']; text: string } | undefined {
  const t = entryType(e)
  if (t === 'command') {
    const args = Array.isArray(e.args) ? ` ${(e.args as unknown[]).map(String).join(' ')}` : ''
    return { kind: 'command', text: `${String(e.command ?? '')}${args}` }
  }
  if (t === 'http') return { kind: 'http', text: String(e.url ?? '') }
  if (t === 'mcp_tool') return { kind: 'mcp_tool', text: `${String(e.server ?? '')} / ${String(e.tool ?? '')}` }
  return undefined
}

function execEntries(settings: RawObj | undefined): Array<{ event: string; sig: string; kind: ChangedExecutable['kind']; text: string }> {
  const out: Array<{ event: string; sig: string; kind: ChangedExecutable['kind']; text: string }> = []
  for (const ev of readHooks(settings).events) {
    for (const g of ev.groups) {
      for (const e of g.hooks) {
        const d = execDisplay(e)
        if (d) out.push({ event: ev.event, sig: `${stable(e)}|${typeof g.matcher === 'string' ? g.matcher : ''}`, ...d })
      }
    }
  }
  return out
}

/** Executable entries (command / http / mcp_tool) that are new or changed in `after` compared to `before`. */
export function changedExecutables(before: RawObj | undefined, after: RawObj | undefined): ChangedExecutable[] {
  const prev = execEntries(before)
  const counts = new Map<string, number>()
  for (const p of prev) counts.set(`${p.event}|${p.sig}`, (counts.get(`${p.event}|${p.sig}`) ?? 0) + 1)
  const out: ChangedExecutable[] = []
  for (const n of execEntries(after)) {
    const k = `${n.event}|${n.sig}`
    const left = counts.get(k) ?? 0
    if (left > 0) {
      counts.set(k, left - 1)
      continue
    }
    const sameText = prev.some((p) => p.event === n.event && p.kind === n.kind && p.text === n.text)
    out.push({ event: n.event, kind: n.kind, text: n.text, change: sameText ? 'changed' : 'added' })
  }
  return out
}

// ---- effective view ----

export interface EffectiveEntry {
  source: string
  matcher?: string
  entry: RawObj
}
export interface EffectiveEvent {
  event: string
  known: boolean
  entries: EffectiveEntry[]
}

/** Merge hooks from every resolved source (hooks are additive, not overridden), in source order. */
export function mergeEffective(sources: Array<{ source: string; settings: RawObj }>): EffectiveEvent[] {
  const byEvent = new Map<string, EffectiveEvent>()
  for (const s of sources) {
    for (const ev of readHooks(s.settings).events) {
      let slot = byEvent.get(ev.event)
      if (!slot) {
        slot = { event: ev.event, known: ev.known, entries: [] }
        byEvent.set(ev.event, slot)
      }
      for (const g of ev.groups) {
        for (const e of g.hooks) slot.entries.push({ source: s.source, matcher: typeof g.matcher === 'string' ? g.matcher : undefined, entry: e })
      }
    }
  }
  const order = (e: string): number => {
    const i = (HOOK_EVENTS as readonly string[]).indexOf(e)
    return i === -1 ? HOOK_EVENTS.length : i
  }
  return [...byEvent.values()].sort((a, b) => order(a.event) - order(b.event))
}
