import { Check, ChevronDown, Cpu } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import * as React from 'react'
import type { ModelOption } from '@shared/config'
import { chipVariants } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useChatStore } from '@/stores/chat-store'

const CACHE_KEY = 'ccwrap.models'
const ALIASES = ['default', 'opus', 'sonnet', 'fable', 'haiku']

export const FALLBACK_MODELS: ModelOption[] = [
  { value: 'default', displayName: 'Default' },
  { value: 'sonnet', displayName: 'Sonnet' },
  { value: 'opus', displayName: 'Opus' },
  { value: 'haiku', displayName: 'Haiku' }
]

function readCache(): ModelOption[] | undefined {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    const v: unknown = raw ? JSON.parse(raw) : undefined
    return Array.isArray(v) && v.length > 0 ? (v as ModelOption[]) : undefined
  } catch {
    return undefined
  }
}

function writeCache(models: ModelOption[]): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(models))
  } catch {
    /* storage unavailable */
  }
}

/** Cached list first (instant), refreshed from the live session when there is one. */
export function useModels(localId: string | undefined): ModelOption[] {
  const [models, setModels] = React.useState<ModelOption[]>(() => readCache() ?? FALLBACK_MODELS)
  React.useEffect(() => {
    if (!localId) return
    let cancelled = false
    const api = window.ccwrap?.session
    if (!api?.supportedModels) return
    api
      .supportedModels(localId)
      .then((list) => {
        if (cancelled || !Array.isArray(list) || list.length === 0) return
        writeCache(list)
        setModels(list)
      })
      .catch(() => {
        /* keep cached / fallback */
      })
    return () => {
      cancelled = true
    }
  }, [localId])
  return models
}

/** Aliases first, full model ids under "more". */
export function splitModels(models: ModelOption[]): { main: ModelOption[]; more: ModelOption[] } {
  const main = models.filter((m) => ALIASES.includes(m.value))
  const more = models.filter((m) => !ALIASES.includes(m.value))
  return main.length === 0 ? { main: models, more: [] } : { main, more }
}

const itemCls =
  'flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-fg-2 outline-none ' +
  'data-[highlighted]:bg-bg-3 data-[highlighted]:text-fg data-[disabled]:opacity-40'

export function ModelMenu({ convId, disabled }: { convId: string; disabled?: boolean }): React.JSX.Element {
  const localId = useChatStore((s) => s.convs[convId]?.localId)
  const current = useChatStore((s) => s.convs[convId]?.meta.model)
  const models = useModels(localId)
  const [showMore, setShowMore] = React.useState(false)
  const { main, more } = splitModels(models)
  const label = (v: string | undefined): string => (v ? (models.find((m) => m.value === v)?.displayName ?? v) : 'Model')

  const choose = (value: string): void => {
    void useChatStore.getState().setModel(convId, value)
  }
  const row = (m: ModelOption): React.JSX.Element => (
    <DropdownMenu.Item key={m.value} className={itemCls} onSelect={() => choose(m.value)} data-testid="model-option">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{m.displayName}</span>
        {m.description && <span className="truncate text-xs text-fg-3">{m.description}</span>}
      </span>
      {current === m.value && <Check size={12} aria-hidden className="shrink-0 text-accent-text" />}
    </DropdownMenu.Item>
  )

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        disabled={disabled}
        aria-label={`Model: ${label(current)}`}
        title="Choose model"
        className={cn(
          chipVariants(),
          'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-from'
        )}
      >
        <Cpu size={12} aria-hidden />
        {label(current)}
        <ChevronDown size={11} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={6}
          className="z-50 max-h-[320px] min-w-[220px] max-w-[320px] overflow-y-auto rounded-md border border-border-glass bg-glass p-1 text-fg shadow-lg backdrop-blur-[var(--blur-glass)]"
        >
          {main.map(row)}
          {more.length > 0 && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                className={itemCls}
                onSelect={(e) => {
                  e.preventDefault()
                  setShowMore((v) => !v)
                }}
                aria-expanded={showMore}
              >
                <span className="flex-1">More models ({more.length})</span>
                <ChevronDown size={11} aria-hidden className={cn('transition-transform duration-fast', showMore && 'rotate-180')} />
              </DropdownMenu.Item>
              {showMore && more.map(row)}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
