import { SkillFrontmatterSchema } from '@shared/config-schemas'
import { missingTextIssue, parseErrorIssues, schemaIssues, toolListIssues, modelIssues } from './common'
import type { ItemIssue, ItemKindSpec } from './types'

export const skillSpec: ItemKindSpec = {
  kind: 'skill',
  label: 'Skill',
  plural: 'Skills',
  fields: [
    { key: 'name', label: 'Name', type: 'text', hint: 'Lowercase letters, digits and hyphens (max 64). Should match the folder name.' },
    { key: 'description', label: 'Description', type: 'textarea', hint: 'What the skill does and when to use it (max 1024 characters).' },
    { key: 'allowed-tools', label: 'Allowed tools', type: 'list', hint: 'Tools usable without asking while the skill runs.' },
    { key: 'model', label: 'Model', type: 'text' },
    { key: 'argument-hint', label: 'Argument hint', type: 'text', placeholder: '[issue-number]' },
    { key: 'disable-model-invocation', label: 'Disable model invocation', type: 'boolean' },
    { key: 'user-invocable', label: 'User invocable', type: 'boolean' },
    { key: 'context', label: 'Context', type: 'select', options: ['', 'fork'] },
    { key: 'agent', label: 'Agent', type: 'text' },
    { key: 'paths', label: 'Paths', type: 'list', hint: 'Globs that activate the skill.' },
    { key: 'version', label: 'Version', type: 'text' },
    { key: 'license', label: 'License', type: 'text' }
  ],
  template(name) {
    return `---\nname: ${name}\ndescription: Describe what this skill does and when to use it.\n---\n\n# ${name}\n\nInstructions for Claude go here.\n`
  },
  validate(doc, ctx) {
    const parseErr = parseErrorIssues(doc)
    if (parseErr.length) return parseErr
    const data = doc.data
    const issues: ItemIssue[] = [...schemaIssues(SkillFrontmatterSchema, data)]
    // The name regex message from zod is generic; keep it but make it readable.
    for (const i of issues) if (i.key === 'name') i.message = 'name must be lowercase letters, digits and hyphens (1-64 characters)'
    // ctx.fileName for a skill is the skill directory name.
    if (typeof data.name === 'string' && ctx.fileName && data.name !== ctx.fileName) {
      issues.push({ key: 'name', message: `name "${data.name}" differs from the directory name "${ctx.fileName}"`, severity: 'warning' })
    }
    issues.push(...missingTextIssue(data, 'description'))
    if (typeof data.description === 'string' && data.description.length > 1024) {
      issues.push({ key: 'description', message: 'description is longer than 1024 characters', severity: 'warning' })
    }
    issues.push(...toolListIssues('allowed-tools', data['allowed-tools'], ctx))
    issues.push(...modelIssues(data.model, ctx))
    return issues
  }
}
