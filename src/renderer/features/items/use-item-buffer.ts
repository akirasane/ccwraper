import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConfigFileRef, ConfigSnapshot } from '@shared/config'
import { parseFrontmatter, type FrontmatterDoc } from '@shared/frontmatter'
import { toast } from '@/components/ui'
import { configKeys, refKey } from '@/lib/config-queries'
import { setDirty } from '@/stores/dirty-registry'

export type ItemBanner =
  | { kind: 'conflict'; current: ConfigSnapshot }
  | { kind: 'external' }
  | { kind: 'error'; message: string }
  | null

export interface ItemBuffer {
  snapshot: ConfigSnapshot | undefined
  loading: boolean
  loadError: string | undefined
  text: string
  setText: (t: string) => void
  dirty: boolean
  doc: FrontmatterDoc
  banner: ItemBanner
  saving: boolean
  save: () => Promise<void>
  reload: () => void
  keepMine: () => void
  overwrite: () => Promise<void>
  revert: () => void
  dismissBanner: () => void
}

export function itemDirtyKey(ref: ConfigFileRef): string {
  return `item:${refKey(ref)}`
}

/**
 * One item file as an editable text buffer (P2 use-settings-buffer pattern): `baseHash` always comes from
 * the snapshot last synced, a dirty buffer is never replaced by a refetch, and the dirty registry is kept current.
 * `readOnly` buffers never write.
 */
export function useItemBuffer(ref: ConfigFileRef, readOnly: boolean): ItemBuffer {
  const qc = useQueryClient()
  const key = configKeys.file(ref)
  const q = useQuery({ queryKey: key, queryFn: () => window.ccwrap.config.read(ref) })
  const snapshot = q.data

  const [base, setBase] = useState<ConfigSnapshot | undefined>(undefined)
  const [text, setText] = useState('')
  const [banner, setBanner] = useState<ItemBanner>(null)
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

  useEffect(() => {
    if (!snapshot) return
    const b = baseRef.current
    if (!b) return adopt(snapshot)
    if (snapshot.hash === b.hash) return
    if (textRef.current === b.text) adopt(snapshot)
    else setBanner((cur) => (cur?.kind === 'conflict' ? cur : { kind: 'external' }))
  }, [snapshot, adopt])

  const dirty = !readOnly && base !== undefined && text !== base.text
  const dirtyKey = itemDirtyKey(ref)
  useEffect(() => {
    setDirty(dirtyKey, dirty)
  }, [dirty, dirtyKey])
  useEffect(() => () => setDirty(dirtyKey, false), [dirtyKey])

  const doc = useMemo(() => parseFrontmatter(text), [text])

  const write = useCallback(
    async (baseHash: string | null) => {
      if (readOnly) return
      setSaving(true)
      try {
        const res = await window.ccwrap.config.write({ ref, text: textRef.current, baseHash })
        if (res.ok) {
          qc.setQueryData(key, res.snapshot)
          void qc.invalidateQueries({ queryKey: ['items', ref.kind] })
          adopt(res.snapshot)
          toast.success('Saved', { description: res.backupPath ? `Backup saved: ${res.backupPath}` : undefined })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ref, readOnly, adopt, qc]
  )

  const save = useCallback(async () => {
    const b = baseRef.current
    if (!b || parseFrontmatter(textRef.current).error) return
    await write(b.hash)
  }, [write])

  const target = banner?.kind === 'conflict' ? banner.current : snapshot

  const reload = useCallback(() => {
    if (!target) return
    qc.setQueryData(key, target)
    adopt(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    snapshot: base ?? snapshot,
    loading: q.isLoading,
    loadError: q.error ? (q.error instanceof Error ? q.error.message : String(q.error)) : undefined,
    text,
    setText,
    dirty,
    doc,
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
