import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { PullRequestOpener } from '../src/broker.js'
import { fillPreview } from '../src/github-app.js'
import { openSqliteStore } from '../src/open-sqlite.js'
import { standing } from '../src/routines.js'
import { Workspaces, type RepoReader } from '../src/workspace.js'
import { repoRoot, setupBroker, tempDbPath, writeManifest } from './helpers.js'

const fx = (name: string) => readFileSync(path.join(repoRoot, 'fixtures/github', name), 'utf8')

const manifest = `schemaVersion: 1
project:
  name: harbor-pantry
  nonprofit: true
  github: https://github.com/example/harbor-pantry
  preview: https://{branch}.harbor.pages.dev
  volunteerReviewers: true
tasks:
  - id: fix-overnight-hours
    title: Count overnight shifts forward
    goal: Make shift_hours count shifts that cross midnight forward.
    size: small
    instructions: |
      Fix shift_hours in pantry_shifts/shifts.py so overnight shifts count forward.
      Remove the xfail marker in tests/test_shifts.py and keep its assertions.
    acceptance: python -m pytest exits 0.
    tests: [python -m pytest]
    do: [pantry_shifts/shifts.py, tests/test_shifts.py]
    don't: [Do not add a dependency.]
    deliverable: A unified diff of pantry_shifts/shifts.py and tests/test_shifts.py, with the test output.
`

const plan = {
  understanding: 'Shifts that end after midnight must count forward, not negative.',
  files: ['pantry_shifts/shifts.py', 'tests/test_shifts.py'],
  steps: ['Wrap the end time past midnight'],
  verify: 'Run the tests.',
  fallback: 'Release the task with the reason.',
}
const evidence = [{ criterion: 'tests', evidence: 'pass' }]
const PR = 'https://github.com/example/harbor-pantry/pull/7'

async function setup() {
  let now = Date.parse('2026-11-25T08:00:00Z')
  const store = openSqliteStore(tempDbPath(), { maxAttempts: 3 })
  const opened: Parameters<PullRequestOpener['open']>[0][] = []
  const revised: Parameters<NonNullable<PullRequestOpener['revise']>>[0][] = []
  const { broker } = setupBroker({
    store, requirePlan: true, now: () => now,
    pullRequests: {
      open: async (i) => { opened.push(i); return PR },
      revise: async (i) => { revised.push(i); return i.prUrl },
    },
  })
  await broker.registerProject({ manifestPath: writeManifest(manifest) })
  const heads: string[] = []
  const reader: RepoReader = {
    headSha: async () => 'main000',
    pullRequestHead: async (url) => { heads.push(url); return { branch: 'volunteer/fix-overnight-hours-abc', sha: 'pr111' } },
    listFiles: async () => [{ path: 'pantry_shifts/shifts.py', size: 10 }, { path: 'tests/test_shifts.py', size: 10 }],
    readFile: async (sha, p) => p === 'pantry_shifts/shifts.py' ? (sha === 'pr111' ? fx('shifts.after.py') : fx('shifts.before.py')) : p === 'tests/test_shifts.py' ? fx('test_shifts.before.py') : null,
    tarballUrl: async () => 'https://codeload.example/t',
  }
  const workspaces = new Workspaces({ store, broker, reader: async () => reader, checks: null, now: () => now })
  const ada = await broker.registerMcpDonor({ name: 'ada', monthlyTasks: 9, acceptTerms: true })
  const bob = await broker.registerMcpDonor({ name: 'bob', monthlyTasks: 9, acceptTerms: true })
  const taskId = (await store.listAllTasks())[0]!.id
  const handIn = async (donorId: string, content: string) => {
    await broker.requestWork(donorId, 1, 'small', false)
    expect((await broker.claim(donorId, taskId)).ok).toBe(true)
    await broker.submitPlan(donorId, taskId, plan)
    await workspaces.writeFile(donorId, taskId, 'pantry_shifts/shifts.py', content)
    return workspaces.submit(donorId, taskId, 'Fixed', evidence)
  }
  return { store, broker, workspaces, ada, bob, taskId, opened, revised, heads, handIn, advance: (ms: number) => { now += ms } }
}

describe('revisions on the same pull request', () => {
  it('gives the author the first chance, continues the pull request branch, and adds a revision', async () => {
    const ctx = await setup()
    expect((await ctx.handIn(ctx.ada.id, fx('shifts.after.py'))).ok).toBe(true)
    expect(ctx.opened[0]!.record).toContain('**See it running:** https://{branch}.harbor.pages.dev')

    const asked = await ctx.broker.requestChanges({ taskId: ctx.taskId, repository: 'example/harbor-pantry', feedback: 'Please keep the old comment.' })
    expect(asked.ok).toBe(true)
    const task = await ctx.store.getTask(ctx.taskId)
    expect(task).toMatchObject({ state: 'open', revisionPr: PR, revisionDonor: ctx.ada.id })

    await ctx.broker.requestWork(ctx.bob.id, 1, 'small', false)
    expect(await ctx.broker.listEligible(ctx.bob.id)).toEqual([])
    expect(await ctx.broker.claim(ctx.bob.id, ctx.taskId)).toMatchObject({ ok: false, reason: 'reserved_for_revision' })

    const result = await ctx.handIn(ctx.ada.id, fx('shifts.after.py') + '# keep the old comment\n')
    expect(result.ok).toBe(true)
    expect(ctx.heads).toEqual([PR])
    expect(ctx.revised).toHaveLength(1)
    expect(ctx.revised[0]!.prUrl).toBe(PR)
    expect(ctx.revised[0]!.record).toContain('### Revision')
    expect(ctx.revised[0]!.record).toContain('Please keep the old comment.')
    expect(ctx.revised[0]!.patch).toContain('+# keep the old comment')
    expect(ctx.revised[0]!.patch).not.toContain('-    return')

    expect((await ctx.broker.pullRequestClosed({ taskId: ctx.taskId, merged: true, repository: 'example/harbor-pantry' })).ok).toBe(true)
    expect(await ctx.store.getTask(ctx.taskId)).toMatchObject({ state: 'done', donorId: ctx.ada.id })
  })

  it('opens the revision to everyone after three days', async () => {
    const ctx = await setup()
    await ctx.handIn(ctx.ada.id, fx('shifts.after.py'))
    await ctx.broker.requestChanges({ taskId: ctx.taskId, repository: 'example/harbor-pantry', feedback: 'Add a test.' })
    ctx.advance(3 * 86_400_000 + 1)
    await ctx.broker.requestWork(ctx.bob.id, 1, 'small', false)
    expect((await ctx.broker.claim(ctx.bob.id, ctx.taskId)).ok).toBe(true)
    const brief = await ctx.broker.taskInstructions(ctx.bob.id, ctx.taskId)
    expect(brief.revision?.pullRequest).toBe(PR)
    expect(brief.previousFeedback).toContain('Add a test.')
  })

  it('credits the author when the pull request is merged while a revision waits, and resets when it is closed', async () => {
    const ctx = await setup()
    await ctx.handIn(ctx.ada.id, fx('shifts.after.py'))
    await ctx.broker.requestChanges({ taskId: ctx.taskId, repository: 'example/harbor-pantry', feedback: 'Small thing.' })
    await ctx.broker.pullRequestClosed({ taskId: ctx.taskId, merged: true, repository: 'example/harbor-pantry' })
    expect(await ctx.store.getTask(ctx.taskId)).toMatchObject({ state: 'done', donorId: ctx.ada.id, revisionPr: null })

    const other = await setup()
    await other.handIn(other.ada.id, fx('shifts.after.py'))
    await other.broker.requestChanges({ taskId: other.taskId, repository: 'example/harbor-pantry', feedback: 'Wrong approach.' })
    await other.broker.requestWork(other.ada.id, 1, 'small', false)
    await other.broker.claim(other.ada.id, other.taskId)
    expect((await other.broker.pullRequestClosed({ taskId: other.taskId, merged: false, repository: 'example/harbor-pantry' })).ok).toBe(true)
    expect(await other.store.getTask(other.taskId)).toMatchObject({ state: 'open', donorId: null, revisionPr: null })
  })
})

describe('spam labels and previews', () => {
  it('weighs spam heavily on a volunteer\'s standing', () => {
    expect(standing({ accepted: 0, rejected: 0, spam: 1 }).level).toBe('small-only')
    expect(standing({ accepted: 3, rejected: 0, spam: 1 }).level).toBe('normal')
    expect(standing({ accepted: 5, rejected: 0, spam: 2 }).level).toBe('paused')
  })

  it('records spam when a labelled pull request is closed', async () => {
    const ctx = await setup()
    await ctx.handIn(ctx.ada.id, fx('shifts.after.py'))
    await ctx.broker.pullRequestClosed({ taskId: ctx.taskId, merged: false, repository: 'example/harbor-pantry', spam: true })
    expect((await ctx.store.donorTrackRecord(ctx.ada.id, 0)).spam).toBe(1)
    expect(await ctx.broker.requestWork(ctx.ada.id, 2, 'small', false)).toMatchObject({ ok: false, reason: 'small_tasks_only' })
  })

  it('fills preview links from the branch and pull request number', () => {
    expect(fillPreview('see https://{branch}.harbor.pages.dev', 'volunteer/Fix-Hours-abc1234', null)).toBe('see https://volunteer-fix-hours-abc1234.harbor.pages.dev')
    expect(fillPreview('https://deploy-preview-{pr}--harbor.netlify.app', 'x', 12)).toBe('https://deploy-preview-12--harbor.netlify.app')
  })
})

describe('tasks from GitHub issues', () => {
  it('turns a filled-in issue form into a task, and lists what is missing otherwise', async () => {
    const { issueToTask } = await import('../src/issue-tasks.js')
    const body = [
      '### Goal', '', 'The sign-up form fits a 360-pixel-wide phone screen.',
      '### Size', '', 'Small (one sitting, a few files)',
      '### Kind of work', '', 'Code',
      '### Files to change', '', 'site/signup.html\nsite/signup.css',
      '### Steps', '', 'Make site/signup.html use a single column under 600px.\nAdjust site/signup.css so inputs are full width.',
      '### Acceptance criteria', '', 'At 360px wide there is no horizontal scroll and the button is visible.',
      '### Check command', '', 'npm test',
      '### Do not', '', 'Do not add a dependency.',
      '### What you get back', '', '_No response_',
      '### Needs a computer', '', '- [ ] This task can only be done on the volunteer\'s own computer (not in a chat app).',
    ].join('\n')
    const ok = issueToTask({ number: 12, title: '[Volunteer task]: Fix the sign-up form on phones', body })
    expect(ok.errors).toEqual([])
    expect(ok.task).toMatchObject({ id: 'issue-12', issueNumber: 12, title: 'Fix the sign-up form on phones', kind: 'code', size: 'small', needsComputer: false, do: ['site/signup.html', 'site/signup.css'] })
    const bad = issueToTask({ number: 13, title: 'Help', body: '### Goal\n\n_No response_' })
    expect(bad.task).toBeNull()
    expect(bad.errors.join(' ')).toContain('issue #13')
  })

  it('adds issue tasks to the task list without letting them collide', async () => {
    const { parseManifestYaml } = await import('../src/manifest.js')
    const { issueToTask } = await import('../src/issue-tasks.js')
    const issue = issueToTask({ number: 3, title: 'Write the welcome note', body: '### Goal\n\nNew volunteers know where to go.\n### Size\n\nSmall\n### Kind of work\n\nWriting\n### Files to change\n\ndocs/welcome.md (new file)\n### Steps\n\nWrite docs/welcome.md (new file) with where to check in.\nAdd what to wear and who to ask for help.\n### Acceptance criteria\n\nUnder 200 words and mentions check-in.' }).task!
    expect(issue).toBeTruthy()
    const m = parseManifestYaml('schemaVersion: 1\nproject:\n  name: harbor-pantry\n  nonprofit: true\ntasks: []\n', [issue])
    expect(m.tasks.map((t) => t.id)).toEqual(['issue-3'])
    expect(m.tasks[0]!.kind).toBe('writing')
  })
})

describe('volunteer reviewers', () => {
  it('counts only approved reviewers, and only on projects that welcome them', async () => {
    const ctx = await setup()
    await ctx.store.insertAccount({ id: 'acc-1', github_id: '9', github_login: 'Kind-Reviewer', email: null }, 1)
    expect(await ctx.broker.isVolunteerReviewerFor(ctx.taskId, 'kind-reviewer')).toBe(false)
    await ctx.store.setReviewerStatus('acc-1', 'applied')
    expect(await ctx.broker.isVolunteerReviewerFor(ctx.taskId, 'kind-reviewer')).toBe(false)
    await ctx.store.setReviewerStatus('acc-1', 'approved')
    expect(await ctx.broker.isVolunteerReviewerFor(ctx.taskId, 'kind-reviewer')).toBe(true)
    expect(await ctx.broker.isVolunteerReviewerFor(ctx.taskId, 'someone-else')).toBe(false)
  })
})
