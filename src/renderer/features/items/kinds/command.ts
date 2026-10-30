import { CommandFrontmatterSchema } from '@shared/config-schemas'
import { missingTextIssue, modelIssues, parseErrorIssues, schemaIssues, toolListIssues } from './common'
import type { ItemKindSpec } from './types'

export const commandSpec: ItemKindSpec = {
  kind: 'command',
  label: 'Command',
  plural: 'Commands',
  fields: [
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'allowed-tools', label: 'Allowed tools', type: 'list' },
    { key: 'argument-hint', label: 'Argument hint', type: 'text', placeholder: '[message]' },
    { key: 'model', label: 'Model', type: 'text' },
    { key: 'disable-model-invocation', label: 'Disable model invocation', type: 'boolean' }
  ],
  template(name) {
    return `---\ndescription: Describe what /${name} does.\n---\n\nPrompt for Claude goes here. Use $ARGUMENTS for the arguments.\n`
  },
  validate(doc, ctx) {
    const parseErr = parseErrorIssues(doc)
    if (parseErr.length) return parseErr
    return [
      ...schemaIssues(CommandFrontmatterSchema, doc.data),
      ...missingTextIssue(doc.data, 'description'),
      ...toolListIssues('allowed-tools', doc.data['allowed-tools'], ctx),
      ...modelIssues(doc.data.model, ctx)
    ]
  }
}
