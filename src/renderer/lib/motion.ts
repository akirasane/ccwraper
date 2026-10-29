/** Motion constants mirroring docs/design/tokens.css (ms). Keep in sync with the --dur-* vars. */
export const duration = { instant: 80, fast: 120, base: 180, slow: 250 } as const

/** Framer Motion / `motion` equivalent of --ease-spring. */
export const spring = { type: 'spring', stiffness: 500, damping: 32 } as const

/** cubic-bezier arrays for `motion` (same curves as --ease-out / --ease-spring). */
export const ease = {
  out: [0.22, 1, 0.36, 1],
  spring: [0.34, 1.56, 0.64, 1]
} as const

/** Session list stagger: 30ms, at most 8 items. */
export const stagger = { step: 30, maxItems: 8 } as const
