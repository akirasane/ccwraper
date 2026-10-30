import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConfigFileRef, ConfigSnapshot } from '@shared/config'
import { configKeys } from '@/lib/config-queries'
import { toast } from '@/components/ui'
import { parseSettingsText } from './model/settings-patch'

export type Banner =
  | { kind: 'conflict'; current: ConfigSnapshot }
  | { kind: 'external' }
  | { kind: 'error'; message: string }
  | null

export interface SettingsBuffer {
  snapshot: ConfigSnapshot | undefined
  loading: boolean
  loadError: string | undefined
  text: string
  setText: (t: string) => void
  dirty: boolean
  parsed: ReturnType<typeof parseSettingsText>
  banner: Banner
  saving: boolean
  save: () => Promise<void>
  /** Drop local edits and take what is on disk (or the conflicting snapshot). */
  reload: () => void
  /** Keep local edits but rebase on the newer file; the next save overwrites it. */
  keepMine: () => void
  /** Write again using the conflicting snapshot's hash. */
  overwrite: () => Promise<void>
  revert: () => void
  dismissBanner: () => void
}

/**
 * One settings file as an editable text buffer (shared by the Form and Raw tabs).
 * `baseHash` always comes from the snapshot the buffer was last synced with, so main can detect conflicts.
 */
export function useSettingsBuffer(ref: ConfigFileRef): SettingsBuffer {
  const qc = useQueryClient()
  const key = configKeys.file(ref)
  const q = useQuery({ queryKey: key, queryFn: () => window.ccwrap.config.read(ref) })
  const snapshot = q.data

  const [base, setBase] = useState<ConfigSnapshot | undefined>(undefined)
  const [text, setText] = useState('')
  const [banner, setBanner] = useState<Banner>(null)
  const [saving, setSaving] = useState(false)
  const textRef = useRef(text)
  textRef.current = text
  const baseRef = useRef(base)
  baseRef.current = base

  const adopt = useCallback((s: ConfigSnapshot) => {
    setBase(s)
    setText(s.text)
    setBanner(null)
  }, [])

  // Sync from query data: first load, or a refetch (fs:changed). A dirty buffer is never replaced.
  useEffect(() => {
    if (!snapshot) return
    const b = baseRef.current
    if (!b) return adopt(snapshot)
    if (snapshot.hash === b.hash) return
    if (textRef.current === b.text) adopt(snapshot)
    else setBanner((cur) => (cur?.kind === 'conflict' ? cur : { kind: 'external' }))
  }, [snapshot, adopt])

  const dirty = base !== undefined && text !== base.text
  const parsed = useMemo(() => parseSettingsText(text), [text])

  const write = useCallback(
    async (baseHash: string | null) => {
      setSaving(true)
      try {
        const res = await window.ccwrap.config.write({ ref, text: textRef.current, baseHash })
        if (res.ok) {
          qc.setQueryData(key, res.snapshot)
          adopt(res.snapshot)
          toast.success('Settings saved', {
            description: res.backupPath ? `Backup saved: ${res.backupPath}` : undefined
          })
        } else if (res.code === 'conflict' && res.current) {
          setBanner({ kind: 'conflict', current: res.current })
        } else {
          setBanner({ kind: 'error', message: res.message })
        }
      } catch (e) {
        setBanner({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      } finally {
        setSaving(false)
      }
    },
    [ref, adopt, qc]
  )

  const save = useCallback(async () => {
    const b = baseRef.current
    if (!b || !parseSettingsText(textRef.current).ok) return
    await write(b.hash)
  }, [write])

  const target = banner?.kind === 'conflict' ? banner.current : snapshot

  const reload = useCallback(() => {
    if (!target) return
    qc.setQueryData(key, target)
    adopt(target)
  }, [target, adopt, qc])

  const keepMine = useCallback(() => {
    if (target) setBase(target)
    setBanner(null)
  }, [target])

  const overwrite = useCallback(async () => {
    if (!target) return
    await write(target.hash)
  }, [target, write])

  const revert = useCallback(() => {
    if (baseRef.current) setText(baseRef.current.text)
  }, [])

  return {
    snapshot,
    loading: q.isLoading,
    loadError: q.error ? (q.error instanceof Error ? q.error.message : String(q.error)) : undefined,
    text,
    setText,
    dirty,
    parsed,
    banner,
    saving,
    save,
    reload,
    keepMine,
    overwrite,
    revert,
    dismissBanner: () => setBanner(null)
  }
}
