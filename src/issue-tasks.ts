// Tasks from GitHub issues. Organizations write a task with the issue form in
// templates/.github/ISSUE_TEMPLATE/volunteer-task.yml (a web form on GitHub,
// no YAML), and a maintainer adds the label volunteer-ready to publish it.
// Anyone can open an issue from the form, so only that label, added by
// someone with write access, puts it on the board.

import { parseTaskEntry, type ManifestTask } from './manifest.js'

export const READY_LABEL = 'volunteer-ready'

// Issue forms turn into "### Label\n\nvalue" sections; empty answers read "_No response_".
export function parseIssueForm(body: string | null): Map<string, string> {
  const fields = new Map<string, string>()
  const parts = (body ?? '').replace(/\r\n/g, '\n').split(/^### +/m).slice(1)
  for (const part of parts) {
    const newline = part.indexOf('\n')
    const label = (newline === -1 ? part : part.slice(0, newline)).trim().toLowerCase()
    const value = (newline === -1 ? '' : part.slice(newline + 1)).trim()
    fields.set(label, value === '_No response_' ? '' : value)
  }
  return fields
}

const lines = (value: string | undefined) =>
  (value ?? '').split('\n').map((l) => l.replace(/^[-*]\s+/, '').replace(/^`|`$/g, '').trim()).filter(Boolean)

export function issueToTask(issue: { number: number; title: string; body: string | null }): { task: ManifestTask | null; errors: string[] } {
  const f = parseIssueForm(issue.body)
  const get = (label: string) => f.get(label) ?? ''
  const files = lines(get('files to change'))
  const entry: Record<string, unknown> = {
    id: `issue-${issue.number}`,
    title: issue.title.replace(/^\[?volunteer task\]?:?\s*/i, '').trim(),
    goal: get('goal'),
    size: (get('size').toLowerCase().match(/small|medium|large/)?.[0]) ?? 'small',
    kind: /writing/i.test(get('kind of work')) ? 'writing' : 'code',
    instructions: get('steps'),
    acceptance: get('acceptance criteria'),
    do: files,
    "don't": lines(get('do not')).length ? lines(get('do not')) : ['Do not change anything outside this task.'],
    deliverable: get('what you get back') || `A pull request changing ${files.join(', ') || 'the files listed'}.`,
  }
  const tests = lines(get('check command'))
  if (tests.length) entry.tests = tests
  if (/\[x\]/i.test(get('needs a computer'))) entry.needs = 'computer'
  const parsed = parseTaskEntry(entry, `issue #${issue.number}`)
  if (parsed.task) parsed.task.issueNumber = issue.number
  return parsed
}
