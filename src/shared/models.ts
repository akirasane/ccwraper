/** Fallback before the first result reports contextWindow: 1M for ids with "[1m]", else 200k. */
export function assumedContextWindow(model: string | undefined): number {
  return model && /\[1m\]/i.test(model) ? 1_000_000 : 200_000
}
