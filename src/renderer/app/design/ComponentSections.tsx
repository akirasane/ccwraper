import { ArrowUp, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import {
  Button,
  Chip,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Kbd,
  Spinner,
  StatusPill,
  Textarea,
  toast,
  Toggle,
  Tooltip,
  type StatusPillState
} from '@/components/ui'
import { Composer } from '@/features/chat/Composer'
import { DiffView } from '@/features/chat/diff/DiffView'
import { diffFromToolInput } from '@/features/chat/diff/compute-diff'
import { Markdown } from '@/features/chat/Markdown'
import { PermissionDialog } from '@/features/chat/permission/PermissionDialog'
import { StreamingText } from '@/features/chat/StreamingText'
import { ThinkingBlock } from '@/features/chat/ThinkingBlock'
import { ToolCard } from '@/features/chat/tools/ToolCard'
import { useChatStore } from '@/stores/chat-store'
import { CONV, MARKDOWN_SAMPLE, THINKING_SAMPLE, clearPermission, installIpcShim, seedPermission } from './demo-data'
import { Frame, Labeled, Section, Sub } from './kit'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const VARIANTS: Variant[] = ['primary', 'secondary', 'ghost', 'danger']
// Static stand-ins for :hover so the state is visible without a pointer.
const FORCED_HOVER: Record<Variant, string> = {
  primary: 'brightness-110 -translate-y-px',
  secondary: 'bg-bg-3',
  ghost: 'bg-bg-3 text-fg',
  danger: 'bg-danger/20'
}
const FORCED_FOCUS = 'shadow-[var(--accent-ring)]'

function ButtonStates(): React.JSX.Element {
  return (
    <Sub title="Button: variant x state (hover and focus are forced; real hover lifts 1px, press scales 0.98)">
      <div className="grid grid-cols-[repeat(5,max-content)] items-center gap-x-6 gap-y-3 overflow-x-auto">
        {['', 'default', 'hover', 'focus', 'disabled'].map((h) => (
          <span key={h} className="text-2xs text-fg-3">
            {h}
          </span>
        ))}
        {VARIANTS.map((v) => (
          <React.Fragment key={v}>
            <span className="font-mono text-xs text-fg-2">{v}</span>
            <Button variant={v}>Label</Button>
            <Button variant={v} className={FORCED_HOVER[v]}>
              Label
            </Button>
            <Button variant={v} className={FORCED_FOCUS}>
              Label
            </Button>
            <Button variant={v} disabled>
              Label
            </Button>
          </React.Fragment>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Labeled label="md 30">
          <Button>
            <Plus size={14} aria-hidden /> New session
          </Button>
        </Labeled>
        <Labeled label="sm 24">
          <Button size="sm">Small</Button>
        </Labeled>
        <Labeled label="icon-md 28">
          <Button size="icon-md" variant="primary" aria-label="Send">
            <ArrowUp size={15} aria-hidden />
          </Button>
        </Labeled>
        <Labeled label="icon-sm 24">
          <Button size="icon-sm" variant="ghost" aria-label="Delete">
            <Trash2 size={13} aria-hidden />
          </Button>
        </Labeled>
        <Labeled label="aria-disabled">
          <Button aria-disabled>Disabled</Button>
        </Labeled>
      </div>
    </Sub>
  )
}

function FieldStates(): React.JSX.Element {
  return (
    <Sub title="Input and Textarea">
      <div className="grid gap-4 md:grid-cols-2">
        <Labeled label="default">
          <Input className="w-64" placeholder="Search sessions" />
        </Labeled>
        <Labeled label="hover (forced)">
          <Input className="w-64 bg-bg-3" placeholder="Search sessions" />
        </Labeled>
        <Labeled label="focus (forced)">
          <Input
            className="w-64 border-accent-from shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-from)_18%,transparent)]"
            defaultValue="Focused value"
          />
        </Labeled>
        <Labeled label="mono">
          <Input mono className="w-64" defaultValue="src/renderer/main.tsx" />
        </Labeled>
        <Labeled label="error">
          <div className="w-64">
            <Input error defaultValue="not a path" aria-describedby="in-err" />
            <p id="in-err" className="m-0 mt-1 text-xs text-danger">
              That folder does not exist.
            </p>
          </div>
        </Labeled>
        <Labeled label="disabled">
          <Input className="w-64" disabled defaultValue="Locked" />
        </Labeled>
        <Labeled label="textarea">
          <Textarea className="w-64" placeholder="Longer text" />
        </Labeled>
        <Labeled label="textarea mono, error">
          <Textarea mono error className="w-64" defaultValue={'{ "broken": '} />
        </Labeled>
      </div>
    </Sub>
  )
}

const CHIPS = ['neutral', 'selected', 'ok', 'warn', 'danger', 'running'] as const

function PillCycle(): React.JSX.Element {
  const [state, setState] = React.useState<StatusPillState>('run')
  const order: StatusPillState[] = ['run', 'done', 'err']
  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatusPill state="run" />
      <StatusPill state="done" />
      <StatusPill state="err" />
      <span className="mx-2 h-4 w-px bg-border-strong" />
      <StatusPill state={state} />
      <Button size="sm" onClick={() => setState(order[(order.indexOf(state) + 1) % 3]!)}>
        Cycle state
      </Button>
    </div>
  )
}

export function PrimitivesSection(): React.JSX.Element {
  const [on, setOn] = React.useState(true)
  return (
    <Section id="primitives" title="UI primitives" note="Every component from components/ui in all of its states.">
      <ButtonStates />
      <FieldStates />
      <Sub title="Chip: variants, interactive, disabled">
        <div className="flex flex-wrap items-center gap-2">
          {CHIPS.map((v) => (
            <Chip key={v} variant={v}>
              {v}
            </Chip>
          ))}
          <span className="mx-2 h-4 w-px bg-border-strong" />
          <Chip onClick={() => undefined}>interactive</Chip>
          <Chip variant="selected" onClick={() => undefined}>
            selected
          </Chip>
          <Chip onClick={() => undefined} disabled>
            disabled
          </Chip>
        </div>
      </Sub>
      <Sub title="Status pill (crossfade + scale; error shakes once)">
        <PillCycle />
      </Sub>
      <Sub title="Toggle">
        <div className="flex flex-wrap items-center gap-5">
          <Labeled label="off">
            <Toggle aria-label="off" />
          </Labeled>
          <Labeled label="on">
            <Toggle aria-label="on" defaultChecked />
          </Labeled>
          <Labeled label="live (spring)">
            <Toggle aria-label="live" checked={on} onCheckedChange={setOn} />
          </Labeled>
          <Labeled label="disabled off">
            <Toggle aria-label="disabled off" disabled />
          </Labeled>
          <Labeled label="disabled on">
            <Toggle aria-label="disabled on" disabled defaultChecked />
          </Labeled>
        </div>
      </Sub>
      <Sub title="Spinner, Kbd, Tooltip">
        <div className="flex flex-wrap items-center gap-5">
          <Labeled label="12">
            <Spinner size={12} />
          </Labeled>
          <Labeled label="14 (default)">
            <Spinner />
          </Labeled>
          <Labeled label="24 labeled">
            <Spinner size={24} label="Loading" />
          </Labeled>
          <Labeled label="kbd">
            <span className="flex gap-1">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
              <Kbd>Esc</Kbd>
            </span>
          </Labeled>
          <Labeled label="tooltip (hover or focus)">
            <Tooltip content="Copy to clipboard">
              <Button variant="secondary" size="sm">
                Hover me
              </Button>
            </Tooltip>
          </Labeled>
        </div>
      </Sub>
      <Sub title="Toast (rendered by the app Toaster; glass-strong, slide-up, 4s)">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => toast.success('Rule saved', { description: 'Bash(git status:*)' })}>
            Success
          </Button>
          <Button size="sm" onClick={() => toast.warning('Context is 90% full')}>
            Warning
          </Button>
          <Button size="sm" onClick={() => toast.error('Could not start session')}>
            Error
          </Button>
          <Button size="sm" onClick={() => toast.info('Resumed session')}>
            Info
          </Button>
        </div>
      </Sub>
      <Sub title="Dialog (glass, scrim 55%, scale-in)">
        <Dialog>
          <DialogTrigger asChild>
            <Button>Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete session?</DialogTitle>
              <DialogDescription>This removes the local transcript. It cannot be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="danger">Delete</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Sub>
    </Section>
  )
}

/** Blocks the composer's send path: /design never reaches IPC. */
function NoIpc({ children }: { children: React.ReactNode }): React.JSX.Element {
  const stop = (e: React.SyntheticEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    toast.info('Sending is disabled on /design')
  }
  return (
    <div
      onKeyDownCapture={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) stop(e)
      }}
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest('button[aria-label="Send"]')) stop(e)
      }}
    >
      {children}
    </div>
  )
}

function Card({ convId, id }: { convId: string; id: string }): React.JSX.Element {
  return <ToolCard convId={convId} toolUseId={id} />
}

function PermissionTrigger(): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const pending = useChatStore((s) => s.convs[CONV.permission]?.pending.length ?? 0)
  const restore = React.useRef<(() => void) | undefined>(undefined)
  const close = React.useCallback((): void => {
    restore.current?.()
    restore.current = undefined
    clearPermission()
    setOpen(false)
  }, [])
  React.useEffect(() => {
    if (open && pending === 0) close()
  }, [open, pending, close])
  React.useEffect(() => close, [close])
  const launch = (kind: 'fixture' | 'bash' | 'edit'): void => {
    restore.current ??= installIpcShim()
    seedPermission(kind)
    setOpen(true)
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => launch('fixture')}>Write request (fixture)</Button>
        <Button onClick={() => launch('bash')}>Bash request</Button>
        <Button onClick={() => launch('edit')}>Edit request (diff)</Button>
      </div>
      <p className="m-0 mt-2 text-xs text-fg-3">
        Enter allows once, Esc denies. Replies only update the demo store; no IPC is sent.
      </p>
      {open && <PermissionDialog convId={CONV.permission} />}
    </>
  )
}

const EDIT_INPUT = {
  file_path: 'src/app.ts',
  old_string: 'const a = 1\nconst b = 2\nconsole.log(a + b)\n',
  new_string: 'const a = 1\nconst b = 3\nconst c = a * b\nconsole.log(a + b + c)\n'
}

export function ChatSection(): React.JSX.Element {
  const diff = React.useMemo(() => diffFromToolInput('Edit', EDIT_INPUT), [])
  const [flash, setFlash] = React.useState(0)
  return (
    <Section id="chat" title="Chat components" note="Rendered from event fixtures through throwaway conversations in the chat store. No IPC, no live model calls.">
      <Sub title="Tool card: running, done, error, needs approval">
        <div className="flex max-w-[760px] flex-col gap-3" data-testid="tool-cards">
          <Card convId={CONV.tools} id="run" />
          <Card convId={CONV.tools} id="done" />
          <Card convId={CONV.tools} id="err" />
          <Card convId={CONV.approval} id="appr" />
        </div>
      </Sub>
      <Sub title="Tool card: other renderers (Read, Grep, generic) and Edit from the tool-edit-turn fixture">
        <div className="flex max-w-[760px] flex-col gap-3">
          <Card convId={CONV.tools} id="read" />
          <Card convId={CONV.tools} id="grep" />
          <Card convId={CONV.tools} id="generic" />
          <Card convId={CONV.edit} id="tu1" />
        </div>
      </Sub>
      <Sub title="Diff view">
        <div className="flex max-w-[760px] flex-col gap-2">
          <div>
            <Button size="sm" onClick={() => setFlash((n) => n + 1)}>
              Replay flash
            </Button>
          </div>
          <div className="overflow-hidden rounded-md border border-border bg-bg-2">
            {diff ? <DiffView key={flash} diff={diff} flash={flash > 0} /> : null}
          </div>
        </div>
      </Sub>
      <Sub title="Thinking block: collapsed, active (shimmer), with duration">
        <Frame className="flex max-w-[760px] flex-col gap-2">
          <ThinkingBlock text={THINKING_SAMPLE} />
          <ThinkingBlock text={THINKING_SAMPLE} active />
          <ThinkingBlock text={THINKING_SAMPLE} startedAt={0} endedAt={7400} />
        </Frame>
      </Sub>
      <Sub title="Streaming text (caret + blur-in) and settled Markdown with a highlighted code block">
        <div className="grid max-w-[1100px] gap-4 md:grid-cols-2">
          <Frame>
            <StreamingText streaming text={'Reading the token file, then I will check each contrast ratio against the **documented** values'} />
          </Frame>
          <Frame>
            <Markdown text={MARKDOWN_SAMPLE} />
          </Frame>
        </div>
      </Sub>
      <Sub title="Composer: idle, focus (click into it), running (sweep, Stop, Esc to interrupt)">
        <NoIpc>
          <div className="flex flex-col gap-1 rounded-md border border-border bg-bg-0">
            <Composer convId={CONV.composerIdle} />
            <Composer convId={CONV.composerRunning} />
            <Composer convId={CONV.composerIdle} disabled disabledReason="Project folder is missing" />
          </div>
        </NoIpc>
      </Sub>
      <Sub title="Permission dialog">
        <PermissionTrigger />
      </Sub>
    </Section>
  )
}
