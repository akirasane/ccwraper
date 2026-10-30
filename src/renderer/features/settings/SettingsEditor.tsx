import { AlertTriangle, Copy, RotateCcw, Save } from 'lucide-react'
import { Tabs } from 'radix-ui'
import { useEffect } from 'react'
import type { ConfigFileRef } from '@shared/config'
import { Button, Spinner, toast } from '@/components/ui'
import { cn } from '@/lib/cn'
import { setSettingsDirty } from './dirty-guard'
import { FormTab } from './FormTab'
import { PrecedenceTab } from './PrecedenceTab'
import { RawTab } from './RawTab'
import { useSettingsBuffer, type Banner } from './use-settings-buffer'

export type SettingsTab = 'form' | 'raw' | 'precedence'

function BannerView({ banner, buf }: { banner: Banner; buf: ReturnType<typeof useSettingsBuffer> }) {
  if (!banner) return null
  const base = 'flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-base'
  if (banner.kind === 'error') {
    return (
      <div role="alert" className={cn(base, 'border-danger-border bg-danger-bg text-danger')}>
        <AlertTriangle size={14} aria-hidden />
        <span className="min-w-0 flex-1">Could not save: {banner.message}</span>
        <Button size="sm" variant="ghost" onClick={buf.dismissBanner}>
          Dismiss
        </Button>
      </div>
    )
  }
  const conflict = banner.kind === 'conflict'
  return (
    <div role="alert" className={cn(base, 'border-warn-border bg-warn-bg text-warn')} data-testid={conflict ? 'conflict-banner' : 'external-banner'}>
      <AlertTriangle size={14} aria-hidden />
      <span className="min-w-0 flex-1">
        {conflict
          ? 'The file changed on disk since you opened it, so nothing was saved.'
          : 'This file changed on disk. Your unsaved edits are kept.'}
      </span>
      <Button size="sm" variant="secondary" onClick={buf.reload}>
        Reload
      </Button>
      {conflict ? (
        <Button size="sm" variant="danger" disabled={buf.saving} onClick={() => void buf.overwrite()}>
          Overwrite
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={buf.keepMine}>
          Keep mine
        </Button>
      )}
    </div>
  )
}

export function SettingsEditor({
  fileRef,
  cwd,
  tab,
  onTabChange
}: {
  fileRef: ConfigFileRef
  cwd?: string
  tab: SettingsTab
  onTabChange: (t: SettingsTab) => void
}): React.JSX.Element {
  const buf = useSettingsBuffer(fileRef)

  useEffect(() => {
    setSettingsDirty(buf.dirty)
  }, [buf.dirty])
  useEffect(() => () => setSettingsDirty(false), [])

  const canSave = buf.dirty && buf.parsed.ok && !buf.saving && buf.snapshot !== undefined
  const copyPath = () => {
    const p = buf.snapshot?.path
    if (!p) return
    void navigator.clipboard?.writeText(p).then(
      () => toast.success('Path copied'),
      () => toast.error('Could not copy the path')
    )
  }

  return (
    <Tabs.Root value={tab} onValueChange={(v) => onTabChange(v as SettingsTab)} className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs.List aria-label="Settings view" className="inline-flex gap-1 rounded-md border border-border bg-bg-1 p-0.5">
          {(
            [
              ['form', 'Form'],
              ['raw', 'Raw JSON'],
              ['precedence', 'Precedence']
            ] as const
          ).map(([v, label]) => (
            <Tabs.Trigger
              key={v}
              value={v}
              className="h-6 rounded-sm px-3 text-base text-fg-2 transition-colors duration-fast hover:text-fg data-[state=active]:bg-accent-tint data-[state=active]:text-accent-text"
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {tab !== 'precedence' && buf.snapshot && (
          <div className="flex min-w-0 items-center gap-1.5 text-sm text-fg-3">
            <code className="min-w-0 select-all truncate font-mono" title={buf.snapshot.path} data-testid="settings-path">
              {buf.snapshot.path}
            </code>
            {!buf.snapshot.exists && <span>(will be created)</span>}
            <Button variant="ghost" size="icon-sm" aria-label="Copy path" onClick={copyPath}>
              <Copy size={13} />
            </Button>
          </div>
        )}
      </div>

      {tab !== 'precedence' && <BannerView banner={buf.banner} buf={buf} />}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {tab === 'precedence' ? (
          <PrecedenceTab cwd={cwd} />
        ) : buf.loading ? (
          <div role="status" className="flex items-center gap-2 text-fg-3">
            <Spinner size={14} /> Loading&hellip;
          </div>
        ) : buf.loadError ? (
          <p role="alert" className="text-danger">
            Could not read settings: {buf.loadError}
          </p>
        ) : (
          <>
            <Tabs.Content value="form" className="outline-none">
              <FormTab
                text={buf.text}
                value={buf.parsed.ok ? buf.parsed.value : undefined}
                parseError={buf.parsed.ok ? undefined : buf.parsed.message}
                onTextChange={buf.setText}
                onOpenRaw={() => onTabChange('raw')}
              />
            </Tabs.Content>
            <Tabs.Content value="raw" className="flex h-full flex-col outline-none">
              <RawTab text={buf.text} parsed={buf.parsed} onChange={buf.setText} onSave={() => void buf.save()} />
            </Tabs.Content>
          </>
        )}
      </div>

      {tab !== 'precedence' && (
        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          {buf.dirty && <span className="mr-auto text-sm text-warn">Unsaved changes</span>}
          <Button variant="ghost" disabled={!buf.dirty} onClick={buf.revert}>
            <RotateCcw size={13} /> Revert
          </Button>
          <Button variant="primary" disabled={!canSave} onClick={() => void buf.save()}>
            <Save size={13} /> {buf.saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </Tabs.Root>
  )
}
