// Types only (WP0, frozen). WP5 implements skill / command / agent specs against these.
import type { ItemKind, ModelOption } from '@shared/config'
import type { FrontmatterDoc } from '@shared/frontmatter'

export interface ItemField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'boolean' | 'list' | 'number'
  options?: string[]
  hint?: string
  placeholder?: string
}

export interface ItemIssue {
  key?: string
  message: string
  severity: 'error' | 'warning' | 'info'
}

export interface ItemValidationCtx {
  fileName: string
  knownTools?: string[]
  models?: ModelOption[]
}

export interface ItemKindSpec {
  kind: ItemKind
  label: string
  plural: string
  fields: ItemField[]
  template(name: string): string
  validate(doc: FrontmatterDoc, ctx: ItemValidationCtx): ItemIssue[]
}
