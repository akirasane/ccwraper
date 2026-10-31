import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import { DEFAULT_PREFS } from '../../shared/app'
import type { AppPrefs, AppPrefsPatch } from '../../shared/app'
import { AppPrefsPatchSchema } from '../../shared/ipc'
import { writeFileAtomic } from './atomic-write'

/** What a prefs.json may contain: every field optional (merged over the defaults), unknown keys ignored. */
const PrefsFileSchema = z.object({
  version: z.literal(1).optional(),
  notifications: z
    .object({
      enabled: z.boolean(),
      permission: z.boolean(),
      turnDone: z.boolean(),
      turnDoneMinSeconds: z.number().int().min(0).max(3600),
      backgroundTask: z.boolean(),
      flashTaskbar: z.boolean()
    })
    .partial()
    .optional(),
  hotkey: z
    .object({ enabled: z.boolean(), accelerator: z.string().min(1).max(64) })
    .partial()
    .optional(),
  confirmQuitWhileRunning: z.boolean().optional(),
  autoResume: z.object({ enabled: z.boolean(), prompt: z.string().max(2000) }).partial().optional(),
  allowBypassMode: z.boolean().optional()
})

function clean<T extends object>(o: T | undefined): Partial<T> {
  if (!o) return {}
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

/** Deep-merge a (partial) prefs object over a complete one. Returns a new object. */
export function mergePrefs(base: AppPrefs, patch: AppPrefsPatch): AppPrefs {
  return {
    version: 1,
    notifications: { ...base.notifications, ...clean(patch.notifications) },
    hotkey: { ...base.hotkey, ...clean(patch.hotkey) },
    confirmQuitWhileRunning: patch.confirmQuitWhileRunning ?? base.confirmQuitWhileRunning,
    autoResume: { ...base.autoResume, ...clean(patch.autoResume) },
    allowBypassMode: patch.allowBypassMode ?? base.allowBypassMode
  }
}

export interface PrefsServiceOptions {
  now?: () => number
  /** Called when the file existed but could not be used. `copy` is the preserved `.corrupt-<ts>` file. */
  onCorrupt?: (info: { reason: string; copy?: string }) => void
}

export type PrefsListener = (prefs: AppPrefs) => void

/**
 * App preferences in `<userData>/prefs.json`. Loaded synchronously (tiny file; main needs it before the window),
 * written atomically. A corrupt file yields the defaults and is kept next to them as `.corrupt-<ts>` (never deleted).
 */
export class PrefsService {
  private current: AppPrefs
  private listeners = new Set<PrefsListener>()
  private writeChain: Promise<unknown> = Promise.resolve()
  private now: () => number

  constructor(
    private file: string,
    private opts: PrefsServiceOptions = {}
  ) {
    this.now = opts.now ?? Date.now
    this.current = this.load()
  }

  private load(): AppPrefs {
    if (!existsSync(this.file)) return structuredClone(DEFAULT_PREFS)
    let reason: string | undefined
    try {
      const parsed = PrefsFileSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')))
      if (parsed.success) return mergePrefs(DEFAULT_PREFS, parsed.data)
      reason = parsed.error.issues[0]?.message ?? 'invalid prefs'
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err)
    }
    let copy: string | undefined
    try {
      copy = `${this.file}.corrupt-${this.now()}`
      copyFileSync(this.file, copy)
    } catch {
      copy = undefined
    }
    this.opts.onCorrupt?.({ reason, ...(copy ? { copy } : {}) })
    return structuredClone(DEFAULT_PREFS)
  }

  get(): AppPrefs {
    return structuredClone(this.current)
  }

  /** Validates the patch, merges it, writes atomically, then emits the new prefs. Throws on an invalid patch. */
  async set(patch: AppPrefsPatch): Promise<AppPrefs> {
    const valid = AppPrefsPatchSchema.parse(patch) as AppPrefsPatch
    const next = mergePrefs(this.current, valid)
    const write = this.writeChain.then(() => writeFileAtomic(this.file, JSON.stringify(next, null, 2) + '\n'))
    this.writeChain = write.catch(() => undefined)
    await write
    this.current = next
    const snapshot = this.get()
    for (const cb of [...this.listeners]) {
      try {
        cb(snapshot)
      } catch (err) {
        console.warn('[ccwrap] prefs listener failed', err instanceof Error ? err.message : err)
      }
    }
    return snapshot
  }

  onChange(cb: PrefsListener): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }
}
