import { AGENT_COLORS, AgentFrontmatterSchema } from '@shared/config-schemas'
import { PermissionModeSchema } from '@shared/permission-mode'
import { fileStem, missingTextIssue, modelIssues, parseErrorIssues, schemaIssues, toolListIssues } from './common'
import type { ItemIssue, ItemKindSpec } from './types'

export const agentSpec: ItemKindSpec = {
  kind: 'agent',
  label: 'Agent',
  plural: 'Agents',
  fields: [
    { key: 'name', label: 'Name', type: 'text', hint: 'The CLI uses this name, not the file name.' },
    { key: 'description', label: 'Description', type: 'textarea', hint: 'When Claude should delegate to this agent.' },
    { key: 'tools', label: 'Tools', type: 'list' },
    { key: 'disallowedTools', label: 'Disallowed tools', type: 'list' },
    { key: 'model', label: 'Model', type: 'text', placeholder: 'inherit' },
    { key: 'permissionMode', label: 'Permission mode', type: 'select', options: ['', ...PermissionModeSchema.options] },
    { key: 'color', label: 'Color', type: 'select', options: ['', ...AGENT_COLORS] },
    { key: 'maxTurns', label: 'Max turns', type: 'number' },
    { key: 'memory', label: 'Memory', type: 'select', options: ['', 'user', 'project', 'local'] },
    { key: 'effort', label: 'Effort', type: 'text', hint: 'low, medium, high, xhigh, max, or an integer.' },
    { key: 'background', label: 'Background', type: 'boolean' },
    { key: 'skills', label: 'Skills', type: 'list' },
    { key: 'initialPrompt', label: 'Initial prompt', type: 'textarea' }
  ],
  template(name) {
    return `---\nname: ${name}\ndescription: Describe when Claude should use this agent.\n---\n\nYou are a specialist agent. Describe your role and approach here.\n`
  },
  validate(doc, ctx) {
    const parseErr = parseErrorIssues(doc)
    if (parseErr.length) return parseErr
    const data = doc.data
    const issues: ItemIssue[] = [
      ...schemaIssues(AgentFrontmatterSchema, data),
      ...missingTextIssue(data, 'name'),
      ...missingTextIssue(data, 'description'),
      ...toolListIssues('tools', data.tools, ctx),
      ...toolListIssues('disallowedTools', data.disallowedTools, ctx),
      ...modelIssues(data.model, ctx)
    ]
    if (typeof data.name === 'string' && data.name && ctx.fileName) {
      const stem = fileStem(ctx.fileName)
      if (stem !== data.name) {
        issues.push({ key: 'name', message: `name "${data.name}" differs from the file name "${stem}" (the CLI uses name)`, severity: 'warning' })
      }
    }
    return issues
  }
}
