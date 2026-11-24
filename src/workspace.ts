// Server-side workspaces. A volunteer's AI app never downloads the project:
// it reads files through the broker, edits only the files its task allows,
// asks the broker to run the project's checks, and submits. The broker builds
// the diff itself, so chat apps that cannot run git or tests can still help.

import { createHash, randomUUID } from 'node:crypto'

import { createTwoFilesPatch } from 'diff'

import type { Broker } from './broker.js'
import type { SqliteStore } from './sqlite-store.js'
import type { ProjectRecord, TaskRecord } from './types.js'

export type RepoReader = {
  headSha(): Promise<string>
  listFiles(sha: string): Promise<{ path: string; size: number }[]>
  readFile(sha: string, path: string): Promise<string | null>
  tarballUrl(sha: string): Promise<string>
}

export type CheckRunner = {
  start(input: {
    runId: string
    taskId: string
    tarballUrl: string
    files: { path: string; content: string | null }[]
    setup: string | null
    run: string
  }): Promise<void>
}

export class WorkspaceError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
  }
}

const MAX_FILE = 200_000
const MAX_CHANGED_FILES = 30

export function editablePaths(task: TaskRecord): string[] {
  return task.scopeDo
    .map((item) => item.split(/\s+\(/)[0]!.trim())
    .filter((path) => /[./]/.test(path) && !path.includes(' '))
}

export function isEditable(task: TaskRecord, path: string): boolean {
  if (path.startsWith('.github/') || path.startsWith('.git/') || path.includes('..') || path.startsWith('/')) return false
  return editablePaths(task).some((allowed) => (allowed.endsWith('/') ? path.startsWith(allowed) : path === allowed))
}

export class Workspaces {
  constructor(
    private readonly deps: {
      store: SqliteStore
      broker: Broker
      reader: (project: ProjectRecord) => Promise<RepoReader | null>
      checks: CheckRunner | null
      now?: () => number
    },
  ) {}

  private now() {
    return this.deps.now?.() ?? Date.now()
  }

  // The task must be held by this volunteer right now.
  private async held(donorId: string, taskId: string) {
    const task = await this.deps.store.getTask(taskId)
    if (!task) throw new WorkspaceError('No task with that id.', 'not_found')
    if (task.donorId !== donorId || (task.state !== 'claimed' && task.state !== 'running')) {
      throw new WorkspaceError('You are not holding this task. Claim it first with claim_next or claim_task.', 'not_holder')
    }
    const project = await this.deps.store.getProject(task.projectId)
    if (!project) throw new WorkspaceError('The project for this task is missing.', 'not_found')
    const reader = await this.deps.reader(project)
    if (!reader) {
      throw new WorkspaceError(
        "This project's repository isn't connected to the volunteer pool's GitHub App yet, so its files can't be read here. Use a coding tool, or try another task.",
        'repo_unavailable',
      )
    }
    let workspace = await this.deps.store.getWorkspace(taskId)
    if (!workspace || workspace.donor_id !== donorId) {
      await this.deps.store.openWorkspace(taskId, donorId, await reader.headSha(), this.now())
      workspace = await this.deps.store.getWorkspace(taskId)
    }
    return { task, project, reader, baseSha: workspace!.base_sha }
  }

  private async changes(taskId: string) {
    return new Map((await this.deps.store.listWorkspaceFiles(taskId)).map((f) => [f.path, f.content]))
  }

  async listFiles(donorId: string, taskId: string, prefix = '') {
    const { task, reader, baseSha } = await this.held(donorId, taskId)
    const changes = await this.changes(taskId)
    const paths = new Set((await reader.listFiles(baseSha)).map((f) => f.path))
    for (const [path, content] of changes) {
      if (content === null) paths.delete(path)
      else paths.add(path)
    }
    const listed = [...paths].filter((p) => p.startsWith(prefix)).sort()
    return {
      files: listed.slice(0, 400).map((path) => ({ path, editable: isEditable(task, path), changed: changes.has(path) })),
      truncated: listed.length > 400,
      editable: editablePaths(task),
    }
  }

  async readFile(donorId: string, taskId: string, path: string) {
    const { reader, baseSha } = await this.held(donorId, taskId)
    const changes = await this.changes(taskId)
    if (changes.has(path)) {
      const content = changes.get(path)
      if (content === null) throw new WorkspaceError(`${path} was deleted in your changes.`, 'not_found')
      return { path, content: content!, changed: true }
    }
    const content = await reader.readFile(baseSha, path)
    if (content === null) throw new WorkspaceError(`There is no file ${path}. Use list_files to see the project.`, 'not_found')
    if (content.length > MAX_FILE) throw new WorkspaceError(`${path} is too large to read here.`, 'too_large')
    return { path, content, changed: false }
  }

  async writeFile(donorId: string, taskId: string, path: string, content: string | null) {
    const { task } = await this.held(donorId, taskId)
    if (this.deps.broker.requirePlan) {
      const plan = await this.deps.broker.planFor(donorId, taskId)
      if (!plan) throw new WorkspaceError('First call submit_plan: what you understood, the files you will change, your steps and how you will check.', 'plan_required')
      if (!plan.files.some((allowed) => allowed === path || (allowed.endsWith('/') && path.startsWith(allowed)))) {
        throw new WorkspaceError(`${path} is not in your plan (${plan.files.join(', ')}). If you need it, call submit_plan again with the updated plan.`, 'not_in_plan')
      }
    }
    if (!isEditable(task, path)) {
      throw new WorkspaceError(
        `This task only allows changes to: ${editablePaths(task).join(', ') || 'no files'}. ${path} is out of scope.`,
        'out_of_scope',
      )
    }
    if (content !== null && content.length > MAX_FILE) throw new WorkspaceError('That file is too large.', 'too_large')
    const changes = await this.changes(taskId)
    if (!changes.has(path) && changes.size >= MAX_CHANGED_FILES) throw new WorkspaceError('Too many changed files for one task.', 'too_many')
    await this.deps.store.putWorkspaceFile(taskId, path, content, this.now())
    return { path, saved: true }
  }

  async editFile(donorId: string, taskId: string, path: string, oldText: string, newText: string) {
    const current = await this.readFile(donorId, taskId, path)
    const count = oldText ? current.content.split(oldText).length - 1 : 0
    if (count !== 1) {
      throw new WorkspaceError(
        count === 0 ? `The text to replace was not found in ${path}. Read the file again and copy it exactly.` : `The text to replace appears ${count} times in ${path}. Include more surrounding lines so it is unique.`,
        'edit_failed',
      )
    }
    return this.writeFile(donorId, taskId, path, current.content.replace(oldText, newText))
  }

  async diff(donorId: string, taskId: string) {
    const { reader, baseSha } = await this.held(donorId, taskId)
    const changes = await this.changes(taskId)
    const parts: string[] = []
    for (const [path, content] of changes) {
      const before = await reader.readFile(baseSha, path)
      if (before === content) continue
      const patch = createTwoFilesPatch(
        before === null ? '/dev/null' : `a/${path}`,
        content === null ? '/dev/null' : `b/${path}`,
        before ?? '',
        content ?? '',
        undefined,
        undefined,
        { context: 3 },
      )
      parts.push(`diff --git a/${path} b/${path}\n` + patch.split('\n').filter((line) => !line.startsWith('====')).join('\n'))
    }
    return parts.join('\n').replace(/\n+$/, '\n')
  }

  async workspaceHash(taskId: string) {
    const files = await this.deps.store.listWorkspaceFiles(taskId)
    return createHash('sha256').update(JSON.stringify(files)).digest('hex')
  }

  async runChecks(donorId: string, taskId: string) {
    const { task, project, reader, baseSha } = await this.held(donorId, taskId)
    if (task.kind === 'writing') return { status: 'not_needed' as const, message: 'This is a writing task. There are no automated checks: the organization reads the result.' }
    if (!project.checks) return { status: 'not_needed' as const, message: 'This project has no automated checks set up. Submit when the work meets the acceptance criteria.' }
    if (!this.deps.checks) {
      return { status: 'not_available' as const, message: "The server's test machines are switched off for now. Check your change carefully against the acceptance criteria; the project's own tests will run on the pull request." }
    }
    const latest = await this.deps.store.latestCheckRun(taskId)
    if (latest?.status === 'running' && this.now() - latest.created_at < 10 * 60 * 1000) {
      return { status: 'running' as const, runId: latest.id, message: 'Checks are already running. Call check_results in about 30 seconds.' }
    }
    const runId = randomUUID()
    await this.deps.store.insertCheckRun({ id: runId, taskId, donorId, workspaceHash: await this.workspaceHash(taskId), now: this.now() })
    await this.deps.checks.start({
      runId,
      taskId,
      tarballUrl: await reader.tarballUrl(baseSha),
      files: await this.deps.store.listWorkspaceFiles(taskId),
      setup: project.checks.setup ?? null,
      run: project.checks.run,
    })
    return { status: 'running' as const, runId, message: 'Checks started. The first run on a new task takes 1 to 2 minutes while the test machine is prepared. Call check_results to see the outcome.' }
  }

  async checkResults(donorId: string, taskId: string) {
    await this.held(donorId, taskId)
    const latest = await this.deps.store.latestCheckRun(taskId)
    if (!latest) return { status: 'none', message: 'No checks have run yet. Call run_checks.' }
    const stale = latest.workspace_hash !== (await this.workspaceHash(taskId))
    return {
      status: latest.status,
      exitCode: latest.exit_code,
      output: latest.output ?? '',
      stale,
      message:
        latest.status === 'running'
          ? 'Still running. Call check_results again in about 30 seconds.'
          : stale
            ? 'You changed files after this run. Run the checks again before submitting.'
            : latest.status === 'passed'
              ? 'All checks passed. You can submit_work.'
              : 'Checks failed. Read the output, fix the files, and run the checks again.',
    }
  }

  async submit(donorId: string, taskId: string, summary: string, evidence: unknown = []) {
    const { task, project } = await this.held(donorId, taskId)
    const patch = await this.diff(donorId, taskId)
    if (!patch.trim()) throw new WorkspaceError('There are no changes to submit yet.', 'no_changes')
    let checkStatus: string | null = null
    let checkOutput: string | null = null
    if (task.kind === 'code' && project.checks && this.deps.checks) {
      const latest = await this.deps.store.latestCheckRun(taskId)
      if (!latest || latest.status !== 'passed' || latest.workspace_hash !== (await this.workspaceHash(taskId))) {
        throw new WorkspaceError("The project's checks must pass on your latest changes before you submit. Call run_checks, then check_results.", 'checks_required')
      }
      checkStatus = 'passed'
      checkOutput = latest.output
    }
    const result = await this.deps.broker.submitResult(donorId, taskId, { summary, patch, evidence, checkStatus, checkOutput })
    if (result.ok) await this.deps.store.clearWorkspace(taskId)
    return result
  }
}
