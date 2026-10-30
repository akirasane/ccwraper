// Synthetic transcript line builder shared by usage tests.
export function aLine(o: {
  id?: string
  model?: string
  ts?: string
  sid?: string
  cwd?: string
  inp?: number
  out?: number
  cr?: number
  cc?: number
}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: o.ts ?? '2026-03-10T12:00:00.000Z',
    sessionId: o.sid ?? 's1',
    cwd: o.cwd ?? 'C:\\proj\\a',
    isSidechain: false,
    message: {
      id: o.id ?? 'm1',
      model: o.model ?? 'claude-x',
      content: [{ type: 'text', text: 'SECRET-BODY' }],
      usage: {
        input_tokens: o.inp ?? 1,
        output_tokens: o.out ?? 2,
        cache_read_input_tokens: o.cr ?? 3,
        cache_creation_input_tokens: o.cc ?? 4
      }
    }
  })
}
