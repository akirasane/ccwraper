import type { ConvState } from './types'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  id: string
  subject: string
  /** Present-continuous text shown while in progress ("Running tests"). */
  activeForm?: string
  status: TodoStatus
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const isStatus = (v: unknown): v is TodoStatus => v === 'pending' || v === 'in_progress' || v === 'completed'

/** The id the CLI assigned to a TaskCreate, read from its result text ("Task #3 created ..."). */
function createdId(result: string | undefined): string | undefined {
  if (!result) return undefined
  const m = /Task\s*#?\s*([A-Za-z0-9_-]+)/i.exec(result) ?? /"id"\s*:\s*"?([A-Za-z0-9_-]+)"?/.exec(result)
  return m?.[1]
}

/**
 * The conversation's current todo list, derived from its main-thread tool calls in order.
 * TodoWrite replaces the whole list; TaskCreate / TaskUpdate edit it by id (TaskUpdate status
 * "deleted" removes). Errored calls are ignored. Pure, so resumed history rebuilds it for free.
 */
export function deriveTodos(conv: Pick<ConvState, 'tools'>): TodoItem[] {
  let list: TodoItem[] = []
  let created = 0
  for (const t of Object.values(conv.tools)) {
    if (t.parentToolUseId || t.status === 'error') continue
    const input = rec(t.input)
    switch (t.name) {
      case 'TodoWrite': {
        if (!Array.isArray(input['todos'])) break
        list = input['todos'].flatMap((raw, i): TodoItem[] => {
          const r = rec(raw)
          const subject = str(r['content']) ?? str(r['subject'])
          if (!subject) return []
          const active = str(r['activeForm'])
          return [
            {
              id: String(i + 1),
              subject,
              ...(active ? { activeForm: active } : {}),
              status: isStatus(r['status']) ? r['status'] : 'pending'
            }
          ]
        })
        break
      }
      case 'TaskCreate': {
        const subject = str(input['subject'])
        if (!subject) break
        created += 1
        const id = createdId(t.result) ?? String(created)
        const active = str(input['activeForm'])
        list = [...list.filter((x) => x.id !== id), { id, subject, ...(active ? { activeForm: active } : {}), status: 'pending' }]
        break
      }
      case 'TaskUpdate': {
        const id = str(input['taskId'])
        if (!id) break
        if (input['status'] === 'deleted') {
          list = list.filter((x) => x.id !== id)
          break
        }
        list = list.map((x) => {
          if (x.id !== id) return x
          const subject = str(input['subject']) ?? x.subject
          const active = str(input['activeForm']) ?? x.activeForm
          return {
            ...x,
            subject,
            ...(active ? { activeForm: active } : {}),
            status: isStatus(input['status']) ? input['status'] : x.status
          }
        })
        break
      }
      default:
        break
    }
  }
  return list
}

export interface TodoProgress {
  done: number
  total: number
  current?: TodoItem
}

export function todoProgress(list: TodoItem[]): TodoProgress {
  const current = list.find((x) => x.status === 'in_progress')
  return { done: list.filter((x) => x.status === 'completed').length, total: list.length, ...(current ? { current } : {}) }
}
