import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseManifestYaml } from '../src/manifest.js'
import { openSqliteStore } from '../src/open-sqlite.js'
import { Workspaces, type CheckRunner, type RepoReader } from '../src/workspace.js'
import { repoRoot, setupBroker, tempDbPath, writeManifest } from './helpers.js'

const fx = (name: string) => readFileSync(path.join(repoRoot, 'fixtures/github', name), 'utf8')

const manifest = (extra = '') => `schemaVersion: 1
project:
  name: harbor-pantry
  nonprofit: true
  github: https://github.com/example/harbor-pantry
  checks:
    setup: python -m pip install -e ".[dev]"
    run: python -m pytest -q
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
  - id: write-welcome
    kind: writing
    title: Write a welcome note
    goal: Welcome new pantry volunteers.
    size: small
    instructions: |
      Write docs/welcome.md (new file) for first-day volunteers.
      Explain where to check in and how the 15-minute shift grid works.
    acceptance: Under 300 words, friendly, mentions the 15-minute shift grid.
    do: [docs/welcome.md (new file)]
    don't: [Do not change code.]
    deliverable: The new Markdown file, submitted with a one-line summary.
    estimatedCostUsd: 0.02
${extra}`

function reader(): RepoReader {
  const files: Record<string, string> = {
    'pantry_shifts/shifts.py': fx('shifts.before.py'),
    'tests/test_shifts.py': fx('test_shifts.before.py'),
    'README.md': '# Harbor Pantry\n',
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
  const { broker } = setupBroker({ store })
  await broker.registerProject({ manifestPath: writeManifest(manifest()) })
  const started: Parameters<CheckRunner['start']>[0][] = []
  const workspaces = new Workspaces({
    store,
    broker,
    reader: async () => reader(),
    checks: { start: async (job) => { started.push(job) } },
  })
  const donor = await broker.registerMcpDonor({ name: 'ada', monthlyTasks: 5, acceptTerms: true })
  return { store, broker, workspaces, donor, started }
}

async function claim(ctx: Awaited<ReturnType<typeof setup>>, localId: string) {
  expect((await ctx.broker.requestWork(ctx.donor.id, 2, 'small')).ok).toBe(true)
  const eligible = await ctx.broker.listEligible(ctx.donor.id)
  const target = eligible.find((t) => t.localId === localId)
  expect(target, `eligible ${localId}`).toBeTruthy()
  const claimed = await ctx.broker.claim(ctx.donor.id, target!.taskId)
  expect(claimed.ok).toBe(true)
  return target!.taskId
}

describe('working through the server', () => {
  it('reads, edits within scope, runs checks, and submits a diff that applies', async () => {
    const ctx = await setup()
    const taskId = await claim(ctx, 'fix-overnight-hours')
    const listed = await ctx.workspaces.listFiles(ctx.donor.id, taskId)
    expect(listed.files.find((f) => f.path === 'pantry_shifts/shifts.py')?.editable).toBe(true)
    expect(listed.files.find((f) => f.path === 'README.md')?.editable).toBe(false)

    await expect(ctx.workspaces.writeFile(ctx.donor.id, taskId, 'README.md', 'x')).rejects.toThrow(/out of scope/)
    await expect(ctx.workspaces.writeFile(ctx.donor.id, taskId, '.github/workflows/x.yml', 'x')).rejects.toThrow(/out of scope/)

    await ctx.workspaces.writeFile(ctx.donor.id, taskId, 'pantry_shifts/shifts.py', fx('shifts.after.py'))
    await ctx.workspaces.editFile(ctx.donor.id, taskId, 'tests/test_shifts.py', 'from datetime import time\n\nimport pytest\n', 'from datetime import time\n')
    await expect(ctx.workspaces.editFile(ctx.donor.id, taskId, 'tests/test_shifts.py', 'no such text', 'y')).rejects.toThrow(/not found/)
    expect((await ctx.workspaces.readFile(ctx.donor.id, taskId, 'pantry_shifts/shifts.py')).changed).toBe(true)

    const diff = await ctx.workspaces.diff(ctx.donor.id, taskId)
    expect(diff).toContain('--- a/pantry_shifts/shifts.py')
    expect(diff).toContain('+    delta = end_minutes - start_minutes')

    await expect(ctx.workspaces.submit(ctx.donor.id, taskId, 'done')).rejects.toThrow(/checks must pass/)

    const run = await ctx.workspaces.runChecks(ctx.donor.id, taskId)
    expect(run.status).toBe('running')
    expect(ctx.started[0]!.files.map((f) => f.path).sort()).toEqual(['pantry_shifts/shifts.py', 'tests/test_shifts.py'])
    expect(ctx.started[0]!.run).toBe('python -m pytest -q')
    await ctx.store.finishCheckRun(ctx.started[0]!.runId, 'passed', 0, '13 passed', Date.now())
    expect((await ctx.workspaces.checkResults(ctx.donor.id, taskId)).status).toBe('passed')

    const submitted = await ctx.workspaces.submit(ctx.donor.id, taskId, 'Fixed overnight hours; 13 passed')
    expect(submitted.ok).toBe(true)
    const task = await ctx.store.getTask(taskId)
    expect(task?.state).toBe('review')
    expect(task?.submissionPatch).toContain('+    delta = end_minutes - start_minutes')
    expect(await ctx.store.listWorkspaceFiles(taskId)).toEqual([])
  })

  it('makes a stale check run count for nothing', async () => {
    const ctx = await setup()
    const taskId = await claim(ctx, 'fix-overnight-hours')
    await ctx.workspaces.writeFile(ctx.donor.id, taskId, 'pantry_shifts/shifts.py', fx('shifts.after.py'))
    await ctx.workspaces.runChecks(ctx.donor.id, taskId)
    await ctx.store.finishCheckRun(ctx.started[0]!.runId, 'passed', 0, 'ok', Date.now())
    await ctx.workspaces.writeFile(ctx.donor.id, taskId, 'tests/test_shifts.py', fx('test_shifts.after.py'))
    expect((await ctx.workspaces.checkResults(ctx.donor.id, taskId)).stale).toBe(true)
    await expect(ctx.workspaces.submit(ctx.donor.id, taskId, 'done')).rejects.toThrow(/checks must pass/)
  })

  it('lets writing tasks create their file and submit without checks', async () => {
    const ctx = await setup()
    const taskId = await claim(ctx, 'write-welcome')
    expect((await ctx.workspaces.runChecks(ctx.donor.id, taskId)).status).toBe('not_needed')
    await ctx.workspaces.writeFile(ctx.donor.id, taskId, 'docs/welcome.md', '# Welcome\n\nShifts start on a 15-minute grid.\n')
    const diff = await ctx.workspaces.diff(ctx.donor.id, taskId)
    expect(diff).toContain('--- /dev/null')
    expect(diff).toContain('+++ b/docs/welcome.md')
    expect((await ctx.workspaces.submit(ctx.donor.id, taskId, 'Welcome note, 12 words')).ok).toBe(true)
  })

  it('refuses a volunteer who does not hold the task', async () => {
    const ctx = await setup()
    const taskId = await claim(ctx, 'fix-overnight-hours')
    const other = await ctx.broker.registerMcpDonor({ name: 'bea', monthlyTasks: 5, acceptTerms: true })
    await expect(ctx.workspaces.readFile(other.id, taskId, 'README.md')).rejects.toThrow(/not holding/)
  })
})

describe('task list sync and monthly limits', () => {
  it('adds new tasks and updates open briefs without touching claimed work', async () => {
    const ctx = await setup()
    const taskId = await claim(ctx, 'fix-overnight-hours')
    const next = manifest(`  - id: translate-guide
    kind: writing
    title: Translate the guide
    goal: Hebrew version of the welcome note.
    size: small
    instructions: |
      Translate docs/welcome.md into Hebrew as docs/he/welcome.md (new file).
      Keep the headings and the meaning; write natural, friendly Hebrew.
    acceptance: Same meaning, natural Hebrew.
    do: [docs/he/welcome.md (new file)]
    don't: [Do not change code.]
    deliverable: The new Markdown file, submitted with a one-line summary.
    estimatedCostUsd: 0.02
`).replace('Welcome new pantry volunteers.', 'Welcome new pantry volunteers warmly.').replace('Make shift_hours count', 'CHANGED Make shift_hours count')
    const result = await ctx.broker.syncManifest({ manifest: parseManifestYaml(next), agentsMd: '# Rules' })
    expect(result.added).toEqual(['translate-guide'])
    expect(result.updated).toBe(1)
    expect((await ctx.store.getTask(taskId))?.goal).not.toContain('CHANGED')
    const tasks = await ctx.store.listTasks((await ctx.store.getTask(taskId))!.projectId)
    expect(tasks.find((t) => t.localId === 'write-welcome')?.goal).toContain('warmly')
    expect(tasks.find((t) => t.localId === 'translate-guide')?.kind).toBe('writing')
  })

  it('lets a volunteer change or pause their monthly limit', async () => {
    const ctx = await setup()
    expect((await ctx.broker.setMonthlyLimit(ctx.donor.id, 3)).ok).toBe(true)
    expect((await ctx.store.getDonor(ctx.donor.id))?.monthlyTaskBudget).toBe(3)
    const paused = await ctx.broker.setMonthlyLimit(ctx.donor.id, 0)
    expect(paused.ok && paused.message).toContain('paused')
    expect((await ctx.broker.setMonthlyLimit(ctx.donor.id, 99)).ok).toBe(false)
  })
})
