import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { PullRequestOpener } from '../src/broker.js'
import { scanPatch } from '../src/contribution.js'
import { openSqliteStore } from '../src/open-sqlite.js'
import { Workspaces, type RepoReader } from '../src/workspace.js'
import { repoRoot, setupBroker, tempDbPath, writeManifest } from './helpers.js'

const fx = (name: string) => readFileSync(path.join(repoRoot, 'fixtures/github', name), 'utf8')

const manifest = `schemaVersion: 1
project:
  name: harbor-pantry
  nonprofit: true
  github: https://github.com/example/harbor-pantry
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
    deliverable: A unified diff of pantry_shifts/shifts.py and tests/test_shifts.py, submitted with a summary and the test output.
    estimatedCostUsd: 0.05
  - id: check-the-kiosk
    title: Check the kiosk screen layout
    goal: Confirm the check-in kiosk layout on a real screen.
    size: small
    needs: computer
    instructions: |
      Run the kiosk app in kiosk/app.py on your computer and compare it with docs/kiosk.md.
      Note any difference in docs/kiosk-notes.md.
    acceptance: docs/kiosk-notes.md lists each difference or says there are none.
    tests: [python kiosk/app.py]
    do: [docs/kiosk-notes.md]
    don't: [Do not change code.]
    deliverable: A unified diff adding docs/kiosk-notes.md.
    estimatedCostUsd: 0.05
`

function reader(): RepoReader {
  const files: Record<string, string> = {
    'pantry_shifts/shifts.py': fx('shifts.before.py'),
    'tests/test_shifts.py': fx('test_shifts.before.py'),
  }
  return {
    headSha: async () => 'base000',
    listFiles: async () => Object.keys(files).map((p) => ({ path: p, size: files[p]!.length })),
    readFile: async (_sha, p) => files[p] ?? null,
    tarballUrl: async () => 'https://codeload.example/tarball',
  }
}

async function setup() {
  const store = openSqliteStore(tempDbPath(), { maxAttempts: 3 })
  const opened: Parameters<PullRequestOpener['open']>[0][] = []
  const { broker } = setupBroker({ store, requirePlan: true, pullRequests: { open: async (input) => { opened.push(input); return 'https://github.com/example/harbor-pantry/pull/9' } } })
  await broker.registerProject({ manifestPath: writeManifest(manifest) })
  const workspaces = new Workspaces({ store, broker, reader: async () => reader(), checks: null })
  const donor = await broker.registerMcpDonor({ name: 'ada', monthlyTasks: 5, acceptTerms: true })
  return { store, broker, workspaces, donor, opened }
}

const plan = {
  understanding: 'Shifts that end after midnight must count forward, not negative.',
  files: ['pantry_shifts/shifts.py', 'tests/test_shifts.py'],
  steps: ['Wrap the end time past midnight', 'Remove the xfail marker'],
  verify: 'Run the tests and compare with the acceptance criteria.',
  fallback: 'Release the task with the reason if the tests disagree with the brief.',
}

describe('plan, act, evaluate', () => {
  it('refuses edits until a plan is in, keeps edits to the plan, and puts the record in the pull request', async () => {
    const ctx = await setup()
    expect((await ctx.broker.requestWork(ctx.donor.id, 1, 'small', false)).ok).toBe(true)
    const claimed = await ctx.broker.claimNext(ctx.donor.id)
    expect(claimed.ok).toBe(true)
    const taskId = (claimed as { taskId: string }).taskId
    expect(taskId).toContain('fix-overnight-hours')

    await expect(ctx.workspaces.writeFile(ctx.donor.id, taskId, 'pantry_shifts/shifts.py', 'x')).rejects.toThrow(/submit_plan/)
    const outside = await ctx.broker.submitPlan(ctx.donor.id, taskId, { ...plan, files: ['README.md'] })
    expect(outside.ok).toBe(false)
    expect((await ctx.broker.submitPlan(ctx.donor.id, taskId, { ...plan, fallback: '' })).ok).toBe(false)
    expect((await ctx.broker.submitPlan(ctx.donor.id, taskId, { ...plan, files: ['pantry_shifts/shifts.py'] })).ok).toBe(true)
    await expect(ctx.workspaces.writeFile(ctx.donor.id, taskId, 'tests/test_shifts.py', 'x')).rejects.toThrow(/not in your plan/)
    expect((await ctx.broker.submitPlan(ctx.donor.id, taskId, plan)).ok).toBe(true)

    await ctx.workspaces.writeFile(ctx.donor.id, taskId, 'pantry_shifts/shifts.py', fx('shifts.after.py'))
    await expect(ctx.workspaces.submit(ctx.donor.id, taskId, 'done', [])).resolves.toMatchObject({ ok: false, reason: 'evidence_required' })
    const instructions = await ctx.broker.taskInstructions(ctx.donor.id, taskId)
    expect(instructions.briefFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(instructions.plan?.fallback).toContain('Release')

    const submitted = await ctx.workspaces.submit(ctx.donor.id, taskId, 'Fixed overnight hours', [{ criterion: 'python -m pytest exits 0', evidence: 'The CI run on the pull request is the check.' }])
    expect(submitted.ok).toBe(true)
    const record = ctx.opened[0]!.record!
    expect(record).toContain('Shifts that end after midnight must count forward')
    expect(record).toContain("**If it doesn't work:** Release the task")
    expect(record).toContain('All changes are inside the task.')
    expect(record).toContain('| python -m pytest exits 0 |')
    expect(record).toContain(instructions.briefFingerprint)
    expect(record).toContain('- [ ] **Fallback:**')
  })

  it('passes the reviewer feedback to the next attempt when a pull request is closed', async () => {
    const ctx = await setup()
    await ctx.broker.requestWork(ctx.donor.id, 1, 'small', false)
    const taskId = ((await ctx.broker.claimNext(ctx.donor.id)) as { taskId: string }).taskId
    await ctx.broker.submitPlan(ctx.donor.id, taskId, plan)
    await ctx.workspaces.writeFile(ctx.donor.id, taskId, 'pantry_shifts/shifts.py', fx('shifts.after.py'))
    await ctx.workspaces.submit(ctx.donor.id, taskId, 'Fixed', [{ criterion: 'tests', evidence: 'pass' }])
    await ctx.broker.pullRequestSignal({ taskId, repository: 'example/harbor-pantry', kind: 'changes_requested', detail: 'Please keep the old assertion text.', url: null })
    expect((await ctx.broker.pullRequestSignal({ taskId, repository: 'evil/other', kind: 'approved', detail: null, url: null })).ok).toBe(false)
    expect((await ctx.broker.pullRequestClosed({ taskId, merged: false, repository: 'example/harbor-pantry' })).ok).toBe(true)
    const task = await ctx.store.getTask(taskId)
    expect(task?.state).toBe('open')
    expect(task?.failureReason).toContain('Please keep the old assertion text.')
  })

  it('offers computer-only tasks to coding tools only', async () => {
    const ctx = await setup()
    await ctx.broker.requestWork(ctx.donor.id, 2, 'small', false)
    expect((await ctx.broker.listEligible(ctx.donor.id)).map((t) => t.localId)).toEqual(['fix-overnight-hours'])
    const kiosk = (await ctx.store.listAllTasks()).find((t) => t.localId === 'check-the-kiosk')!
    expect(await ctx.broker.claim(ctx.donor.id, kiosk.id)).toMatchObject({ ok: false, reason: 'needs_computer' })
    await ctx.broker.requestWork(ctx.donor.id, 2, 'small', true)
    expect((await ctx.broker.listEligible(ctx.donor.id)).map((t) => t.localId).sort()).toEqual(['check-the-kiosk', 'fix-overnight-hours'])
  })

  it('refuses coding-tool diffs outside the task and diffs with hidden or secret content', async () => {
    const ctx = await setup()
    await ctx.broker.requestWork(ctx.donor.id, 1, 'small', true)
    const taskId = ((await ctx.broker.claimNext(ctx.donor.id)) as { taskId: string }).taskId
    await ctx.broker.submitPlan(ctx.donor.id, taskId, plan)
    const evidence = [{ criterion: 'tests', evidence: 'pass' }]
    const outside = '--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-# A\n+# B\n'
    expect(await ctx.broker.submitResult(ctx.donor.id, taskId, { summary: 's', patch: outside, evidence })).toMatchObject({ ok: false, reason: 'out_of_scope' })
    const secret = '--- a/pantry_shifts/shifts.py\n+++ b/pantry_shifts/shifts.py\n@@ -1 +1,2 @@\n x\n+TOKEN = "ghp_' + 'a'.repeat(36) + '"\n'
    expect(await ctx.broker.submitResult(ctx.donor.id, taskId, { summary: 's', patch: secret, evidence })).toMatchObject({ ok: false, reason: 'warning_signs' })
  })
})

describe('warning-sign scan', () => {
  it('flags hidden text, secrets, command runners, network calls and install hooks in added lines only', () => {
    const patch = [
      '--- a/app.js', '+++ b/app.js', '@@ -1,3 +1,6 @@',
      '-eval(old)',
      '+const ok = 1 // ‮ hidden',
      '+require("child_process").exec("ls")',
      '+fetch("https://example.com/x")',
      '--- a/package.json', '+++ b/package.json', '@@ -1 +1,2 @@',
      '+  "postinstall": "node x.js",',
    ].join('\n')
    const found = scanPatch(patch)
    expect(found.find((w) => w.kind === 'hidden-text')?.blocking).toBe(true)
    expect(found.map((w) => w.kind)).toEqual(expect.arrayContaining(['runs-code', 'network', 'install-hook']))
    expect(found.find((w) => w.kind === 'install-hook')?.file).toBe('package.json')
    expect(scanPatch('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-eval(x)\n+const y = 2\n')).toEqual([])
  })
})

describe('handbook routines', () => {
  const evidence = [{ criterion: 'tests', evidence: 'pass' }]
  async function handIn(ctx: Awaited<ReturnType<typeof setup>>, donorId: string) {
    await ctx.broker.requestWork(donorId, 1, 'small', false)
    const claimed = await ctx.broker.claimNext(donorId)
    expect(claimed.ok).toBe(true)
    const taskId = (claimed as { taskId: string }).taskId
    await ctx.broker.submitPlan(donorId, taskId, plan)
    await ctx.workspaces.writeFile(donorId, taskId, 'pantry_shifts/shifts.py', fx('shifts.after.py'))
    await ctx.workspaces.submit(donorId, taskId, 'Fixed', evidence)
    return taskId
  }

  it('pauses a task handed back three times until its brief changes, and slows down a volunteer often turned down', async () => {
    const ctx = await setup()
    let taskId = ''
    for (let i = 0; i < 3; i++) {
      taskId = await handIn(ctx, ctx.donor.id)
      await ctx.broker.rejectSubmission(taskId, `Not right yet (${i})`)
    }
    expect((await ctx.store.getTask(taskId))?.pausedReason).toContain('Handed back 3 times')
    const other = await ctx.broker.registerMcpDonor({ name: 'bob', monthlyTasks: 5, acceptTerms: true })
    await ctx.broker.requestWork(other.id, 1, 'small', false)
    expect((await ctx.broker.listEligible(other.id)).map((t) => t.localId)).toEqual([])

    const standing = await ctx.broker.requestWork(ctx.donor.id, 2, 'small', false)
    expect(standing).toMatchObject({ ok: false, reason: 'small_tasks_only' })
  })

  it('stops new work for an organization with five changes waiting, and reminds reviewers after 7 days', async () => {
    let now = Date.parse('2026-11-01T10:00:00Z')
    const store = openSqliteStore(tempDbPath(), { maxAttempts: 3 })
    const many = manifest.replace(/tasks:\n/, `tasks:\n${[1, 2, 3, 4, 5, 6].map((n) => `  - id: note-${n}
    kind: writing
    title: Write note ${n}
    goal: Write a short note for the volunteers.
    size: small
    instructions: |
      Write docs/note-${n}.md (new file) with two friendly sentences.
      Keep it under 60 words.
    acceptance: docs/note-${n}.md exists and has two sentences.
    do: [docs/note-${n}.md (new file)]
    don't: [Do not change code.]
    deliverable: A unified diff adding docs/note-${n}.md.
    estimatedCostUsd: 0.02
`).join('')}`)
    const { broker } = setupBroker({ store, requirePlan: true, now: () => now, pullRequests: { open: async (i) => `https://github.com/example/harbor-pantry/pull/${i.localId.slice(-1)}` } })
    await broker.registerProject({ manifestPath: writeManifest(many) })
    const workspaces = new Workspaces({ store, broker, reader: async () => reader(), checks: null, now: () => now })
    for (let n = 1; n <= 5; n++) {
      const donor = await broker.registerMcpDonor({ name: `v${n}`, monthlyTasks: 5, acceptTerms: true })
      await broker.requestWork(donor.id, 1, 'small', false)
      const target = (await broker.listEligible(donor.id)).find((t) => t.localId === `note-${n}`)!
      expect((await broker.claim(donor.id, target.taskId)).ok).toBe(true)
      await broker.submitPlan(donor.id, target.taskId, { ...plan, files: [`docs/note-${n}.md`] })
      await workspaces.writeFile(donor.id, target.taskId, `docs/note-${n}.md`, 'Hello. Welcome.\n')
      expect((await workspaces.submit(donor.id, target.taskId, 'Note', evidence)).ok).toBe(true)
    }
    const late = await broker.registerMcpDonor({ name: 'late', monthlyTasks: 5, acceptTerms: true })
    await broker.requestWork(late.id, 1, 'small', false)
    expect(await broker.listEligible(late.id)).toEqual([])

    expect(await broker.reviewReminders()).toEqual([])
    now += 8 * 86_400_000
    const due = await broker.reviewReminders()
    expect(due).toHaveLength(5)
    expect(due[0]!.body).toContain('waited 7 days')
    for (const d of due) await broker.markReminderSent(d.taskId, d.days)
    expect(await broker.reviewReminders()).toEqual([])
    now += 14 * 86_400_000
    expect((await broker.reviewReminders())[0]!.body).toContain('waited 21 days')
  })
})
