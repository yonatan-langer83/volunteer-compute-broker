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
  submission_url, submission_patch, safety_status, safety_flags, created_at, updated_at
`

const DONOR_COLUMNS = `
  id, name, kind, provider, spending_cap_usd, spent_usd, reserved_usd,
  monthly_task_budget, spent_tasks, reserved_tasks, budget_period,
  terms_accepted_at, key_validated_at, created_at, handle
`

const PROJECT_COLUMNS = `id, name, github, org_url, nonprofit, repo_path, agents_md, registered_at`

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
          `INSERT INTO projects (id, name, github, org_url, nonprofit, repo_path, agents_md, registered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [project.id, project.name, project.github, project.orgUrl, project.nonprofit ? 1 : 0, project.repoPath, project.agentsMd, project.registeredAt])
      for (const task of tasks) {
        await this.sql.run(
            `INSERT INTO tasks (
              id, project_id, local_id, title, goal, instructions, acceptance, tests,
              scope_do, scope_dont, deliverable, size, provider_override,
              estimated_cost_usd, state, donor_id, lease_until, attempts, result,
              failure_reason, reserved_cost_usd, safety_status, safety_flags, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, NULL, 0, ?, ?, ?, ?)`, [task.id,
            task.projectId,
            task.localId,
            task.title,
            task.goal,
            task.instructions,
            task.acceptance,
            task.tests,
            JSON.stringify(task.scopeDo),
            JSON.stringify(task.scopeDont),
            task.deliverable,
            task.size,
            task.providerOverride,
            task.estimatedCostUsd,
            task.state,
            task.safetyStatus,
            JSON.stringify(task.safetyFlags),
            task.createdAt,
            task.createdAt,])
      }
      for (const task of tasks) {
        for (const dependency of task.dependsOn) {
          await this.sql.run(`INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)`, [task.id, dependency])
        }
      }
    })
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
    const rows = await this.sql.all(`SELECT ${TASK_COLUMNS} FROM tasks WHERE state = 'open' AND safety_status != 'flagged' ORDER BY created_at, id`, []) as unknown as TaskRow[]
    return rows.map(taskFromRow)
  }

  async getTask(id: string) {
    const row = await this.taskRow(id)
    return row ? taskFromRow(row) : null
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
          ? `SELECT ${TASK_COLUMNS} FROM tasks WHERE state = 'open' AND safety_status != 'flagged' ORDER BY created_at, id`
          : `SELECT ${TASK_COLUMNS} FROM tasks WHERE state = 'open' AND safety_status != 'flagged' AND (provider_override IS NULL OR provider_override = ?) ORDER BY created_at, id`
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
      `SELECT id, donor_id, size, task_count, completed, status FROM work_sessions WHERE donor_id = ? ORDER BY created_at DESC LIMIT 1`,
      [donorId],
    ) as SessionRow | undefined
    return row ? sessionFromRow(row) : null
  }

  async getOpenSession(donorId: string): Promise<WorkSession | null> {
    await this.ready
    const row = await this.sql.get(
      `SELECT id, donor_id, size, task_count, completed, status FROM work_sessions WHERE donor_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
      [donorId],
    ) as SessionRow | undefined
    return row ? sessionFromRow(row) : null
  }

  async openWorkSession(id: string, donorId: string, size: TaskSize, taskCount: number, now: number) {
    await this.transaction(async () => {
      await this.sql.run(`UPDATE work_sessions SET status = 'stopped', updated_at = ? WHERE donor_id = ? AND status = 'open'`, [now, donorId])
      await this.sql.run(
        `INSERT INTO work_sessions (id, donor_id, size, task_count, completed, status, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'open', ?, ?)`,
        [id, donorId, size, taskCount, now, now],
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

  async insertToken(id: string, donorId: string, tokenHash: string, createdAt: number) {
    await this.sql.run(`INSERT INTO mcp_tokens (id, donor_id, token_hash, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL)`, [id, donorId, tokenHash, createdAt])
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
  }
}

type SessionRow = {
  id: string
  donor_id: string
  size: string
  task_count: number
  completed: number
  status: string
}

function sessionFromRow(row: SessionRow): WorkSession {
  return {
    id: row.id,
    donorId: row.donor_id,
    size: parseSize(row.size),
    taskCount: Number(row.task_count),
    completed: Number(row.completed),
    status: row.status === 'done' || row.status === 'stopped' ? row.status : 'open',
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
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
