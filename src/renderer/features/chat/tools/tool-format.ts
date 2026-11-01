const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const s = (v: unknown): string => (typeof v === 'string' ? v : '')

/** One-line, mono argument shown in the card header. */
export function argSummary(name: string, input: unknown): string {
  const i = rec(input)
  switch (name) {
    case 'Bash':
      return s(i.command).split('\n')[0] ?? ''
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return s(i.file_path)
    case 'Grep':
    case 'Glob':
      return s(i.pattern)
    case 'TodoWrite':
      return Array.isArray(i.todos) ? `${i.todos.length} ${i.todos.length === 1 ? 'task' : 'tasks'}` : ''
    case 'TaskUpdate':
      return [s(i.taskId) && `#${s(i.taskId)}`, s(i.status), s(i.subject)].filter(Boolean).join(' ')
    default: {
      const first = Object.values(i).find((v) => typeof v === 'string')
      return typeof first === 'string' ? first.split('\n')[0]! : ''
    }
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const sec = ms / 1000
  return sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
}

export function resultLineCount(result: string | undefined): number {
  if (!result) return 0
  return result.split('\n').filter((l) => l.trim() !== '').length
}
