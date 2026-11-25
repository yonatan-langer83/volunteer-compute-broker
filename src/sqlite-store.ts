import { SCHEMA } from './schema.js'
import type { Sql } from './sql.js'

import { budgetPeriod, explainTaskFit } from './budget.js'
import type { TaskSize } from './task-size.js'
import { isTaskSize } from './task-size.js'
import { checkEligibility } from './eligibility.js'
import { transition, type TaskSnapshot, type TransitionResult } from './state-machine.js'
import type { DonorRecord, ProjectRecord, ProviderId, TaskRecord, TaskState } from './types.js'
import { isProviderId } from './types.js'

type TaskRow = {
  kind?: string | null
  needs_computer?: number | null
  paused_reason?: string | null
  revision_pr?: string | null
  revision_donor?: string | null
  revision_until?: number | null
  revision_feedback?: string | null
  issue_number?: number | null
  id: string
  project_id: string
  local_id: string
  title: string
  goal: string
  instructions: string
  acceptance: string
  tests: string
  scope_do: string
  scope_dont: string
  deliverable: string
  size: string
  provider_override: string | null
  estimated_cost_usd: number
  state: TaskState
  donor_id: string | null
  lease_until: number | null
  attempts: number
  result: string | null
  failure_reason: string | null
  reserved_cost_usd: number
  budget_period: string | null
  submission_summary: string | null
  submission_url: string | null
  submission_patch: string | null
  safety_status: string
  safety_flags: string
  created_at: number
  updated_at: number
}

type DonorRow = {
  id: string
  name: string
  kind: 'key' | 'mcp'
  provider: string | null
  spending_cap_usd: number
  spent_usd: number
  reserved_usd: number
  monthly_task_budget: number | null
  spent_tasks: number
  reserved_tasks: number
  budget_period: string
  terms_accepted_at: number
  key_validated_at: number
  created_at: number
  handle: string
}

type ProjectRow = {
  checks_json?: string | null
  cause?: string | null
  summary?: string | null
  preview_url?: string | null
  volunteer_reviewers?: number | null
  id: string
  name: string
  github: string | null
  org_url: string | null
  nonprofit: number
  repo_path: string
  agents_md: string | null
  registered_at: number
}

export type ProjectInsert = {
  checks?: { setup?: string; run: string } | null
  cause?: string | null
  summary?: string | null
  previewUrl?: string | null
  volunteerReviewers?: boolean
  id: string
  name: string
  github: string | null
  orgUrl: string | null
  nonprofit: boolean
  repoPath: string
  agentsMd: string | null
  registeredAt: number
}

export type TaskInsert = {
  kind?: 'code' | 'writing'
  needsComputer?: boolean
  issueNumber?: number | null
  id: string
  projectId: string
  localId: string
  title: string
  goal: string
  instructions: string
  acceptance: string
  tests: string
  scopeDo: string[]
  scopeDont: string[]
  deliverable: string
  size: TaskSize
  providerOverride: ProviderId | null
  estimatedCostUsd: number
  safetyStatus: 'clear' | 'flagged' | 'approved'
  safetyFlags: string[]
  state: TaskState
  createdAt: number
  dependsOn: string[]
}

export type DonorInsert = {
  id: string
  name: string
  kind: 'key' | 'mcp'
  provider: ProviderId | null
  spendingCapUsd: number
  spentUsd: number
  reservedUsd: number
  monthlyTaskBudget: number | null
  termsAcceptedAt: number
  keyValidatedAt: number
  createdAt: number
  envelopeJson: string | null
  handle: string
}

export type ClaimArgs = {
  donorId: string
  taskId: string
  now: number
  leaseUntil: number
}

const TASK_COLUMNS = `
  id, project_id, local_id, title, goal, instructions, acceptance, tests,
  scope_do, scope_dont, deliverable, size, provider_override,
  estimated_cost_usd, state, donor_id, lease_until, attempts, result,
  failure_reason, reserved_cost_usd, budget_period, submission_summary,
  submission_url, submission_patch, safety_status, safety_flags, created_at, updated_at, kind, needs_computer, paused_reason, revision_pr, revision_donor, revision_until, revision_feedback, issue_number
`

const DONOR_COLUMNS = `
  id, name, kind, provider, spending_cap_usd, spent_usd, reserved_usd,
  monthly_task_budget, spent_tasks, reserved_tasks, budget_period,
  terms_accepted_at, key_validated_at, created_at, handle
`

const PROJECT_COLUMNS = `id, name, github, org_url, nonprofit, repo_path, agents_md, registered_at, checks_json, cause, summary, preview_url, volunteer_reviewers`

export type OnboardingApplication = {
  id: string; created_at: number; org_name: string; website: string | null; contact_name: string; email: string; country: string | null
  status_kind: string; github: string; repo_url: string | null; needs: string; state: string; onboarder_account_id: string | null; onboarder_note: string | null; listing_url: string | null
}

export type AccountRow = { id: string; github_id: string | null; github_login: string | null; email: string | null }

export class SqliteStore {
  private readonly sql: Sql
  private readonly maxAttempts: number
  private closed = false
  private readonly ready: Promise<void>

  constructor(sql: Sql, options?: { maxAttempts?: number }) {
    this.sql = sql
    this.maxAttempts = options?.maxAttempts ?? 3
    this.ready = this.sql.exec(SCHEMA)
  }

  async close() {
    if (this.closed) return
    this.closed = true
    await this.ready
    await this.sql.close()
  }

  async insertProject(project: ProjectInsert, tasks: TaskInsert[]) {
    await this.transaction(async () => {
      await this.sql.run(
          `INSERT INTO projects (id, name, github, org_url, nonprofit, repo_path, agents_md, registered_at, checks_json, cause, summary, preview_url, volunteer_reviewers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [project.id, project.name, project.github, project.orgUrl, project.nonprofit ? 1 : 0, project.repoPath, project.agentsMd, project.registeredAt, project.checks ? JSON.stringify(project.checks) : null, project.cause ?? null, project.summary ?? null, project.previewUrl ?? null, project.volunteerReviewers ? 1 : 0])
      for (const task of tasks) await this.insertTaskRow(task)
      for (const task of tasks) {
        for (const dependency of task.dependsOn) {
          await this.sql.run(`INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)`, [task.id, dependency])
        }
      }
    })
  }

  private async insertTaskRow(task: TaskInsert) {
    await this.sql.run(
      `INSERT INTO tasks (
        id, project_id, local_id, title, goal, instructions, acceptance, tests,
        scope_do, scope_dont, deliverable, size, provider_override,
        estimated_cost_usd, state, donor_id, lease_until, attempts, result,
        failure_reason, reserved_cost_usd, safety_status, safety_flags, created_at, updated_at, kind, needs_computer, issue_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [task.id, task.projectId, task.localId, task.title, task.goal, task.instructions, task.acceptance, task.tests,
        JSON.stringify(task.scopeDo), JSON.stringify(task.scopeDont), task.deliverable, task.size, task.providerOverride,
        task.estimatedCostUsd, task.state, task.safetyStatus, JSON.stringify(task.safetyFlags), task.createdAt, task.createdAt,
        task.kind ?? 'code', task.needsComputer ? 1 : 0, task.issueNumber ?? null],
    )
  }

  // ---------- sync from the repository's task list ----------

  async updateProjectFromManifest(projectId: string, fields: {
    github: string | null; orgUrl: string | null; nonprofit: boolean; agentsMd: string | null; checks: { setup?: string; run: string } | null
    cause?: string | null; summary?: string | null; previewUrl?: string | null; volunteerReviewers?: boolean
  }) {
    await this.ready
    await this.sql.run(
      `UPDATE projects SET github = ?, org_url = ?, nonprofit = ?, agents_md = ?, checks_json = ?, cause = ?, summary = ?, preview_url = ?, volunteer_reviewers = ? WHERE id = ?`,
      [fields.github, fields.orgUrl, fields.nonprofit ? 1 : 0, fields.agentsMd, fields.checks ? JSON.stringify(fields.checks) : null, fields.cause ?? null, fields.summary ?? null, fields.previewUrl ?? null, fields.volunteerReviewers ? 1 : 0, projectId],
    )
  }

  async addTasks(tasks: TaskInsert[]) {
    await this.ready
    await this.transaction(async () => {
      for (const task of tasks) await this.insertTaskRow(task)
      for (const task of tasks) {
        for (const dependency of task.dependsOn) {
          await this.sql.run(`INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)`, [task.id, dependency])
        }
      }
    })
  }

  // Rewrites the brief of a task nobody is working on. Returns false if the
  // task was claimed meanwhile.
  async updateOpenTaskBrief(task: TaskInsert): Promise<boolean> {
    await this.ready
    const changed = await this.sql.run(
      `UPDATE tasks SET title = ?, goal = ?, instructions = ?, acceptance = ?, tests = ?, scope_do = ?, scope_dont = ?,
         deliverable = ?, size = ?, estimated_cost_usd = ?, safety_status = ?, safety_flags = ?, kind = ?, needs_computer = ?, paused_reason = NULL
       WHERE id = ? AND state IN ('open', 'blocked')`,
      [task.title, task.goal, task.instructions, task.acceptance, task.tests, JSON.stringify(task.scopeDo), JSON.stringify(task.scopeDont),
        task.deliverable, task.size, task.estimatedCostUsd, task.safetyStatus, JSON.stringify(task.safetyFlags), task.kind ?? 'code', task.needsComputer ? 1 : 0, task.id],
    )
    return changed === 1
  }

  // ---------- server-side workspaces ----------

  async getWorkspace(taskId: string) {
    await this.ready
    return await this.sql.get(`SELECT task_id, donor_id, base_sha, created_at FROM workspaces WHERE task_id = ?`, [taskId]) as
      { task_id: string; donor_id: string; base_sha: string; created_at: number } | undefined
  }

  async openWorkspace(taskId: string, donorId: string, baseSha: string, now: number) {
    await this.ready
    await this.sql.run(`DELETE FROM workspace_files WHERE task_id = ?`, [taskId])
    await this.sql.run(
      `INSERT INTO workspaces (task_id, donor_id, base_sha, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET donor_id = excluded.donor_id, base_sha = excluded.base_sha, created_at = excluded.created_at`,
      [taskId, donorId, baseSha, now],
    )
  }

  async clearWorkspace(taskId: string) {
    await this.ready
    await this.sql.run(`DELETE FROM workspace_files WHERE task_id = ?`, [taskId])
    await this.sql.run(`DELETE FROM workspaces WHERE task_id = ?`, [taskId])
  }

  async putWorkspaceFile(taskId: string, path: string, content: string | null, now: number) {
    await this.ready
    await this.sql.run(
      `INSERT INTO workspace_files (task_id, path, content, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(task_id, path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
      [taskId, path, content, now],
    )
  }

  async listWorkspaceFiles(taskId: string) {
    await this.ready
    return await this.sql.all(`SELECT path, content FROM workspace_files WHERE task_id = ? ORDER BY path`, [taskId]) as
      { path: string; content: string | null }[]
  }

  async insertCheckRun(row: { id: string; taskId: string; donorId: string; workspaceHash: string; now: number }) {
    await this.ready
    await this.sql.run(
      `INSERT INTO check_runs (id, task_id, donor_id, workspace_hash, status, created_at) VALUES (?, ?, ?, ?, 'running', ?)`,
      [row.id, row.taskId, row.donorId, row.workspaceHash, row.now],
    )
  }

  async finishCheckRun(id: string, status: 'passed' | 'failed' | 'error', exitCode: number | null, output: string, now: number) {
    await this.ready
    await this.sql.run(
      `UPDATE check_runs SET status = ?, exit_code = ?, output = ?, finished_at = ? WHERE id = ? AND status = 'running'`,
      [status, exitCode, output, now, id],
    )
  }

  async latestCheckRun(taskId: string) {
    await this.ready
    return await this.sql.get(
      `SELECT id, task_id, donor_id, workspace_hash, status, exit_code, output, created_at, finished_at FROM check_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`,
      [taskId],
    ) as { id: string; task_id: string; donor_id: string; workspace_hash: string; status: string; exit_code: number | null; output: string | null; created_at: number; finished_at: number | null } | undefined
  }

  async getProject(id: string) {
    const row = await this.sql.get(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`, [id]) as ProjectRow | undefined
    return row ? projectFromRow(row) : null
  }

  async getProjectByName(name: string) {
    const row = await this.sql.get(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE name = ?`, [name]) as ProjectRow | undefined
    return row ? projectFromRow(row) : null
  }

  async listProjects() {
    const rows = await this.sql.all(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY registered_at, name`, []) as unknown as ProjectRow[]
    return rows.map(projectFromRow)
  }

  async listOpenTasks() {
    const rows = await this.sql.all(`SELECT ${TASK_COLUMNS} FROM tasks WHERE state = 'open' AND safety_status != 'flagged' AND paused_reason IS NULL ORDER BY created_at, id`, []) as unknown as TaskRow[]
    return rows.map(taskFromRow)
  }

  async getTask(id: string) {
    const row = await this.taskRow(id)
    return row ? taskFromRow(row) : null
  }

  async listAllTasks() {
    await this.ready
    const rows = await this.sql.all(`SELECT ${TASK_COLUMNS} FROM tasks ORDER BY created_at, local_id`, []) as unknown as TaskRow[]
    return rows.map(taskFromRow)
  }

  async listTasks(projectId: string) {
    const rows = await this.sql.all(`SELECT ${TASK_COLUMNS} FROM tasks WHERE project_id = ? ORDER BY created_at, local_id`, [projectId]) as unknown as TaskRow[]
    return rows.map(taskFromRow)
  }

  async listDonors(now?: number) {
    if (now != null) await this.rollBudgets(now)
    const rows = await this.sql.all(`SELECT ${DONOR_COLUMNS} FROM donors ORDER BY created_at, name`, []) as unknown as DonorRow[]
    return rows.map(donorFromRow)
  }

  async rollBudgets(now: number) {
    await this.transaction(async () => {
      await this.rollLocked(now)
    })
  }

  async supportNames(donorId: string) {
    const rows = await this.sql.all(`SELECT project_name FROM donor_support WHERE donor_id = ? ORDER BY project_name`, [donorId]) as unknown as { project_name: string }[]
    return rows.map((row) => row.project_name)
  }

  async replaceSupport(donorId: string, projectNames: string[]) {
    await this.transaction(async () => {
      await this.sql.run(`DELETE FROM donor_support WHERE donor_id = ?`, [donorId])
      for (const name of projectNames) {
        await this.sql.run(`INSERT INTO donor_support (donor_id, project_name) VALUES (?, ?)`, [donorId, name])
      }
    })
  }

  async getDonor(id: string) {
    const row = await this.donorRow(id)
    return row ? donorFromRow(row) : null
  }

  async insertDonor(donor: DonorInsert) {
    await this.transaction(async () => {
      const period = budgetPeriod(donor.createdAt)
      await this.sql.run(
          `INSERT INTO donors (
            id, name, kind, provider, spending_cap_usd, spent_usd, reserved_usd,
            monthly_task_budget, spent_tasks, reserved_tasks, budget_period,
            terms_accepted_at, key_validated_at, created_at, handle
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`, [donor.id,
          donor.name,
          donor.kind,
          donor.provider,
          donor.spendingCapUsd,
          donor.spentUsd,
          donor.reservedUsd,
          donor.monthlyTaskBudget,
          period,
          donor.termsAcceptedAt,
          donor.keyValidatedAt,
          donor.createdAt,
          donor.handle,])
      await this.upsertPeriod(donor.id, period, donor.spentUsd, donor.reservedUsd, 0, 0)
      if (donor.envelopeJson) {
        await this.sql.run(`INSERT INTO secrets (donor_id, envelope_json, created_at) VALUES (?, ?, ?)`, [donor.id, donor.envelopeJson, donor.createdAt])
      }
    })
  }

  async getEnvelopeJson(donorId: string) {
    const row = await this.sql.get(`SELECT envelope_json FROM secrets WHERE donor_id = ?`, [donorId]) as
      | { envelope_json: string }
      | undefined
    return row?.envelope_json ?? null
  }

  async listOpenForDonor(provider: ProviderId | null, now: number) {
    return this.transaction(async () => {
      await this.expireLocked(now)
      await this.promoteReadyLocked(now)
      const sql =
        provider == null
          ? `SELECT ${TASK_COLUMNS} FROM tasks WHERE state = 'open' AND safety_status != 'flagged' AND paused_reason IS NULL ORDER BY created_at, id`
          : `SELECT ${TASK_COLUMNS} FROM tasks WHERE state = 'open' AND safety_status != 'flagged' AND paused_reason IS NULL AND (provider_override IS NULL OR provider_override = ?) ORDER BY created_at, id`
      const rows = (provider == null ? await this.sql.all(sql, []) : await this.sql.all(sql, [provider])) as unknown as TaskRow[]
      return rows.map(taskFromRow)
    })
  }

  async claim(args: ClaimArgs): Promise<{ ok: true; leaseUntil: number } | { ok: false; reason: string }> {
    return this.transaction(async () => {
      await this.rollLocked(args.now)
      await this.expireLocked(args.now)
      await this.promoteReadyLocked(args.now)
      const task = await this.taskRow(args.taskId)
      if (!task) return { ok: false, reason: 'not_found' }
      if (task.safety_status === 'flagged') return { ok: false, reason: 'safety_review' }
      const donor = await this.donorRow(args.donorId)
      if (!donor) return { ok: false, reason: 'donor_not_found' }
      if (!await this.dependenciesDoneLocked(task.id)) {
        if (task.state === 'open') {
          const repaired = transition(toSnapshot(task), { type: 'dependencies_unmet' }, { maxAttempts: this.maxAttempts })
          if (repaired.ok) await this.writeTaskLocked(task, repaired, args.now)
        }
        return { ok: false, reason: 'blocked' }
      }
      const donorView = donorFromRow(donor)
      const fit = explainTaskFit({
        supportedNames: await this.supportNames(donor.id),
        projectName: await this.projectName(task.project_id),
        providerOverride: task.provider_override,
        estimatedCostUsd: Number(task.estimated_cost_usd),
        donor: donorView,
      })
      if (fit) return { ok: false, reason: fit }
      const gate = checkEligibility({
        purpose: 'claim',
        termsAcceptedAt: donor.terms_accepted_at,
        spendingCapUsd: donor.kind === 'mcp' ? 1 : donor.spending_cap_usd,
        spentUsd: donor.spent_usd,
        reservedUsd: donor.reserved_usd,
        provider: donor.provider,
        providerKeyChecked: true,
        keyValid: donor.kind === 'mcp' ? true : donor.key_validated_at > 0,
        taskCostUsd: task.estimated_cost_usd,
        budgetKind: donor.kind === 'mcp' ? 'tasks' : 'usd',
        monthlyTaskBudget: donor.monthly_task_budget,
        spentTasks: Number(donor.spent_tasks),
        reservedTasks: Number(donor.reserved_tasks),
      })
      if (!gate.ok) return { ok: false, reason: gate.reasons.join(',') }
      const next = transition(
        toSnapshot(task),
        {
          type: 'claim',
          donorId: donor.id,
          leaseUntil: args.leaseUntil,
          reservedCostUsd: task.estimated_cost_usd,
        },
        { maxAttempts: this.maxAttempts },
      )
      if (!next.ok) return { ok: false, reason: next.error }
      if (!await this.writeTaskLocked(task, next, args.now)) return { ok: false, reason: 'conflict' }
      return { ok: true, leaseUntil: args.leaseUntil }
    })
  }

  async markRunning(taskId: string, donorId: string, leaseUntil: number, now: number) {
    return this.transaction(async () => {
      await this.expireLocked(now)
      const task = await this.taskRow(taskId)
      if (!task) return false
      const next = transition(
        toSnapshot(task),
        { type: 'start', donorId, leaseUntil },
        { maxAttempts: this.maxAttempts },
      )
      if (!next.ok) return false
      return await this.writeTaskLocked(task, next, now)
    })
  }

  async finish(
    taskId: string,
    donorId: string,
    outcome:
      | { type: 'succeed'; result: string }
      | { type: 'fail'; reason: string; result: string | null },
    now: number,
  ) {
    return this.transaction(async () => {
      await this.rollLocked(now)
      const task = await this.taskRow(taskId)
      if (!task) return false
      const event =
        outcome.type === 'succeed'
          ? { type: 'succeed' as const, donorId, result: outcome.result }
          : { type: 'fail' as const, donorId, reason: outcome.reason, result: outcome.result }
      const next = transition(toSnapshot(task), event, { maxAttempts: this.maxAttempts })
      if (!next.ok) return false
      if (!await this.writeTaskLocked(task, next, now)) return false
      if (outcome.type === 'succeed') await this.promoteReadyLocked(now)
      return true
    })
  }

  async release(taskId: string, donorId: string, now: number, reason?: string) {
    return this.transaction(async () => {
      await this.rollLocked(now)
      const task = await this.taskRow(taskId)
      if (!task) return { ok: false, reason: 'not_found' }
      const next = transition(toSnapshot(task), { type: 'release', donorId, ...(reason ? { reason } : {}) }, { maxAttempts: this.maxAttempts })
      if (!next.ok) return { ok: false, reason: next.error }
      if (!await this.writeTaskLocked(task, next, now)) return { ok: false, reason: 'conflict' }
      return { ok: true }
    })
  }

  async retry(taskId: string, now: number) {
    return this.transaction(async () => {
      const task = await this.taskRow(taskId)
      if (!task) return { ok: false, reason: 'not_found' }
      const next = transition(
        toSnapshot(task),
        { type: 'retry', depsDone: await this.dependenciesDoneLocked(task.id) },
        { maxAttempts: this.maxAttempts },
      )
      if (!next.ok) return { ok: false, reason: next.error }
      if (!await this.writeTaskLocked(task, next, now)) return { ok: false, reason: 'conflict' }
      return { ok: true, state: next.task.state }
    })
  }

  async extendLease(taskId: string, donorId: string, leaseUntil: number, now: number): Promise<boolean> {
    const changed = await this.sql.run(
      `UPDATE tasks SET lease_until = ? WHERE id = ? AND donor_id = ? AND state IN ('claimed', 'running') AND lease_until IS NOT NULL AND lease_until > ?`,
      [leaseUntil, taskId, donorId, now],
    )
    return changed === 1
  }

  async expireLeases(now: number) {
    return this.transaction(async () => {
      await this.rollLocked(now)
      return await this.expireLocked(now)
    })
  }

  private async rollLocked(now: number) {
    const period = budgetPeriod(now)
    const rows = await this.sql.all(`SELECT id, budget_period, spent_usd, reserved_usd, spent_tasks, reserved_tasks FROM donors`, []) as unknown as {
      id: string
      budget_period: string
      spent_usd: number
      reserved_usd: number
      spent_tasks: number
      reserved_tasks: number
    }[]
    for (const row of rows) {
      if (row.budget_period === period) continue
      await this.upsertPeriod(row.id, row.budget_period, Number(row.spent_usd), Number(row.reserved_usd), Number(row.spent_tasks), Number(row.reserved_tasks))
      await this.sql.run(
          `UPDATE donors SET spent_usd = 0, reserved_usd = 0, spent_tasks = 0, reserved_tasks = 0, budget_period = ? WHERE id = ?`, [period, row.id])
      await this.upsertPeriod(row.id, period, 0, 0, 0, 0)
    }
  }

  private async expireLocked(now: number) {
    const rows = await this.sql.all(
        `SELECT ${TASK_COLUMNS} FROM tasks
         WHERE state IN ('claimed', 'running') AND lease_until IS NOT NULL AND lease_until <= ?`, [now]) as unknown as TaskRow[]
    const released: string[] = []
    for (const row of rows) {
      const next = transition(toSnapshot(row), { type: 'lease_expired', now }, { maxAttempts: this.maxAttempts })
      if (!next.ok) continue
      if (await this.writeTaskLocked(row, next, now)) released.push(row.id)
    }
    return released
  }

  private async promoteReadyLocked(now: number) {
    const rows = await this.sql.all(`SELECT ${TASK_COLUMNS} FROM tasks WHERE state = 'blocked' ORDER BY created_at, id`, []) as unknown as TaskRow[]
    for (const row of rows) {
      if (!await this.dependenciesDoneLocked(row.id)) continue
      const next = transition(toSnapshot(row), { type: 'dependencies_met' }, { maxAttempts: this.maxAttempts })
      if (!next.ok) continue
      await this.writeTaskLocked(row, next, now)
    }
  }

  private async dependenciesDoneLocked(taskId: string) {
    const row = await this.sql.get(
        `SELECT COUNT(*) AS pending FROM task_dependencies d
         JOIN tasks dep ON dep.id = d.depends_on_id
         WHERE d.task_id = ? AND dep.state != 'done'`, [taskId]) as { pending: number } | undefined
    return Number(row?.pending ?? 0) === 0
  }

  private async writeTaskLocked(current: TaskRow, next: Extract<TransitionResult, { ok: true }>, now: number) {
    const info = await this.sql.run(
        `UPDATE tasks SET
          state = ?, donor_id = ?, lease_until = ?, attempts = ?, result = ?,
          failure_reason = ?, reserved_cost_usd = ?, updated_at = ?
         WHERE id = ? AND state = ?`, [next.task.state,
        next.task.donorId,
        next.task.leaseUntil,
        next.task.attempts,
        next.task.result,
        next.task.failureReason,
        next.task.reservedCostUsd,
        now,
        current.id,
        current.state,])
    if (info !== 1) return false
    const period = next.reservation.type === 'hold' ? budgetPeriod(now) : (current.budget_period ?? budgetPeriod(now))
    if (next.reservation.type === 'hold') {
      await this.sql.run(`UPDATE tasks SET budget_period = ? WHERE id = ?`, [period, current.id])
    }
    await this.applyReservationLocked(next.reservation, period)
    return true
  }

  private async applyReservationLocked(effect: Extract<TransitionResult, { ok: true }>['reservation'], period: string) {
    if (effect.type === 'none') return
    const donor = await this.donorRow(effect.donorId)
    if (!donor) throw new Error('donor_not_found')
    const amount = money(effect.amount)
    const current = await this.periodAmounts(donor, period)
    if (donor.kind === 'mcp') {
      if (effect.type === 'hold') {
        if (current.spentTasks + current.reservedTasks + 1 > (donor.monthly_task_budget ?? 0)) {
          throw new Error('task_budget_exceeded')
        }
        await this.writePeriod(donor, period, current.spent, current.reserved, current.spentTasks, current.reservedTasks + 1)
        return
      }
      if (effect.type === 'release') {
        await this.writePeriod(donor, period, current.spent, current.reserved, current.spentTasks, current.reservedTasks - 1)
        return
      }
      await this.writePeriod(donor, period, current.spent, current.reserved, current.spentTasks + 1, current.reservedTasks - 1)
      return
    }
    if (effect.type === 'hold') {
      if (current.spent + current.reserved + amount > donor.spending_cap_usd + 1e-6) {
        throw new Error('spending_cap_exceeded')
      }
      await this.writePeriod(donor, period, current.spent, current.reserved + amount, current.spentTasks, current.reservedTasks)
      return
    }
    if (effect.type === 'release') {
      await this.writePeriod(donor, period, current.spent, current.reserved - amount, current.spentTasks, current.reservedTasks)
      return
    }
    await this.writePeriod(donor, period, current.spent + amount, current.reserved - amount, current.spentTasks, current.reservedTasks)
  }

  private async periodAmounts(donor: DonorRow, period: string) {
    if (donor.budget_period === period) {
      return {
        spent: Number(donor.spent_usd),
        reserved: Number(donor.reserved_usd),
        spentTasks: Number(donor.spent_tasks),
        reservedTasks: Number(donor.reserved_tasks),
      }
    }
    const row = await this.sql.get(
        `SELECT spent_usd, reserved_usd, spent_tasks, reserved_tasks FROM donor_periods WHERE donor_id = ? AND period = ?`, [donor.id, period]) as
      | { spent_usd: number; reserved_usd: number; spent_tasks: number; reserved_tasks: number }
      | undefined
    if (!row) return { spent: 0, reserved: 0, spentTasks: 0, reservedTasks: 0 }
    return {
      spent: Number(row.spent_usd),
      reserved: Number(row.reserved_usd),
      spentTasks: Number(row.spent_tasks),
      reservedTasks: Number(row.reserved_tasks),
    }
  }

  private async writePeriod(
    donor: DonorRow,
    period: string,
    spent: number,
    reserved: number,
    spentTasks: number,
    reservedTasks: number,
  ) {
    const spentUsd = money(Math.max(0, spent))
    const reservedUsd = money(Math.max(0, reserved))
    const tasksSpent = Math.max(0, Math.round(spentTasks))
    const tasksReserved = Math.max(0, Math.round(reservedTasks))
    await this.upsertPeriod(donor.id, period, spentUsd, reservedUsd, tasksSpent, tasksReserved)
    if (donor.budget_period === period) {
      await this.sql.run(`UPDATE donors SET spent_usd = ?, reserved_usd = ?, spent_tasks = ?, reserved_tasks = ? WHERE id = ?`, [spentUsd, reservedUsd, tasksSpent, tasksReserved, donor.id])
    }
  }

  private async upsertPeriod(
    donorId: string,
    period: string,
    spent: number,
    reserved: number,
    spentTasks = 0,
    reservedTasks = 0,
  ) {
    await this.sql.run(
        `INSERT INTO donor_periods (donor_id, period, spent_usd, reserved_usd, spent_tasks, reserved_tasks)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (donor_id, period) DO UPDATE SET
           spent_usd = excluded.spent_usd,
           reserved_usd = excluded.reserved_usd,
           spent_tasks = excluded.spent_tasks,
           reserved_tasks = excluded.reserved_tasks`, [donorId, period, money(spent), money(reserved), spentTasks, reservedTasks])
  }

  async submit(
    taskId: string,
    donorId: string,
    submission: { summary: string; url: string | null; patch: string | null },
    now: number,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    return this.transaction(async () => {
      await this.rollLocked(now)
      await this.expireLocked(now)
      const task = await this.taskRow(taskId)
      if (!task) return { ok: false, reason: 'not_found' }
      const next = transition(toSnapshot(task), { type: 'submit', donorId }, { maxAttempts: this.maxAttempts })
      if (!next.ok) return { ok: false, reason: next.error }
      if (!await this.writeTaskLocked(task, next, now)) return { ok: false, reason: 'conflict' }
      await this.sql.run(`UPDATE tasks SET submission_summary = ?, submission_url = ?, submission_patch = ? WHERE id = ?`, [submission.summary, submission.url, submission.patch, taskId])
      return { ok: true }
    })
  }

  async accept(taskId: string, now: number) {
    return this.transaction(async () => {
      await this.rollLocked(now)
      const task = await this.taskRow(taskId)
      if (!task) return { ok: false, reason: 'not_found' }
      const next = transition(
        { ...toSnapshot(task), result: task.submission_summary },
        { type: 'accept' },
        { maxAttempts: this.maxAttempts },
      )
      if (!next.ok) return { ok: false, reason: next.error }
      next.task.result = task.submission_summary
      if (!await this.writeTaskLocked(task, next, now)) return { ok: false, reason: 'conflict' }
      await this.promoteReadyLocked(now)
      return { ok: true }
    })
  }

  async reject(taskId: string, reason: string, now: number) {
    return this.transaction(async () => {
      await this.rollLocked(now)
      const task = await this.taskRow(taskId)
      if (!task) return { ok: false, reason: 'not_found' }
      const next = transition(toSnapshot(task), { type: 'reject', reason }, { maxAttempts: this.maxAttempts })
      if (!next.ok) return { ok: false, reason: next.error }
      if (!await this.writeTaskLocked(task, next, now)) return { ok: false, reason: 'conflict' }
      return { ok: true }
    })
  }

  async getGithubAppRow() {
    await this.ready
    return await this.sql.get(
      `SELECT app_id, slug, private_key_sealed, webhook_secret_sealed FROM github_app WHERE id = 1`,
      [],
    ) as { app_id: string; slug: string; private_key_sealed: string; webhook_secret_sealed: string } | undefined
  }

  async saveGithubAppRow(row: { appId: string; slug: string; privateKeySealed: string; webhookSecretSealed: string }, now: number) {
    await this.ready
    await this.sql.run(
      `INSERT INTO github_app (id, app_id, slug, private_key_sealed, webhook_secret_sealed, created_at) VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET app_id = excluded.app_id, slug = excluded.slug,
         private_key_sealed = excluded.private_key_sealed, webhook_secret_sealed = excluded.webhook_secret_sealed`,
      [row.appId, row.slug, row.privateKeySealed, row.webhookSecretSealed, now],
    )
  }

  async insertSetupCode(codeHash: string, expiresAt: number) {
    await this.ready
    await this.sql.run(`INSERT INTO setup_codes (code_hash, expires_at, used_at) VALUES (?, ?, NULL)`, [codeHash, expiresAt])
  }

  async setupCodeValid(codeHash: string, now: number): Promise<boolean> {
    await this.ready
    const row = await this.sql.get(`SELECT expires_at, used_at FROM setup_codes WHERE code_hash = ?`, [codeHash]) as
      { expires_at: number; used_at: number | null } | undefined
    return !!row && row.used_at === null && row.expires_at > now
  }

  async useSetupCode(codeHash: string, now: number): Promise<boolean> {
    await this.ready
    const changed = await this.sql.run(
      `UPDATE setup_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`,
      [now, codeHash, now],
    )
    return changed === 1
  }

  async setMonthlyTaskBudget(donorId: string, monthly: number): Promise<boolean> {
    await this.ready
    return (await this.sql.run(`UPDATE donors SET monthly_task_budget = ? WHERE id = ? AND kind = 'mcp'`, [monthly, donorId])) === 1
  }

  async handleTaken(handle: string): Promise<boolean> {
    await this.ready
    return !!(await this.sql.get(`SELECT 1 AS x FROM donors WHERE handle = ?`, [handle]))
  }

  async insertApplication(row: {
    id: string; createdAt: number; orgName: string; website: string | null; contactName: string; email: string
    country: string | null; statusKind: string; github: string; repoUrl: string | null; needs: string; listingUrl?: string | null
  }) {
    await this.ready
    await this.sql.run(
      `INSERT INTO applications (id, created_at, org_name, website, contact_name, email, country, status_kind, github, repo_url, needs, state, listing_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
      [row.id, row.createdAt, row.orgName, row.website, row.contactName, row.email, row.country, row.statusKind, row.github, row.repoUrl, row.needs, row.listingUrl ?? null],
    )
  }

  async listApplications() {
    await this.ready
    return await this.sql.all(`SELECT * FROM applications ORDER BY created_at DESC`, [])
  }

  async addToWaitlist(email: string, kind: 'chat' | 'money', now: number) {
    await this.ready
    await this.sql.run(`INSERT OR IGNORE INTO waitlist (email, kind, created_at) VALUES (?, ?, ?)`, [email, kind, now])
  }

  // Counts one hit for key and says whether it is still within limit.
  async hitRateLimit(key: string, limit: number, windowMs: number, now: number): Promise<boolean> {
    await this.ready
    await this.sql.run(`DELETE FROM rate_limits WHERE key = ? AND expires_at <= ?`, [key, now])
    await this.sql.run(
      `INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1`,
      [key, now + windowMs],
    )
    const row = await this.sql.get(`SELECT count FROM rate_limits WHERE key = ?`, [key]) as { count: number } | undefined
    return (row?.count ?? 0) <= limit
  }

  async prepare() {
    await this.ready
  }

  async heldTask(donorId: string) {
    await this.ready
    const row = await this.sql.get(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE donor_id = ? AND state IN ('claimed', 'running') ORDER BY updated_at LIMIT 1`,
      [donorId],
    ) as TaskRow | undefined
    return row ? taskFromRow(row) : null
  }

  async latestSession(donorId: string): Promise<WorkSession | null> {
    await this.ready
    const row = await this.sql.get(
      `SELECT id, donor_id, size, task_count, completed, status, has_computer FROM work_sessions WHERE donor_id = ? ORDER BY created_at DESC LIMIT 1`,
      [donorId],
    ) as SessionRow | undefined
    return row ? sessionFromRow(row) : null
  }

  async getOpenSession(donorId: string): Promise<WorkSession | null> {
    await this.ready
    const row = await this.sql.get(
      `SELECT id, donor_id, size, task_count, completed, status, has_computer FROM work_sessions WHERE donor_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
      [donorId],
    ) as SessionRow | undefined
    return row ? sessionFromRow(row) : null
  }

  async openWorkSession(id: string, donorId: string, size: TaskSize, taskCount: number, now: number, hasComputer = true) {
    await this.transaction(async () => {
      await this.sql.run(`UPDATE work_sessions SET status = 'stopped', updated_at = ? WHERE donor_id = ? AND status = 'open'`, [now, donorId])
      await this.sql.run(
        `INSERT INTO work_sessions (id, donor_id, size, task_count, completed, status, created_at, updated_at, has_computer) VALUES (?, ?, ?, ?, 0, 'open', ?, ?, ?)`,
        [id, donorId, size, taskCount, now, now, hasComputer ? 1 : 0],
      )
    })
  }

  async completeSessionTask(donorId: string, now: number) {
    await this.transaction(async () => {
      const session = await this.getOpenSession(donorId)
      if (!session) return
      const completed = session.completed + 1
      const status = completed >= session.taskCount ? 'done' : 'open'
      await this.sql.run(`UPDATE work_sessions SET completed = ?, status = ?, updated_at = ? WHERE id = ?`, [completed, status, now, session.id])
    })
  }

  async stopWorkSession(donorId: string, now: number) {
    await this.ready
    await this.sql.run(`UPDATE work_sessions SET status = 'stopped', updated_at = ? WHERE donor_id = ? AND status = 'open'`, [now, donorId])
  }

  async approveSafety(taskId: string) {
    await this.ready
    const info = await this.sql.run(
      `UPDATE tasks SET safety_status = 'approved' WHERE id = ? AND safety_status = 'flagged'`,
      [taskId],
    )
    return info === 1
  }

  async recordResultUrl(taskId: string, url: string) {
    await this.ready
    const info = await this.sql.run(
      `UPDATE tasks SET submission_url = ? WHERE id = ? AND state IN ('review', 'done')`,
      [url, taskId],
    )
    return info === 1
  }

  async insertToken(id: string, donorId: string, tokenHash: string, createdAt: number, label: string | null = null) {
    await this.sql.run(`INSERT INTO mcp_tokens (id, donor_id, token_hash, created_at, revoked_at, label) VALUES (?, ?, ?, ?, NULL, ?)`, [id, donorId, tokenHash, createdAt, label])
  }

  async touchToken(tokenHash: string, now: number) {
    await this.sql.run(`UPDATE mcp_tokens SET last_used_at = ? WHERE token_hash = ? AND (last_used_at IS NULL OR last_used_at < ?)`, [now, tokenHash, now - 60 * 60 * 1000])
  }

  async listTokens(donorId: string) {
    await this.ready
    return await this.sql.all(
      `SELECT id, label, created_at, last_used_at FROM mcp_tokens WHERE donor_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`,
      [donorId],
    ) as { id: string; label: string | null; created_at: number; last_used_at: number | null }[]
  }

  async revokeToken(donorId: string, tokenId: string, now: number) {
    return await this.sql.run(`UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND donor_id = ? AND revoked_at IS NULL`, [now, tokenId, donorId])
  }

  // ---------- plans and evidence ----------

  // A new holder starts with an empty record: a plan belongs to one volunteer's attempt.
  async savePlan(taskId: string, donorId: string, planJson: string, now: number) {
    await this.sql.run(
      `INSERT INTO task_plans (task_id, donor_id, plan_json, evidence_json, check_status, updated_at) VALUES (?, ?, ?, NULL, NULL, ?)
       ON CONFLICT(task_id) DO UPDATE SET donor_id = excluded.donor_id, plan_json = excluded.plan_json,
         evidence_json = CASE WHEN task_plans.donor_id = excluded.donor_id THEN task_plans.evidence_json END,
         check_status = CASE WHEN task_plans.donor_id = excluded.donor_id THEN task_plans.check_status END,
         updated_at = excluded.updated_at`,
      [taskId, donorId, planJson, now],
    )
  }

  async saveSubmissionRecord(taskId: string, donorId: string, evidenceJson: string, checkStatus: string | null, now: number) {
    await this.sql.run(
      `INSERT INTO task_plans (task_id, donor_id, plan_json, evidence_json, check_status, updated_at) VALUES (?, ?, NULL, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET evidence_json = excluded.evidence_json, check_status = excluded.check_status, updated_at = excluded.updated_at
       WHERE task_plans.donor_id = excluded.donor_id`,
      [taskId, donorId, evidenceJson, checkStatus, now],
    )
  }

  async getPlanRecord(taskId: string, donorId: string) {
    await this.ready
    return await this.sql.get(`SELECT plan_json, evidence_json, check_status FROM task_plans WHERE task_id = ? AND donor_id = ?`, [taskId, donorId]) as
      { plan_json: string | null; evidence_json: string | null; check_status: string | null } | undefined ?? null
  }

  async addTaskSignal(row: { id: string; taskId: string; kind: string; detail: string | null; url: string | null }, now: number) {
    await this.sql.run(`INSERT INTO task_signals (id, task_id, kind, detail, url, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [row.id, row.taskId, row.kind, row.detail, row.url, now])
  }

  async listTaskSignals(taskId: string) {
    await this.ready
    return await this.sql.all(`SELECT kind, detail, url, created_at FROM task_signals WHERE task_id = ? ORDER BY created_at DESC LIMIT 20`, [taskId]) as
      { kind: string; detail: string | null; url: string | null; created_at: number }[]
  }

  // ---------- revisions ----------

  async setRevision(taskId: string, prUrl: string, donorId: string | null, until: number, feedback: string) {
    await this.sql.run(`UPDATE tasks SET revision_pr = ?, revision_donor = ?, revision_until = ?, revision_feedback = ? WHERE id = ?`, [prUrl, donorId, until, feedback.slice(0, 2000), taskId])
  }

  async noteFeedback(taskId: string, reason: string) {
    await this.sql.run(`UPDATE tasks SET failure_reason = ? WHERE id = ?`, [reason.slice(0, 500), taskId])
  }

  async clearRevision(taskId: string) {
    await this.sql.run(`UPDATE tasks SET revision_pr = NULL, revision_donor = NULL, revision_until = NULL, revision_feedback = NULL WHERE id = ?`, [taskId])
  }

  // A merge can arrive while a revision is open or being worked on: the task
  // is done, credited to the volunteer whose work was merged.
  async markMergedDone(taskId: string, creditDonorId: string | null, now: number) {
    return this.transaction(async () => {
      await this.rollLocked(now)
      const task = await this.taskRow(taskId)
      if (!task) return { ok: false, reason: 'not_found' }
      const next = transition(toSnapshot(task), { type: 'merged', creditDonorId }, { maxAttempts: this.maxAttempts })
      if (!next.ok) return { ok: false, reason: next.error }
      if (!await this.writeTaskLocked(task, next, now)) return { ok: false, reason: 'conflict' }
      return { ok: true }
    })
  }

  // Replaces a project's notes with the latest ones.
  async saveSyncNotes(projectId: string, notes: { ref: string; message: string }[], now: number) {
    await this.sql.run(`DELETE FROM sync_notes WHERE project_id = ?`, [projectId])
    for (const note of notes.slice(0, 50)) {
      await this.sql.run(`INSERT INTO sync_notes (project_id, ref, message, updated_at) VALUES (?, ?, ?, ?)`, [projectId, note.ref, note.message.slice(0, 1000), now])
    }
  }

  async listSyncNotes(projectId: string) {
    await this.ready
    return await this.sql.all(`SELECT ref, message FROM sync_notes WHERE project_id = ? ORDER BY ref`, [projectId]) as { ref: string; message: string }[]
  }

  // ---------- outcomes and routines ----------

  async recordOutcome(row: { id: string; taskId: string; donorId: string | null; outcome: string; reason: string | null }, now: number) {
    await this.sql.run(`INSERT INTO task_outcomes (id, task_id, donor_id, outcome, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [row.id, row.taskId, row.donorId, row.outcome, row.reason, now])
  }

  // Hand-backs since the brief last changed.
  async returnsSinceBrief(taskId: string) {
    await this.ready
    const row = await this.sql.get(
      `SELECT COUNT(*) AS n FROM task_outcomes WHERE task_id = ? AND outcome IN ('rejected', 'released')
         AND created_at > COALESCE((SELECT MAX(created_at) FROM task_outcomes WHERE task_id = ? AND outcome = 'brief_changed'), 0)`,
      [taskId, taskId],
    ) as { n: number } | undefined
    return Number(row?.n ?? 0)
  }

  async donorTrackRecord(donorId: string, since: number) {
    await this.ready
    const rows = await this.sql.all(
      `SELECT outcome, COUNT(*) AS n FROM task_outcomes WHERE donor_id = ? AND created_at > ? GROUP BY outcome`,
      [donorId, since],
    ) as { outcome: string; n: number }[]
    const count = (o: string) => Number(rows.find((r) => r.outcome === o)?.n ?? 0)
    return { accepted: count('accepted'), rejected: count('rejected'), released: count('released'), expired: count('expired'), spam: count('spam') }
  }

  async pauseTask(taskId: string, reason: string) {
    return await this.sql.run(`UPDATE tasks SET paused_reason = ? WHERE id = ? AND state IN ('open', 'blocked')`, [reason, taskId])
  }

  async reviewCounts() {
    await this.ready
    const rows = await this.sql.all(`SELECT project_id, COUNT(*) AS n FROM tasks WHERE state = 'review' GROUP BY project_id`, []) as { project_id: string; n: number }[]
    return new Map(rows.map((r) => [r.project_id, Number(r.n)]))
  }

  async tasksInReview() {
    await this.ready
    const rows = await this.sql.all(`SELECT ${TASK_COLUMNS} FROM tasks WHERE state = 'review' ORDER BY updated_at`, []) as unknown as TaskRow[]
    return rows.map(taskFromRow)
  }

  // ---------- website accounts ----------

  async findAccountByGithub(githubId: string) {
    await this.ready
    return await this.sql.get(`SELECT id, github_id, github_login, email FROM accounts WHERE github_id = ?`, [githubId]) as AccountRow | undefined ?? null
  }

  async findAccountByEmail(email: string) {
    await this.ready
    return await this.sql.get(`SELECT id, github_id, github_login, email FROM accounts WHERE email = ?`, [email]) as AccountRow | undefined ?? null
  }

  async getAccount(id: string) {
    await this.ready
    return await this.sql.get(`SELECT id, github_id, github_login, email FROM accounts WHERE id = ?`, [id]) as AccountRow | undefined ?? null
  }

  async insertAccount(row: AccountRow, now: number) {
    await this.sql.run(
      `INSERT INTO accounts (id, github_id, github_login, email, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.github_id, row.github_login, row.email, now, now],
    )
  }

  async updateAccountLogin(id: string, fields: { github_login?: string | null; email?: string | null }, now: number) {
    await this.sql.run(
      `UPDATE accounts SET last_login_at = ?, github_login = COALESCE(?, github_login), email = COALESCE(email, ?) WHERE id = ?`,
      [now, fields.github_login ?? null, fields.email ?? null, id],
    )
  }

  async linkAccountGithub(id: string, githubId: string, login: string) {
    await this.sql.run(`UPDATE accounts SET github_id = ?, github_login = ? WHERE id = ? AND github_id IS NULL`, [githubId, login, id])
  }

  async insertAccountSession(idHash: string, accountId: string, now: number, expiresAt: number) {
    await this.sql.run(`INSERT INTO account_sessions (id_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)`, [idHash, accountId, now, expiresAt])
  }

  async findSessionAccount(idHash: string, now: number) {
    await this.ready
    const row = await this.sql.get(`SELECT account_id FROM account_sessions WHERE id_hash = ? AND expires_at > ?`, [idHash, now]) as { account_id: string } | undefined
    return row?.account_id ?? null
  }

  async deleteAccountSession(idHash: string) {
    await this.sql.run(`DELETE FROM account_sessions WHERE id_hash = ?`, [idHash])
  }

  async insertLoginLink(tokenHash: string, email: string, returnTo: string | null, now: number, expiresAt: number) {
    await this.sql.run(
      `INSERT INTO login_links (token_hash, email, return_to, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, NULL)`,
      [tokenHash, email, returnTo, now, expiresAt],
    )
  }

  // Single use: the update succeeds once, for an unexpired link.
  async useLoginLink(tokenHash: string, now: number) {
    await this.ready
    const row = await this.sql.get(`SELECT email, return_to FROM login_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`, [tokenHash, now]) as { email: string; return_to: string | null } | undefined
    if (!row) return null
    const changed = await this.sql.run(`UPDATE login_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL`, [now, tokenHash])
    return changed === 1 ? row : null
  }

  async loginLinkValid(tokenHash: string, now: number) {
    await this.ready
    return !!(await this.sql.get(`SELECT 1 AS ok FROM login_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`, [tokenHash, now]))
  }

  async donorForAccount(accountId: string) {
    await this.ready
    const row = await this.sql.get(`SELECT id FROM donors WHERE account_id = ? ORDER BY created_at LIMIT 1`, [accountId]) as { id: string } | undefined
    return row?.id ?? null
  }

  // Links a volunteer name to an account, only if it has no account yet.
  async linkDonorToAccount(donorId: string, accountId: string) {
    return await this.sql.run(`UPDATE donors SET account_id = ? WHERE id = ? AND account_id IS NULL`, [accountId, donorId])
  }

  async githubForDonor(donorId: string) {
    await this.ready
    const row = await this.sql.get(`SELECT a.github_id, a.github_login FROM donors d JOIN accounts a ON a.id = d.account_id WHERE d.id = ?`, [donorId]) as { github_id: string | null; github_login: string | null } | undefined
    return row?.github_id && row.github_login ? { id: row.github_id, login: row.github_login } : null
  }

  async isApprovedReviewer(githubLogin: string) {
    await this.ready
    return !!(await this.sql.get(`SELECT 1 AS ok FROM accounts WHERE lower(github_login) = lower(?) AND reviewer_status = 'approved'`, [githubLogin]))
  }

  async setReviewerStatus(accountId: string, status: 'applied' | 'approved' | null) {
    await this.sql.run(`UPDATE accounts SET reviewer_status = ? WHERE id = ?`, [status, accountId])
  }

  async reviewerStatus(accountId: string) {
    await this.ready
    const row = await this.sql.get(`SELECT reviewer_status FROM accounts WHERE id = ?`, [accountId]) as { reviewer_status: string | null } | undefined
    return row?.reviewer_status ?? null
  }

  // Our vetting decision on an application: 'approved' makes it available to onboarding volunteers.
  async setApplicationState(id: string, state: 'new' | 'approved' | 'declined') {
    return await this.sql.run(`UPDATE applications SET state = ? WHERE id = ?`, [state, id])
  }

  async onboarderStatus(accountId: string) {
    await this.ready
    const row = await this.sql.get(`SELECT onboarder_status FROM accounts WHERE id = ?`, [accountId]) as { onboarder_status: string | null } | undefined
    return row?.onboarder_status ?? null
  }

  async setOnboarderStatus(accountId: string, status: 'applied' | 'approved' | null) {
    await this.sql.run(`UPDATE accounts SET onboarder_status = ? WHERE id = ?`, [status, accountId])
  }

  // Vetted applications nobody has taken yet, and the ones this onboarder took.
  async applicationsForOnboarder(accountId: string) {
    await this.ready
    return await this.sql.all(
      `SELECT id, created_at, org_name, website, contact_name, email, country, status_kind, github, repo_url, needs, state, onboarder_account_id, onboarder_note, listing_url
       FROM applications WHERE (state = 'approved' AND onboarder_account_id IS NULL) OR onboarder_account_id = ? ORDER BY created_at LIMIT 50`,
      [accountId],
    ) as OnboardingApplication[]
  }

  async takeApplication(id: string, accountId: string) {
    return await this.sql.run(`UPDATE applications SET onboarder_account_id = ?, state = 'onboarding' WHERE id = ? AND state = 'approved' AND onboarder_account_id IS NULL`, [accountId, id])
  }

  async updateOnboarding(id: string, accountId: string, state: 'onboarding' | 'live' | 'not-a-fit' | 'approved', note: string | null) {
    const release = state === 'approved'
    return await this.sql.run(
      `UPDATE applications SET state = ?, onboarder_note = COALESCE(?, onboarder_note), onboarder_account_id = CASE WHEN ? THEN NULL ELSE onboarder_account_id END
       WHERE id = ? AND onboarder_account_id = ?`,
      [state, note, release ? 1 : 0, id, accountId],
    )
  }

  async getSigninApp() {
    await this.ready
    return await this.sql.get(`SELECT client_id, client_secret_sealed, slug FROM signin_app WHERE id = 1`, []) as { client_id: string; client_secret_sealed: string; slug: string } | undefined ?? null
  }

  async saveSigninApp(row: { clientId: string; clientSecretSealed: string; slug: string }, now: number) {
    await this.sql.run(
      `INSERT INTO signin_app (id, client_id, client_secret_sealed, slug, created_at) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET client_id = excluded.client_id, client_secret_sealed = excluded.client_secret_sealed, slug = excluded.slug`,
      [row.clientId, row.clientSecretSealed, row.slug, now],
    )
  }

  async listApplicationsFor(email: string | null, githubLogin: string | null) {
    await this.ready
    return await this.sql.all(
      `SELECT id, created_at, org_name, github, repo_url, state FROM applications WHERE (? IS NOT NULL AND lower(email) = lower(?)) OR (? IS NOT NULL AND lower(repo_url) LIKE lower(?)) ORDER BY created_at DESC LIMIT 20`,
      [email, email, githubLogin, githubLogin ? `%github.com/${githubLogin}/%` : null],
    ) as { id: string; created_at: number; org_name: string; github: string; repo_url: string | null; state: string }[]
  }

  async findActiveDonorByTokenHash(tokenHash: string) {
    const row = await this.sql.get(`SELECT donor_id FROM mcp_tokens WHERE token_hash = ? AND revoked_at IS NULL`, [tokenHash]) as { donor_id: string } | undefined
    return row?.donor_id ?? null
  }

  async revokeTokens(donorId: string, now: number) {
    const info = await this.sql.run(`UPDATE mcp_tokens SET revoked_at = ? WHERE donor_id = ? AND revoked_at IS NULL`, [now, donorId])
    return info
  }

  private async projectName(projectId: string) {
    const row = await this.sql.get(`SELECT name FROM projects WHERE id = ?`, [projectId]) as { name: string } | undefined
    return row?.name ?? ''
  }

  private async taskRow(id: string) {
    const row = await this.sql.get(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`, [id]) as TaskRow | undefined
    return row ?? null
  }

  private async donorRow(id: string) {
    const row = await this.sql.get(`SELECT ${DONOR_COLUMNS} FROM donors WHERE id = ?`, [id]) as DonorRow | undefined
    return row ?? null
  }

  private async transaction<T>(fn: () => Promise<T>) {
    await this.ready
    return this.sql.transaction(fn)
  }
}

function toSnapshot(row: TaskRow): TaskSnapshot {
  return {
    state: row.state,
    donorId: row.donor_id,
    leaseUntil: row.lease_until,
    attempts: Number(row.attempts),
    result: row.result,
    failureReason: row.failure_reason,
    reservedCostUsd: Number(row.reserved_cost_usd),
  }
}

function taskFromRow(row: TaskRow): TaskRecord {
  const providerOverride = row.provider_override == null ? null : row.provider_override
  if (providerOverride != null && !isProviderId(providerOverride)) {
    throw new Error('task has an unknown provider override')
  }
  return {
    id: row.id,
    projectId: row.project_id,
    localId: row.local_id,
    title: row.title,
    goal: row.goal,
    instructions: row.instructions,
    acceptance: row.acceptance,
    tests: row.tests,
    scopeDo: parseList(row.scope_do),
    scopeDont: parseList(row.scope_dont),
    deliverable: row.deliverable,
    size: parseSize(row.size),
    providerOverride,
    estimatedCostUsd: Number(row.estimated_cost_usd),
    state: row.state,
    donorId: row.donor_id,
    leaseUntil: row.lease_until == null ? null : Number(row.lease_until),
    attempts: Number(row.attempts),
    result: row.result,
    failureReason: row.failure_reason,
    reservedCostUsd: Number(row.reserved_cost_usd),
    budgetPeriod: row.budget_period,
    submissionSummary: row.submission_summary,
    submissionUrl: row.submission_url,
    submissionPatch: row.submission_patch,
    safetyStatus: row.safety_status === 'flagged' || row.safety_status === 'approved' ? row.safety_status : 'clear',
    safetyFlags: parseList(row.safety_flags),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    kind: row.kind === 'writing' ? 'writing' : 'code',
    needsComputer: row.needs_computer === 1,
    pausedReason: row.paused_reason ?? null,
    revisionPr: row.revision_pr ?? null,
    revisionDonor: row.revision_donor ?? null,
    revisionUntil: row.revision_until ?? null,
    revisionFeedback: row.revision_feedback ?? null,
    issueNumber: row.issue_number ?? null,
  }
}

function donorFromRow(row: DonorRow): DonorRecord {
  const kind = row.kind === 'mcp' ? 'mcp' : 'key'
  const provider = row.provider != null && isProviderId(row.provider) ? row.provider : null
  if (kind === 'key' && !provider) throw new Error('donor has an unknown provider')
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    kind,
    provider,
    spendingCapUsd: Number(row.spending_cap_usd),
    spentUsd: Number(row.spent_usd),
    reservedUsd: Number(row.reserved_usd),
    monthlyTaskBudget: row.monthly_task_budget == null ? null : Number(row.monthly_task_budget),
    spentTasks: Number(row.spent_tasks),
    reservedTasks: Number(row.reserved_tasks),
    budgetPeriod: row.budget_period,
    termsAcceptedAt: Number(row.terms_accepted_at),
    keyValidatedAt: Number(row.key_validated_at),
    createdAt: Number(row.created_at),
  }
}

function projectFromRow(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    github: row.github,
    orgUrl: row.org_url,
    nonprofit: Number(row.nonprofit) === 1,
    repoPath: row.repo_path,
    agentsMd: row.agents_md,
    registeredAt: Number(row.registered_at),
    checks: parseChecks(row.checks_json),
    cause: row.cause ?? null,
    summary: row.summary ?? null,
    previewUrl: row.preview_url ?? null,
    volunteerReviewers: row.volunteer_reviewers === 1,
  }
}

function parseChecks(value: string | null | undefined): { setup?: string; run: string } | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as { setup?: unknown; run?: unknown }
    return typeof parsed.run === 'string' ? { run: parsed.run, ...(typeof parsed.setup === 'string' ? { setup: parsed.setup } : {}) } : null
  } catch {
    return null
  }
}

type SessionRow = {
  id: string
  donor_id: string
  size: string
  task_count: number
  completed: number
  status: string
  has_computer?: number | null
}

function sessionFromRow(row: SessionRow): WorkSession {
  return {
    id: row.id,
    donorId: row.donor_id,
    size: parseSize(row.size),
    taskCount: Number(row.task_count),
    completed: Number(row.completed),
    status: row.status === 'done' || row.status === 'stopped' ? row.status : 'open',
    hasComputer: row.has_computer !== 0,
  }
}

function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed
  } catch {
    return []
  }
  return []
}

function parseSize(value: string): TaskSize {
  if (!isTaskSize(value)) throw new Error('task has an unknown size')
  return value
}

export type WorkSession = {
  id: string
  donorId: string
  size: TaskSize
  taskCount: number
  completed: number
  status: 'open' | 'done' | 'stopped'
  hasComputer: boolean
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
