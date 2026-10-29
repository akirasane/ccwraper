import * as React from 'react'
import { cn } from '@/lib/cn'
import { Frame, Labeled, Ratio, Section, Sub, Swatch, Table } from './kit'

const SURFACES = ['--bg-0', '--bg-1', '--bg-2', '--bg-3']
const BORDERS = ['--border', '--border-strong', '--border-glass']
const SEMANTIC = ['ok', 'warn', 'danger', 'info']
const DIFF = ['--diff-add-bg', '--diff-add-gutter', '--diff-del-bg', '--diff-del-gutter', '--diff-flash']
const BGS = ['--bg-0', '--bg-1', '--bg-2', '--bg-3'] as const

// Documented WCAG numbers (docs/design/README.md "Contrast check"); the live figure is computed in the browser.
const TEXT_ROWS: { name: string; doc: string[] }[] = [
  { name: '--text-primary', doc: ['16.80', '16.12', '15.31', '14.23'] },
  { name: '--text-secondary', doc: ['7.12', '6.84', '6.49', '6.03'] },
  { name: '--text-tertiary', doc: ['5.22', '5.01', '4.76', '4.42'] },
  { name: '--text-muted', doc: ['3.29', '3.16', '3.00', '2.79'] },
  { name: '--accent-text', doc: ['7.27', '6.98', '6.63', '6.16'] },
  { name: '--ok', doc: ['11.35', '10.89', '10.35', '9.61'] },
  { name: '--warn', doc: ['11.85', '11.37', '10.80', '10.04'] },
  { name: '--danger', doc: ['7.15', '6.86', '6.52', '6.06'] },
  { name: '--info', doc: ['7.78', '7.47', '7.09', '6.59'] }
]

export function ColorSection(): React.JSX.Element {
  return (
    <Section
      id="colors"
      title="Color tokens"
      note="Swatch values are read from the live CSS variables. Contrast is computed in the browser; the small grey figure is the number documented in docs/design/README.md."
    >
      <Sub title="Surfaces">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {SURFACES.map((n) => (
            <Swatch key={n} name={n} />
          ))}
          <Swatch name="--bg-glass" />
          <Swatch name="--bg-glass-strong" />
          <Swatch name="--bg-scrim" />
        </div>
      </Sub>
      <Sub title="Borders">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {BORDERS.map((n) => (
            <Swatch key={n} name={n} />
          ))}
        </div>
      </Sub>
      <Sub title="Text: contrast ratio on each surface (live, documented)">
        <Table
          head={['Token', 'Sample', 'bg-0', 'bg-1', 'bg-2', 'bg-3']}
          rows={TEXT_ROWS.map((t) => [
            <span key="n" className="font-mono text-fg">
              {t.name}
            </span>,
            <span key="s" style={{ color: `var(${t.name})` }}>
              Aa The quick fox
            </span>,
            ...BGS.map((bg, i) => (
              <span key={bg} className="inline-flex items-baseline gap-1.5">
                <Ratio fg={t.name} bg={bg} />
                <span className="text-2xs text-fg-muted">{t.doc[i]}</span>
              </span>
            ))
          ])}
        />
        <p className="mt-2 max-w-[70ch] text-xs text-fg-3">
          text-muted fails AA by design: placeholders, disabled text and decoration only. text-tertiary on bg-3 is large text only.
        </p>
      </Sub>
      <Sub title="Accent">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Swatch name="--accent-from" />
          <Swatch name="--accent-to" />
          <Swatch name="--accent-solid-from" />
          <Swatch name="--accent-solid-to" />
          <Swatch name="--accent-text" />
          <Swatch name="--accent-tint" />
          <Swatch name="--selection" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Labeled label="--accent-gradient (borders, rings, caret)">
            <div className="h-9 w-56 rounded-sm" style={{ background: 'var(--accent-gradient)' }} />
          </Labeled>
          <Labeled label="--accent-solid (filled, carries white text)">
            <div
              className="flex h-9 w-56 items-center justify-center rounded-sm text-base font-medium text-on-accent"
              style={{ background: 'var(--accent-solid)' }}
            >
              Label
              <span className="ml-2 text-xs">
                <Ratio fg="--text-on-accent" bg="--accent-solid-from" />
              </span>
            </div>
          </Labeled>
          <Labeled label="--accent-ring (focus)">
            <div className="h-9 w-40 rounded-sm bg-bg-2" style={{ boxShadow: 'var(--accent-ring)' }} />
          </Labeled>
        </div>
      </Sub>
      <Sub title="Semantic: fg on its own tint, with border">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {SEMANTIC.map((s) => (
            <div
              key={s}
              className="rounded-sm border p-3"
              style={{ background: `var(--${s}-bg)`, borderColor: `var(--${s}-border)`, color: `var(--${s})` }}
            >
              <div className="font-mono text-sm">--{s}</div>
              <div className="text-xs">Message text on tint</div>
              <div className="mt-1 text-2xs text-fg-2">
                <Ratio fg={`--${s}`} bg="--bg-1" /> on bg-1
              </div>
            </div>
          ))}
        </div>
      </Sub>
      <Sub title="Diff">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {DIFF.map((n) => (
            <Swatch key={n} name={n} />
          ))}
        </div>
      </Sub>
    </Section>
  )
}

const TYPE_SCALE = [
  ['--text-2xs', 'kbd, badges'],
  ['--text-xs', 'status bar, meta, section labels'],
  ['--text-sm', 'chips, mono in cards'],
  ['--text-base', 'UI default'],
  ['--text-md', 'chat prose'],
  ['--text-lg', 'dialog titles'],
  ['--text-xl', 'page headings'],
  ['--text-2xl', 'empty state, design page title']
] as const

export function TypeSection(): React.JSX.Element {
  return (
    <Section id="type" title="Type scale" note="Geist for UI, Geist Mono for code. Sizes, weights, leading and tracking come from tokens.css.">
      <Table
        head={['Token', 'Use', 'Sample']}
        rows={TYPE_SCALE.map(([n, use]) => [
          <span key="n" className="font-mono text-fg">
            {n}
          </span>,
          use,
          <span
            key="s"
            className="text-fg"
            style={{
              fontSize: `var(${n})`,
              letterSpacing:
                n === '--text-2xl' || n === '--text-xl'
                  ? 'var(--tracking-tighter)'
                  : n === '--text-lg'
                    ? 'var(--tracking-tight)'
                    : undefined
            }}
          >
            Ship it quietly, then make it fast
          </span>
        ])}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Frame>
          <Sub title="Weights">
            <div className="text-md text-fg">
              <div style={{ fontWeight: 'var(--weight-regular)' }}>Regular 400</div>
              <div style={{ fontWeight: 'var(--weight-medium)' }}>Medium 500</div>
              <div style={{ fontWeight: 'var(--weight-semibold)' }}>Semibold 600</div>
            </div>
          </Sub>
        </Frame>
        <Frame>
          <Sub title="Mono">
            <div className="font-mono text-sm text-fg">
              <div>const mode = 0o755 // Geist Mono 12px</div>
              <div className="text-fg-3">0123456789 {'{}[]()=>'}</div>
            </div>
          </Sub>
        </Frame>
        <Frame>
          <Sub title="Leading and tracking">
            <div className="text-base text-fg-2">
              <div style={{ lineHeight: 'var(--leading-tight)' }}>tight 1.25 leading, a second line of sample text to show it</div>
              <div className="mt-1 text-xs uppercase" style={{ letterSpacing: 'var(--tracking-caps)' }}>
                caps tracking 0.06em
              </div>
            </div>
          </Sub>
        </Frame>
      </div>
    </Section>
  )
}

const RADII = [
  ['--radius-xs', 'kbd, inline code'],
  ['--radius-sm', 'buttons, chips, inputs, rows'],
  ['--radius-md', 'cards, composer, terminal'],
  ['--radius-lg', 'dialogs, palette'],
  ['--radius-full', 'pills']
] as const
const SHADOWS = ['--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-glow', '--highlight-inset'] as const

export function SurfaceSection(): React.JSX.Element {
  return (
    <Section id="surfaces" title="Radii, shadows and glass">
      <Sub title="Radii">
        <div className="flex flex-wrap gap-4">
          {RADII.map(([n, use]) => (
            <Labeled key={n} label={`${n} · ${use}`}>
              <div className="size-16 border border-border-strong bg-bg-3" style={{ borderRadius: `var(${n})` }} />
            </Labeled>
          ))}
        </div>
      </Sub>
      <Sub title="Shadows">
        <div className="flex flex-wrap gap-6 rounded-md bg-bg-0 p-6">
          {SHADOWS.map((n) => (
            <Labeled key={n} label={n}>
              <div className="h-16 w-32 rounded-md border border-border bg-bg-2" style={{ boxShadow: `var(${n})` }} />
            </Labeled>
          ))}
        </div>
      </Sub>
      <Sub title="Glass: backdrop blur 20px + saturate 140% over a busy backdrop">
        <div
          className="relative flex flex-wrap items-center gap-6 overflow-hidden rounded-md border border-border p-8"
          style={{ background: 'var(--accent-gradient)' }}
        >
          {(
            [
              ['--bg-glass', 'glass'],
              ['--bg-glass-strong', 'glass-strong']
            ] as const
          ).map(([n, label]) => (
            <div
              key={n}
              className="relative h-24 w-56 rounded-lg border border-border-glass p-4 text-sm text-fg shadow-lg"
              style={{ background: `var(${n})`, backdropFilter: 'blur(var(--blur-glass)) saturate(140%)' }}
            >
              <div className="font-medium">{label}</div>
              <div className="text-xs text-fg-2">{n} + --blur-glass</div>
            </div>
          ))}
          <div
            className="relative flex h-24 w-56 items-center justify-center rounded-lg border border-border-glass text-sm text-fg"
            style={{ background: 'var(--bg-scrim)' }}
          >
            scrim 55%
          </div>
        </div>
      </Sub>
    </Section>
  )
}

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

export function AnsiSection(): React.JSX.Element {
  return (
    <Section id="ansi" title="ANSI 16-color palette" note="xterm theme colors on --term-bg. Ratios are live; black is a background role only.">
      <div className="rounded-md border border-border p-4" style={{ background: 'var(--term-bg)', color: 'var(--term-fg)' }}>
        {[false, true].map((bright) => (
          <div key={String(bright)} className="grid grid-cols-2 gap-x-4 gap-y-2 py-1.5 md:grid-cols-4 lg:grid-cols-8">
            {ANSI.map((c) => {
              const v = `--ansi-${bright ? 'bright-' : ''}${c}`
              return (
                <div key={v} className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-4 shrink-0 rounded-xs ring-1 ring-inset ring-[var(--border-strong)]"
                      style={{ background: `var(${v})` }}
                    />
                    <span className="truncate font-mono text-sm" style={{ color: `var(${v})` }}>
                      {bright ? 'bright ' : ''}
                      {c}
                    </span>
                  </div>
                  <div className="pl-6 font-mono text-2xs text-fg-3">
                    <Ratio fg={v} bg="--term-bg" />
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        <div className="mt-3 border-t border-border pt-3 font-mono text-sm">
          <span style={{ color: 'var(--ansi-green)' }}>user@host</span>
          <span style={{ color: 'var(--ansi-white)' }}>:</span>
          <span style={{ color: 'var(--ansi-blue)' }}>~/proj</span>
          <span style={{ color: 'var(--term-fg)' }}>$ npm test </span>
          <span style={{ color: 'var(--ansi-bright-black)' }}>2 passed, </span>
          <span style={{ color: 'var(--ansi-red)' }}>1 failed</span>
          <span className="ml-1 inline-block h-[1em] w-[0.6em] align-text-bottom" style={{ background: 'var(--term-cursor)' }} />
        </div>
      </div>
    </Section>
  )
}

const DURS = [
  ['--dur-instant', 'palette open, press'],
  ['--dur-fast', 'hover, color, chip morph'],
  ['--dur-base', 'card enter, toggle, dialog'],
  ['--dur-slow', 'panel slide, collapse']
] as const
const EASES = [
  ['--ease-out', 'default'],
  ['--ease-in-out', 'symmetric moves'],
  ['--ease-spring', 'toggles, glyph pops']
] as const
const LOOPS = [
  ['Spinner', '0.8s', 'ccw-spin'],
  ['Caret', '1.06s', 'ccw-caret'],
  ['Shimmer', '1.6s', 'ccw-shimmer'],
  ['Composer sweep', '2.4s', 'ccw-composer (running)']
]

function Track({ style, on }: { style: React.CSSProperties; on: boolean }): React.JSX.Element {
  return (
    <div className="relative h-4 w-[200px] rounded-full bg-bg-2">
      <span
        aria-hidden
        className="absolute left-0 top-0 size-4 rounded-full transition-transform"
        style={{ ...style, background: 'var(--accent-gradient)', transform: on ? 'translateX(184px)' : 'translateX(0)' }}
      />
    </div>
  )
}

export function MotionSection(): React.JSX.Element {
  const [on, setOn] = React.useState(false)
  return (
    <Section
      id="motion"
      title="Motion"
      note="Animate only transform and opacity. Play runs every duration and easing against the same 184px move. prefers-reduced-motion zeroes the duration tokens."
    >
      <div className="flex flex-col gap-4">
        <div>
          <button
            type="button"
            onClick={() => setOn((v) => !v)}
            className="h-6 rounded-sm border border-border-strong bg-bg-2 px-2 text-sm text-fg hover:bg-bg-3"
          >
            {on ? 'Reset' : 'Play'}
          </button>
        </div>
        <Table
          head={['Duration', 'Use', 'Demo (ease-out)']}
          rows={DURS.map(([n, use]) => [
            <span key="n" className="font-mono text-fg">
              {n}
            </span>,
            use,
            <Track key="d" style={{ transitionDuration: `var(${n})`, transitionTimingFunction: 'var(--ease-out)' }} on={on} />
          ])}
        />
        <Table
          head={['Easing', 'Use', 'Demo (slow duration)']}
          rows={EASES.map(([n, use]) => [
            <span key="n" className="font-mono text-fg">
              {n}
            </span>,
            use,
            <Track key="d" style={{ transitionDuration: 'var(--dur-slow)', transitionTimingFunction: `var(${n})` }} on={on} />
          ])}
        />
      </div>
      <Sub title="Loops (stop under prefers-reduced-motion; the spinner slows to 1.6s)">
        <Table
          head={['Loop', 'Period', 'Class']}
          rows={LOOPS.map(([a, b, c]) => [
            a,
            b,
            <span key="c" className={cn('font-mono')}>
              {c}
            </span>
          ])}
        />
      </Sub>
      <Sub title="Entrances">
        <Table
          head={['Element', 'Motion']}
          rows={[
            ['Tool card', 'slide up 6px + fade, 180ms'],
            ['Session list items', 'stagger 30ms, at most 8'],
            ['Dialogs', 'scale from 0.96 + 6px blur, 180ms'],
            ['Press / hover', 'scale 0.98 / lift 1px'],
            ['Counters', 'tick to target in at most 600ms']
          ]}
        />
      </Sub>
    </Section>
  )
}
