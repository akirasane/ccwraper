import { Check, ChevronDown, ShieldAlert, ShieldCheck } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import * as React from 'react'
import { chipVariants } from '@/components/ui'
import { cn } from '@/lib/cn'
import { effectiveMode, useChatStore } from '@/stores/chat-store'
import { chooseMode } from './choose-mode'
import { useAllowBypass } from './mode-prefs'
import { isBypass, modeLabel, visibleModes } from './modes'

const itemCls =
  'flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-fg-2 outline-none ' +
  'data-[highlighted]:bg-bg-3 data-[highlighted]:text-fg data-[disabled]:opacity-40'

/** Permission mode chip + menu (replaces the cycling chip). Bypass is listed only when the preference is on. */
export function ModeMenu({ convId, disabled }: { convId: string; disabled?: boolean }): React.JSX.Element {
  const mode = useChatStore((s) => effectiveMode(s, convId))
  const allowBypass = useAllowBypass()
  const bypass = isBypass(mode)
  // Never hide the mode the engine is in, even if the preference was switched off meanwhile.
  const rows = visibleModes(allowBypass || bypass)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        disabled={disabled}
        aria-label={`Permission mode: ${modeLabel(mode)}`}
        title="Choose permission mode"
        data-testid="mode-chip"
        data-mode={mode}
        data-bypass={bypass || undefined}
        className={cn(
          chipVariants({ variant: bypass ? 'danger' : 'neutral' }),
          'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-from'
        )}
      >
        {bypass ? <ShieldAlert size={12} aria-hidden /> : <ShieldCheck size={12} aria-hidden />}
        {modeLabel(mode)}
        <ChevronDown size={11} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={6}
          aria-label="Permission mode"
          className="z-50 min-w-[260px] max-w-[340px] rounded-md border border-border-glass bg-glass p-1 text-fg shadow-lg backdrop-blur-[var(--blur-glass)]"
        >
          <DropdownMenu.RadioGroup value={mode} onValueChange={(v) => chooseMode(convId, v as typeof mode)}>
            {rows.map((m) => (
              <DropdownMenu.RadioItem
                key={m.value}
                value={m.value}
                data-testid="mode-option"
                data-mode={m.value}
                className={cn(itemCls, isBypass(m.value) && 'text-danger data-[highlighted]:bg-danger-bg data-[highlighted]:text-danger')}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{m.label}</span>
                  <span className="text-xs text-fg-3">{m.description}</span>
                </span>
                <DropdownMenu.ItemIndicator>
                  <Check size={12} aria-hidden className="shrink-0 text-accent-text" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
