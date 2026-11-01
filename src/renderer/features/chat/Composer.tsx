import { ArrowUp, Paperclip, Square, X } from 'lucide-react'
import * as React from 'react'
import { Button, Kbd, toast } from '@/components/ui'
import { setComposerInserter } from '@/lib/composer-bus'
import { useChatStore } from '@/stores/chat-store'
import { selectIsRunning } from './model/selectors'
import type { SlashCommandInfo } from '@shared/events'
import { ModelMenu } from './ModelMenu'
import { SLASH_LISTBOX_ID, SlashPopup, slashOptionId } from './SlashPopup'
import { FALLBACK_COMMANDS, filterCommands, slashQuery } from './slash-commands'
import { ModeMenu } from './mode/ModeMenu'
import { dataUrl, readImages } from './attachments'
import { applyMention, mentionAt } from './mentions'
import { routeSlash } from './slash-router'
import { AddDirButton, ExtraDirsChips } from './ExtraDirsBar'
import { selectExtraDirs, useExtraDirs } from '@/stores/extra-dirs-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { usePaletteStore } from '../palette/palette-store'
import { MENTION_LISTBOX_ID, MentionPopup, mentionOptionId } from './MentionPopup'
import { IMAGE_MEDIA_TYPES, type ImageAttachment } from '@shared/ipc'

const NO_IMAGES: ImageAttachment[] = []

export interface ComposerProps {
  convId: string
  /** Disables input (e.g. the project folder no longer exists). */
  disabled?: boolean
  disabledReason?: string
}

export function Composer({ convId, disabled = false, disabledReason }: ComposerProps): React.JSX.Element {
  const running = useChatStore((s) => {
    const c = s.convs[convId]
    return c ? selectIsRunning(c) : false
  })
  const hasPending = useChatStore((s) => (s.convs[convId]?.pending.length ?? 0) > 0)
  // The draft lives in the store so it survives tab switches (ChatView remounts per tab).
  const text = useChatStore((s) => s.drafts[convId] ?? '')
  const setText = React.useCallback((v: string) => useChatStore.getState().setDraft(convId, v), [convId])
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const images = useChatStore((s) => s.draftImages[convId]) ?? NO_IMAGES
  const fileInput = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)

  const attach = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    const cur = useChatStore.getState().draftImages[convId] ?? NO_IMAGES
    const { accepted, rejected } = await readImages(files, cur.length)
    if (accepted.length) useChatStore.getState().setDraftImages(convId, [...cur, ...accepted])
    if (rejected.length) toast.error('Could not attach', { description: rejected.join('\n') })
  }
  const removeImage = (idx: number): void =>
    useChatStore.getState().setDraftImages(convId, images.filter((_, i) => i !== idx))

  // The command palette inserts "/name " here through composer-bus.
  React.useEffect(() => {
    setComposerInserter((insert) => {
      const cur = useChatStore.getState().drafts[convId] ?? ''
      const sep = cur && !/\s$/.test(cur) ? ' ' : ''
      useChatStore.getState().setDraft(convId, `${cur}${sep}${insert}`)
      ref.current?.focus()
    })
    return () => setComposerInserter(undefined)
  }, [convId])

  // Auto-grow up to ~10 lines.
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [text])

  // Global Esc interrupts while running. The permission dialog owns Esc (deny) while a request is pending.
  React.useEffect(() => {
    if (!running || hasPending) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      void useChatStore.getState().interrupt(convId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, hasPending, convId])

  // ---- Slash-command popup ----
  const fullCommands = useChatStore((s) => s.convs[convId]?.meta.commands)
  const commandNames = useChatStore((s) => s.convs[convId]?.meta.slashCommands)
  const [caret, setCaret] = React.useState(0)
  const [activeIdx, setActiveIdx] = React.useState(0)
  const [dismissedFor, setDismissedFor] = React.useState<string | null>(null)
  const sourceCommands = React.useMemo<SlashCommandInfo[]>(() => {
    if (fullCommands?.length) return fullCommands
    if (commandNames?.length)
      return commandNames.map((n) => ({ name: n.replace(/^\//, ''), description: '', argumentHint: '' }))
    return FALLBACK_COMMANDS
  }, [fullCommands, commandNames])
  const usingFallback = sourceCommands === FALLBACK_COMMANDS
  const query = disabled ? null : slashQuery(text, Math.min(caret, text.length))
  const matches = React.useMemo(
    () => (query === null ? [] : filterCommands(sourceCommands, query)),
    [sourceCommands, query]
  )
  const popupOpen = query !== null && matches.length > 0 && dismissedFor !== text
  const active = Math.min(activeIdx, Math.max(0, matches.length - 1))
  React.useEffect(() => setActiveIdx(0), [query])

  const pick = (c: SlashCommandInfo): void => {
    const ws = text.search(/\s/)
    const rest = ws < 0 ? '' : text.slice(ws).trimStart()
    const next = `/${c.name} ${rest}`
    setText(next)
    setCaret(c.name.length + 2)
    setDismissedFor(null)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(c.name.length + 2, c.name.length + 2)
    })
  }
  const trackCaret = (el: HTMLTextAreaElement): void => setCaret(el.selectionStart ?? el.value.length)

  // ---- @file mention popup ----
  const cwd = useChatStore((s) => s.convs[convId]?.cwd)
  const extraDirs = useExtraDirs(selectExtraDirs(cwd))
  const mention = disabled || query !== null ? null : mentionAt(text, Math.min(caret, text.length))
  const [files, setFiles] = React.useState<{ key: string; list: string[] }>({ key: '', list: [] })
  const [mentionIdx, setMentionIdx] = React.useState(0)
  const [mentionDismissed, setMentionDismissed] = React.useState<string | null>(null)
  const mentionKey = mention && cwd ? `${cwd}\0${extraDirs.join('|')}\0${mention.query}` : null
  React.useEffect(() => {
    if (!mentionKey || !mention || !cwd) return
    let stale = false
    const h = window.setTimeout(() => {
      window.ccwrap.files
        .search({ cwd, ...(extraDirs.length ? { dirs: extraDirs } : {}), query: mention.query, limit: 20 })
        .then((list) => {
          if (!stale) setFiles({ key: mentionKey, list })
        })
        .catch(() => {
          if (!stale) setFiles({ key: mentionKey, list: [] })
        })
    }, 80)
    return () => {
      stale = true
      window.clearTimeout(h)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionKey])
  const mentionItems = mentionKey && files.key === mentionKey ? files.list : []
  const mentionOpen = mention !== null && mentionItems.length > 0 && mentionDismissed !== `${mention.start}:${mention.query}`
  const mentionActive = Math.min(mentionIdx, Math.max(0, mentionItems.length - 1))
  React.useEffect(() => setMentionIdx(0), [mentionKey])

  const pickMention = (path: string): void => {
    if (!mention) return
    const r = applyMention(text, caret, mention, path)
    setText(r.text)
    setCaret(r.caret)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(r.caret, r.caret)
    })
  }

  const userCommandNames = React.useMemo(
    () => new Set(sourceCommands.filter((c) => !c.builtin).map((c) => c.name.toLowerCase())),
    [sourceCommands]
  )
  const runSlashAction = (a: NonNullable<ReturnType<typeof routeSlash>>): void => {
    const chat = useChatStore.getState()
    switch (a.kind) {
      case 'clear':
        void chat.clearConversation(convId)
        break
      case 'model':
        void chat.setModel(convId, a.model)
        break
      case 'view':
        useWorkspaceStore.getState().setView(a.view)
        break
      case 'palette':
        usePaletteStore.getState().setOpen(true)
        break
    }
  }

  const canSend = !disabled && !running && (text.trim().length > 0 || images.length > 0)
  const send = (): void => {
    if (!canSend) return
    const value = text.trim()
    if (images.length === 0) {
      const action = routeSlash(value, userCommandNames)
      if (action) {
        setText('')
        runSlashAction(action)
        return
      }
    }
    const imgs = images
    setText('')
    useChatStore.getState().setDraftImages(convId, [])
    void useChatStore.getState().submit(convId, value, imgs)
  }
  const stop = (): void => {
    void useChatStore.getState().interrupt(convId)
  }

  return (
    <div className="relative shrink-0 px-6 pb-4 pt-2" data-testid="composer-dock">
      <div className="ccw-glow" aria-hidden />
      <div className="relative mx-auto w-full max-w-[var(--chat-max-w)]">
        {popupOpen ? (
          <SlashPopup
            items={matches}
            activeIndex={active}
            fallback={usingFallback}
            onPick={pick}
            onHover={setActiveIdx}
          />
        ) : null}
        {mentionOpen ? (
          <MentionPopup items={mentionItems} activeIndex={mentionActive} onPick={pickMention} onHover={setMentionIdx} />
        ) : null}
        <div
          className="ccw-composer min-h-[var(--composer-min-h)]"
          data-running={running}
          data-dragging={dragging || undefined}
          data-testid="composer"
          onDragOver={(e) => {
            if (disabled || !e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            setDragging(false)
            if (disabled || e.dataTransfer.files.length === 0) return
            e.preventDefault()
            void attach(Array.from(e.dataTransfer.files))
          }}
        >
          <ExtraDirsChips convId={convId} />
          {images.length > 0 ? (
            <ul className="flex flex-wrap gap-2 px-3 pt-3" data-testid="composer-images" aria-label="Attached images">
              {images.map((img, i) => (
                <li key={i} className="relative">
                  <img
                    src={dataUrl(img)}
                    alt={`Attached image ${i + 1}`}
                    className="h-16 w-16 rounded-sm border border-border object-cover"
                  />
                  <button
                    type="button"
                    aria-label={`Remove image ${i + 1}`}
                    onClick={() => removeImage(i)}
                    className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full border border-border bg-bg-2 text-fg-2 hover:text-fg"
                  >
                    <X size={10} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <textarea
            ref={ref}
            value={text}
            rows={2}
            disabled={disabled}
            aria-label="Message"
            style={{ boxShadow: 'none' }}
            placeholder={disabled ? (disabledReason ?? 'Unavailable') : 'Ask Claude to work on this project...'}
            aria-autocomplete="list"
            aria-controls={popupOpen ? SLASH_LISTBOX_ID : mentionOpen ? MENTION_LISTBOX_ID : undefined}
            aria-activedescendant={
              popupOpen && matches[active]
                ? slashOptionId(matches[active]!.name)
                : mentionOpen
                  ? mentionOptionId(mentionActive)
                  : undefined
            }
            onChange={(e) => {
              setText(e.target.value)
              trackCaret(e.target)
              setDismissedFor(null)
            }}
            onSelect={(e) => trackCaret(e.currentTarget)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
              if (files.length === 0) return
              e.preventDefault()
              void attach(files)
            }}
            onKeyDown={(e) => {
              if (mentionOpen && !e.nativeEvent.isComposing) {
                const n = mentionItems.length
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  setMentionIdx((mentionActive + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
                  return
                }
                if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                  e.preventDefault()
                  pickMention(mentionItems[mentionActive]!)
                  return
                }
                if (e.key === 'Escape' && mention) {
                  e.preventDefault()
                  e.stopPropagation()
                  setMentionDismissed(`${mention.start}:${mention.query}`)
                  return
                }
              }
              if (popupOpen && !e.nativeEvent.isComposing) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const n = matches.length
                  setActiveIdx((active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
                  return
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  if (e.key === 'Enter' && e.shiftKey) return
                  // A fully typed command name: Enter sends it (below) instead of re-inserting it.
                  if (e.key === 'Enter' && query === matches[active]!.name) {
                    e.preventDefault()
                    send()
                    return
                  }
                  e.preventDefault()
                  pick(matches[active]!)
                  return
                }
                if (e.key === 'Escape') {
                  // Popup owns Esc: closes itself, never reaches the global interrupt listener.
                  e.preventDefault()
                  e.stopPropagation()
                  setDismissedFor(text)
                  return
                }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
            className="block max-h-[220px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-md leading-[1.55] text-fg outline-none placeholder:text-fg-muted disabled:cursor-not-allowed disabled:opacity-[0.42]"
          />
          <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
            <ModeMenu convId={convId} disabled={disabled} />
            <ModelMenu convId={convId} disabled={disabled} />
            <AddDirButton convId={convId} {...(disabled ? { disabled } : {})} />
            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              accept={IMAGE_MEDIA_TYPES.join(',')}
              data-testid="composer-file-input"
              onChange={(e) => {
                void attach(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
            <Button
              variant="ghost"
              size="icon-md"
              aria-label="Attach image"
              disabled={disabled}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={14} aria-hidden />
            </Button>
            <div className="min-w-0 flex-1" />
            <span className="flex items-center gap-1.5 text-xs text-fg-3">
              {running ? (
                <>
                  <Kbd>Esc</Kbd> to interrupt
                </>
              ) : (
                <>
                  <Kbd>Enter</Kbd> to send
                </>
              )}
            </span>
            {running ? (
              <Button variant="danger" size="icon-md" aria-label="Stop" onClick={stop}>
                <Square size={12} fill="currentColor" aria-hidden />
              </Button>
            ) : (
              <Button variant="primary" size="icon-md" aria-label="Send" disabled={!canSend} onClick={send}>
                <ArrowUp size={15} aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
