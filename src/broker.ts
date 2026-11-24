import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { budgetPeriod, compareClaimable, explainTaskFit, placementBlock, supportsProject } from './budget.js'
import { publicHandle } from './handle.js'
import { briefText, lintInjection } from './injection-lint.js'
import type { TaskSize } from './task-size.js'
import { isTaskSize } from './task-size.js'
import { SAFETY_RULES, VOLUNTEER_RULES } from './volunteer-rules.js'
import { encryptSecret, parseEnvelope } from './crypto.js'
import { checkEligibility } from './eligibility.js'
import { loadManifest, ManifestError, type Manifest } from './manifest.js'
import { defaultModel, type ProviderRegistry } from './providers.js'
import { redact } from './redact.js'
import { executeTask } from './runner.js'
import type { SqliteStore } from './sqlite-store.js'
import { initialTaskState } from './state-machine.js'
import {
  BrokerError,
  isProviderId,
  type ClaimResult,
  type DonorPublic,
  type DonorRecord,
  type Logger,
  type ProjectRecord,
  type RegisteredProject,
  type RunResult,
  type TaskRecord,
  type TaskState,
} from './types.js'

const DEFAULT_LEASE_MS = 10 * 60 * 1000

// A volunteer's own AI works at chat speed, so its claim lasts longer than an
// API-key run, scaled by task size. keep_working extends it while work goes on.
const MCP_LEASE_MS: Record<string, number> = {
  small: 45 * 60 * 1000,
  medium: 90 * 60 * 1000,
  large: 180 * 60 * 1000,
}

export function mcpLeaseMs(size: string): number {
  return MCP_LEASE_MS[size] ?? 45 * 60 * 1000
}

const consoleLogger: Logger = {
  info(message) {
    console.log(message)
  },
  error(message) {
    console.error(message)
  },
}

export class Broker {
  private readonly store: SqliteStore
  private readonly masterKey: Buffer
  private readonly providers: ProviderRegistry
  private readonly now: () => number
  private readonly leaseMs: number
  private readonly logger: Logger

  constructor(options: {
    store: SqliteStore
    masterKey: Buffer
    providers: ProviderRegistry
    now?: () => number
    leaseMs?: number
    logger?: Logger
  }) {
    this.store = options.store
    this.masterKey = options.masterKey
    this.providers = options.providers
    this.now = options.now ?? (() => Date.now())
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
    const inner = options.logger ?? consoleLogger
    this.logger = {
      info: (message) => inner.info(redact(message)),
      error: (message) => inner.error(redact(message)),
    }
  }

  async registerProject(input: { manifestPath: string; repoPath?: string }): Promise<RegisteredProject> {
    let manifest
    try {
      manifest = loadManifest(input.manifestPath)
    } catch (error) {
      const message = error instanceof ManifestError || error instanceof Error ? error.message : 'invalid manifest'
      throw new BrokerError(message, 'invalid_manifest')
    }
    const repoPath = input.repoPath ? path.resolve(input.repoPath) : path.dirname(path.resolve(input.manifestPath))
    const agentsPath = path.join(repoPath, 'AGENTS.md')
    const agentsMd = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : null
    return this.registerManifest({ manifest, repoPath, agentsMd })
  }

  async registerManifest(input: { manifest: Manifest; repoPath: string; agentsMd: string | null }): Promise<RegisteredProject> {
    const manifest = input.manifest
    if (await this.store.getProjectByName(manifest.project.name)) {
      throw new BrokerError(`project already registered: ${manifest.project.name}`, 'project_exists')
    }
    const now = this.now()
    const projectId = randomUUID()
    const tasks = manifest.tasks.map((task, index) => {
      const safetyFlags = lintInjection(
        briefText({
          title: task.title,
          goal: task.goal,
          instructions: task.instructions,
          acceptance: task.acceptance,
          tests: task.tests,
          do: task.do,
          dont: task.dont,
          deliverable: task.deliverable,
          agentsMd: input.agentsMd,
        }),
      )
      return {
        id: `${projectId}:${task.id}`,
        projectId,
        localId: task.id,
        title: task.title,
        goal: task.goal,
        instructions: task.instructions,
        acceptance: task.acceptance,
        tests: task.tests,
        scopeDo: task.do,
        scopeDont: task.dont,
        deliverable: task.deliverable,
        size: task.size,
        providerOverride: task.provider ?? null,
        estimatedCostUsd: task.estimatedCostUsd,
        safetyStatus: safetyFlags.length > 0 ? ('flagged' as const) : ('clear' as const),
        safetyFlags,
        state: initialTaskState(task.dependsOn.length > 0),
        createdAt: now + index,
        dependsOn: task.dependsOn.map((dependency) => `${projectId}:${dependency}`),
      }
    })
    await this.store.insertProject(
      {
        id: projectId,
        name: manifest.project.name,
        github: manifest.project.github ?? null,
        orgUrl: manifest.project.orgUrl ?? null,
        nonprofit: manifest.project.nonprofit,
        repoPath: input.repoPath,
        agentsMd: input.agentsMd,
        registeredAt: now,
      },
      tasks,
    )
    this.logger.info(`project ${projectId} registered name=${manifest.project.name} tasks=${tasks.length}`)
    return {
      id: projectId,
      name: manifest.project.name,
      nonprofit: manifest.project.nonprofit,
      tasks: tasks.map((task) => ({
        id: task.id,
        localId: task.localId,
        state: task.state,
        safetyStatus: task.safetyStatus,
        safetyFlags: task.safetyFlags,
      })),
    }
  }

  async registerDonor(input: {
    name: string
    provider: string
    apiKey: string
    spendingCapUsd: number
    acceptTerms: boolean
  }): Promise<DonorPublic> {
    if (input.name.trim() !== input.name || input.name.length < 1 || input.name.length > 80 || /[\r\n]/.test(input.name)) {
      throw new BrokerError('donor rejected: name_invalid', 'name_invalid')
    }
    const now = this.now()
    const common = {
      purpose: 'register' as const,
      termsAcceptedAt: input.acceptTerms ? now : null,
      spendingCapUsd: input.spendingCapUsd,
      spentUsd: 0,
      reservedUsd: 0,
      provider: input.provider,
      apiKey: input.apiKey,
    }
    const preliminary = checkEligibility({ ...common, providerKeyChecked: false })
    if (!preliminary.ok) {
      throw new BrokerError(`donor rejected: ${preliminary.reasons.join(',')}`, 'donor_rejected')
    }
    if (!isProviderId(input.provider)) {
      throw new BrokerError('donor rejected: provider_unsupported', 'donor_rejected')
    }
    const provider = this.providers.get(input.provider)
    if (!provider) throw new BrokerError('donor rejected: provider_unsupported', 'donor_rejected')
    let validation
    try {
      validation = await provider.validateKey(input.apiKey)
    } catch (error) {
      const detail = redact(error instanceof Error ? error.message : 'validation failed', [input.apiKey])
      throw new BrokerError(`donor rejected: api_key_rejected (${detail})`, 'api_key_rejected')
    }
    const confirmed = checkEligibility({ ...common, providerKeyChecked: true, keyValid: validation.ok })
    if (!confirmed.ok) {
      const detail = validation.ok ? '' : ` (${redact(validation.reason, [input.apiKey])})`
      throw new BrokerError(`donor rejected: ${confirmed.reasons.join(',')}${detail}`, 'donor_rejected')
    }
    const envelope = encryptSecret(input.apiKey, this.masterKey)
    const id = randomUUID()
    await this.store.insertDonor({
      id,
      name: input.name,
      kind: 'key',
      provider: input.provider,
      spendingCapUsd: input.spendingCapUsd,
      spentUsd: 0,
      reservedUsd: 0,
      monthlyTaskBudget: null,
      termsAcceptedAt: now,
      keyValidatedAt: now,
      createdAt: now,
      envelopeJson: JSON.stringify(envelope),
      handle: publicHandle(input.name, id),
    })
    this.logger.info(`donor ${id} registered provider=${input.provider} cap=${input.spendingCapUsd}`)
    const stored = await this.store.getDonor(id)
    if (!stored) throw new BrokerError('donor rejected: not_stored', 'donor_rejected')
    return toPublic(stored)
  }

  async registerMcpDonor(input: { name: string; monthlyTasks: number; acceptTerms: boolean }): Promise<DonorPublic> {
    if (input.name.trim() !== input.name || input.name.length < 1 || input.name.length > 80 || /[\r\n]/.test(input.name) || input.name.includes('@')) {
      throw new BrokerError('donor rejected: use a short pseudonym, not an email', 'name_invalid')
    }
    const now = this.now()
    const gate = checkEligibility({
      purpose: 'register',
      budgetKind: 'tasks',
      termsAcceptedAt: input.acceptTerms ? now : null,
      spendingCapUsd: null,
      spentUsd: 0,
      reservedUsd: 0,
      provider: null,
      providerKeyChecked: false,
      monthlyTaskBudget: input.monthlyTasks,
    })
    if (!gate.ok) throw new BrokerError(`donor rejected: ${gate.reasons.join(',')}`, 'donor_rejected')
    const id = randomUUID()
    await this.store.insertDonor({
      id,
      name: input.name,
      kind: 'mcp',
      provider: null,
      spendingCapUsd: 0,
      spentUsd: 0,
      reservedUsd: 0,
      monthlyTaskBudget: input.monthlyTasks,
      termsAcceptedAt: now,
      keyValidatedAt: 0,
      createdAt: now,
      envelopeJson: null,
      handle: publicHandle(input.name, id),
    })
    this.logger.info(`donor ${id} registered kind=mcp tasks=${input.monthlyTasks}`)
    const stored = await this.store.getDonor(id)
    if (!stored) throw new BrokerError('donor rejected: not_stored', 'donor_rejected')
    return toPublic(stored)
  }

  async mintMcpToken(donorId: string) {
    const donor = await this.store.getDonor(donorId)
    if (!donor) throw new BrokerError(`donor not found: ${donorId}`, 'donor_not_found')
    if (donor.kind !== 'mcp') throw new BrokerError('only an MCP donor can hold a token', 'not_mcp_donor')
    const token = `vbk_${randomBytes(32).toString('base64url')}`
    await this.store.insertToken(randomUUID(), donorId, hashToken(token), this.now())
    this.logger.info(`donor ${donorId} minted an MCP token`)
    return { token }
  }

  async revokeMcpTokens(donorId: string): Promise<number> {
    if (!await this.store.getDonor(donorId)) throw new BrokerError(`donor not found: ${donorId}`, 'donor_not_found')
    const revoked = await this.store.revokeTokens(donorId, this.now())
    this.logger.info(`donor ${donorId} revoked ${revoked} MCP tokens`)
    return revoked
  }

  async authenticateMcpToken(token: string): Promise<string | null> {
    if (!token.startsWith('vbk_') || token.length < 20) return null
    return await this.store.findActiveDonorByTokenHash(hashToken(token))
  }

  async listProjects(): Promise<ProjectRecord[]> {
    return await this.store.listProjects()
  }

  async listTasks(projectId: string): Promise<TaskRecord[]> {
    if (!await this.store.getProject(projectId)) throw new BrokerError(`project not found: ${projectId}`, 'not_found')
    return await this.store.listTasks(projectId)
  }

  async listDonors(): Promise<DonorPublic[]> {
    return (await this.store.listDonors(this.now())).map(toPublic)
  }

  async unplaceable() {
    const now = this.now()
    const donors = await this.store.listDonors(now)
    const projects = new Map((await this.store.listProjects()).map((project) => [project.id, project]))
    const flagged = []
    for (const task of await this.store.listOpenTasks()) {
      const projectName = projects.get(task.projectId)?.name ?? ''
      const eligible = []
      for (const donor of donors) {
        if (donor.keyValidatedAt <= 0) continue
        if (!supportsProject(await this.store.supportNames(donor.id), projectName)) continue
        if (task.providerOverride != null && task.providerOverride !== donor.provider) continue
        eligible.push(donor)
      }
      const block = placementBlock(
        task.estimatedCostUsd,
        eligible.map((donor) => donor.spendingCapUsd),
      )
      if (!block) continue
      flagged.push({
        taskId: task.id,
        localId: task.localId,
        projectName: projects.get(task.projectId)?.name ?? task.projectId,
        estimatedCostUsd: task.estimatedCostUsd,
        reason: block.reason,
        largestBudgetUsd: block.reason === 'exceeds_every_monthly_budget' ? block.largestBudgetUsd : null,
      })
    }
    return flagged
  }

  async ledger() {
    const donors = new Map((await this.store.listDonors(this.now())).map((donor) => [donor.id, donor]))
    const lines = []
    for (const project of await this.store.listProjects()) {
      for (const task of await this.store.listTasks(project.id)) {
        if (task.state !== 'done' || !task.donorId) continue
        const donor = donors.get(task.donorId)
        if (!donor) continue
        lines.push({
          projectName: project.name,
          nonprofit: project.nonprofit,
          orgUrl: project.orgUrl,
          localId: task.localId,
          donorName: donor.name,
          donorProvider: donor.provider ?? 'mcp',
          provider: task.providerOverride ?? donor.provider ?? 'mcp',
          spendUsd: task.estimatedCostUsd,
          period: task.budgetPeriod ?? budgetPeriod(task.updatedAt),
        })
      }
    }
    return lines
  }

  async supportNames(donorId: string): Promise<string[]> {
    if (!await this.store.getDonor(donorId)) throw new BrokerError(`donor not found: ${donorId}`, 'donor_not_found')
    return await this.store.supportNames(donorId)
  }

  async setSupport(donorId: string, projectNames: string[]): Promise<void> {
    if (!await this.store.getDonor(donorId)) throw new BrokerError(`donor not found: ${donorId}`, 'donor_not_found')
    const unique: string[] = []
    for (const name of projectNames) {
      const trimmed = name.trim()
      if (trimmed && !unique.includes(trimmed)) unique.push(trimmed)
    }
    const known = new Set((await this.store.listProjects()).map((project) => project.name))
    const missing = unique.filter((name) => !known.has(name))
    if (missing.length > 0) throw new BrokerError(`unknown project: ${missing.join(', ')}`, 'unknown_project')
    await this.store.replaceSupport(donorId, unique)
    this.logger.info(`donor ${donorId} supports ${unique.length === 0 ? 'all' : unique.join(',')}`)
  }

  async impact(donorId: string) {
    const donor = await this.store.getDonor(donorId)
    if (!donor) throw new BrokerError(`donor not found: ${donorId}`, 'donor_not_found')
    const organizations = new Map<string, { name: string; nonprofit: boolean; orgUrl: string | null; tasks: number; spendUsd: number }>()
    let tasksCompleted = 0
    let estimatedSpendUsd = 0
    const projectsFullyDone: string[] = []
    for (const project of await this.store.listProjects()) {
      const tasks = await this.store.listTasks(project.id)
      let helped = 0
      let spend = 0
      let allDone = tasks.length > 0
      for (const task of tasks) {
        if (task.state !== 'done') allDone = false
        if (task.state === 'done' && task.donorId === donorId) {
          helped += 1
          spend += task.estimatedCostUsd
        }
      }
      if (helped === 0) continue
      tasksCompleted += helped
      estimatedSpendUsd += spend
      organizations.set(project.name, {
        name: project.name,
        nonprofit: project.nonprofit,
        orgUrl: project.orgUrl,
        tasks: helped,
        spendUsd: money(spend),
      })
      if (allDone) projectsFullyDone.push(project.name)
    }
    return {
      donorName: donor.name,
      tasksCompleted,
      estimatedSpendUsd: money(estimatedSpendUsd),
      organizations: [...organizations.values()],
      projectsFullyDone,
    }
  }

  async claim(donorId: string, taskId: string): Promise<ClaimResult> {
    const existing = await this.store.getTask(taskId)
    if (!existing) return { ok: false, reason: 'not_found' }
    const project = await this.store.getProject(existing.projectId)
    if (project && !supportsProject(await this.store.supportNames(donorId), project.name)) {
      return { ok: false, reason: 'project_not_supported' }
    }
    const donor = await this.store.getDonor(donorId)
    if (donor?.kind === 'mcp') {
      const gate = await this.sessionGate(donorId, existing.size)
      if (gate) return gate
    }
    const now = this.now()
    const leaseMs = donor?.kind === 'mcp' ? mcpLeaseMs(existing.size) : this.leaseMs
    const result = await this.store.claim({ donorId, taskId, now, leaseUntil: now + leaseMs })
    if (!result.ok) return result
    this.logger.info(`task ${taskId} claimed by donor ${donorId}`)
    return {
      ok: true,
      taskId,
      localId: existing.localId,
      projectId: existing.projectId,
      leaseUntil: result.leaseUntil,
    }
  }

  async claimNext(donorId: string): Promise<ClaimResult> {
    const now = this.now()
    await this.store.rollBudgets(now)
    const donor = await this.store.getDonor(donorId)
    if (!donor) return { ok: false, reason: 'donor_not_found' }
    if (donor.kind === 'mcp') return this.claimNextInSession(donorId)
    const candidates = await this.store.listOpenForDonor(donor.provider, now)
    if (candidates.length === 0) return { ok: false, reason: 'none_available' }
    const projects = new Map((await this.store.listProjects()).map((project) => [project.id, project]))
    const supported = await this.store.supportNames(donorId)
    const fitting = candidates.filter((task) => {
      const projectName = projects.get(task.projectId)?.name ?? ''
      return (
        explainTaskFit({
          supportedNames: supported,
          projectName,
          providerOverride: task.providerOverride,
          estimatedCostUsd: task.estimatedCostUsd,
          donor,
        }) == null
      )
    })
    if (fitting.length === 0) {
      const reason = candidates
        .map((task) =>
          explainTaskFit({
            supportedNames: supported,
            projectName: projects.get(task.projectId)?.name ?? '',
            providerOverride: task.providerOverride,
            estimatedCostUsd: task.estimatedCostUsd,
            donor,
          }),
        )
        .find((item) => item != null)
      return { ok: false, reason: reason ?? 'none_available' }
    }
    if (fitting.length === 0) return { ok: false, reason: 'spending_cap_exceeded' }
    fitting.sort((a, b) =>
      compareClaimable(
        {
          id: a.id,
          estimatedCostUsd: a.estimatedCostUsd,
          nonprofit: projects.get(a.projectId)?.nonprofit ?? false,
          createdAt: a.createdAt,
        },
        {
          id: b.id,
          estimatedCostUsd: b.estimatedCostUsd,
          nonprofit: projects.get(b.projectId)?.nonprofit ?? false,
          createdAt: b.createdAt,
        },
      ),
    )
    let last: ClaimResult = { ok: false, reason: 'none_available' }
    for (const task of fitting) {
      last = await this.claim(donorId, task.id)
      if (last.ok) return last
      const donorBlocked = last.reason.split(',').some((reason) =>
        reason === 'donor_not_found' ||
        reason === 'terms_not_accepted' ||
        reason === 'api_key_rejected' ||
        reason === 'spending_cap_missing' ||
        reason === 'spending_cap_invalid' ||
        reason === 'provider_unsupported',
      )
      if (donorBlocked) return last
    }
    return last
  }

  async run(donorId: string, taskId: string): Promise<RunResult> {
    const donor = await this.store.getDonor(donorId)
    if (!donor) return { ok: false, status: 'not_run', taskId, reason: 'donor_not_found' }
    const task = await this.store.getTask(taskId)
    if (!task) return { ok: false, status: 'not_run', taskId, reason: 'not_found' }
    const now = this.now()
    if (task.providerOverride && task.providerOverride !== donor.provider) {
      await this.store.release(taskId, donorId, now)
      return { ok: false, status: 'not_run', taskId, reason: 'provider_mismatch' }
    }
    const providerId = task.providerOverride ?? donor.provider
    if (!providerId) return { ok: false, status: 'not_run', taskId, reason: 'not_key_donor' }
    const provider = this.providers.get(providerId)
    if (!provider) {
      await this.store.release(taskId, donorId, now)
      return { ok: false, status: 'not_run', taskId, reason: 'provider_unsupported' }
    }
    const started = await this.store.markRunning(taskId, donorId, now + this.leaseMs, now)
    if (!started) return { ok: false, status: 'not_run', taskId, reason: 'not_claimed' }
    this.logger.info(`task ${taskId} running donor ${donorId}`)
    const envelopeJson = await this.store.getEnvelopeJson(donorId)
    if (!envelopeJson) return this.failRun(taskId, donorId, 'missing_secret', null)
    let envelope
    try {
      envelope = parseEnvelope(envelopeJson)
    } catch {
      return this.failRun(taskId, donorId, 'decryption failed', null)
    }
    try {
      const outcome = await executeTask({
        task,
        provider,
        envelope,
        masterKey: this.masterKey,
        model: defaultModel(provider.id),
      })
      if (outcome.accepted) {
        const wrote = await this.store.finish(taskId, donorId, { type: 'succeed', result: outcome.output }, this.now())
        if (!wrote) return { ok: false, status: 'not_run', taskId, reason: 'lost_lease' }
        this.logger.info(`task ${taskId} done donor ${donorId}`)
        return { ok: true, status: 'done', taskId, output: outcome.output }
      }
      const wrote = await this.store.finish(
        taskId,
        donorId,
        { type: 'fail', reason: outcome.reason, result: outcome.output },
        this.now(),
      )
      if (!wrote) return { ok: false, status: 'not_run', taskId, reason: 'lost_lease' }
      this.logger.error(`task ${taskId} failed: ${outcome.reason}`)
      return { ok: false, status: 'failed', taskId, reason: outcome.reason }
    } catch (error) {
      const reason = redact(error instanceof Error ? error.message : 'task failed').slice(0, 500)
      return this.failRun(taskId, donorId, reason, null)
    }
  }

  async listEligible(donorId: string) {
    const now = this.now()
    await this.store.rollBudgets(now)
    const donor = await this.store.getDonor(donorId)
    if (!donor) throw new BrokerError(`donor not found: ${donorId}`, 'donor_not_found')
    const projects = new Map((await this.store.listProjects()).map((project) => [project.id, project]))
    const supported = await this.store.supportNames(donorId)
    const session = donor.kind === 'mcp' ? await this.store.getOpenSession(donorId) : null
    if (donor.kind === 'mcp' && !session) return []
    const tasks = (await this.store.listOpenForDonor(donor.kind === 'mcp' ? null : donor.provider, now)).filter((task) => {
      if (session && task.size !== session.size) return false
      const project = projects.get(task.projectId)
      return (
        explainTaskFit({
          supportedNames: supported,
          projectName: project?.name ?? '',
          providerOverride: task.providerOverride,
          estimatedCostUsd: task.estimatedCostUsd,
          donor,
        }) == null
      )
    })
    tasks.sort((a, b) =>
      compareClaimable(
        {
          id: a.id,
          estimatedCostUsd: a.estimatedCostUsd,
          nonprofit: projects.get(a.projectId)?.nonprofit ?? false,
          createdAt: a.createdAt,
        },
        {
          id: b.id,
          estimatedCostUsd: b.estimatedCostUsd,
          nonprofit: projects.get(b.projectId)?.nonprofit ?? false,
          createdAt: b.createdAt,
        },
      ),
    )
    return tasks.map((task) => ({
      taskId: task.id,
      localId: task.localId,
      title: task.title,
      projectName: projects.get(task.projectId)?.name ?? '',
      nonprofit: projects.get(task.projectId)?.nonprofit ?? false,
      estimatedCostUsd: task.estimatedCostUsd,
    }))
  }

  async taskInstructions(donorId: string, taskId: string) {
    const task = await this.store.getTask(taskId)
    if (!task) throw new BrokerError(`task not found: ${taskId}`, 'not_found')
    if (task.donorId !== donorId || (task.state !== 'claimed' && task.state !== 'review')) {
      throw new BrokerError('task is not held by this donor', 'not_held')
    }
    const project = await this.store.getProject(task.projectId)
    const agentsMd = project?.agentsMd && project.agentsMd.length > 0 ? project.agentsMd : null
    return {
      safety: { outranksBrief: true as const, rules: [...SAFETY_RULES] },
      brief: {
        title: task.title,
        projectName: project?.name ?? '',
        size: task.size,
        goal: task.goal,
        instructions: task.instructions,
        acceptance: task.acceptance,
        tests: task.tests,
        do: task.scopeDo,
        dont: task.scopeDont,
        deliverable: task.deliverable,
        agentsMd,
      },
      rules: [...VOLUNTEER_RULES],
    }
  }

  async approveSafety(taskId: string) {
    const task = await this.store.getTask(taskId)
    if (!task) return { ok: false as const, reason: 'not_found' }
    if (task.safetyStatus === 'clear' || task.safetyStatus === 'approved') return { ok: true as const }
    const wrote = await this.store.approveSafety(taskId)
    if (wrote) this.logger.info(`task ${taskId} safety approved`)
    return wrote ? { ok: true as const } : { ok: false as const, reason: 'not_flagged' }
  }

  async submitResult(
    donorId: string,
    taskId: string,
    input: { summary: string; prUrl?: string | null; patch?: string | null },
  ) {
    const summary = input.summary.trim()
    if (summary.length === 0 || summary.length > 2_000) return { ok: false, reason: 'summary_invalid' }
    const prUrl = input.prUrl?.trim() || null
    // Keep the diff byte-exact apart from a guaranteed final newline: git apply
    // rejects a patch whose last line has no newline as corrupt.
    const rawPatch = input.patch && input.patch.trim() ? input.patch.replace(/\s+$/, '') : null
    const patch = rawPatch ? `${rawPatch}\n` : null
    if (!prUrl && !patch) return { ok: false, reason: 'submission_empty' }
    if (prUrl && !/^https?:\/\/\S{1,500}$/.test(prUrl)) return { ok: false, reason: 'pr_url_invalid' }
    if (patch && patch.length > 100_000) return { ok: false, reason: 'patch_too_large' }
    const result = await this.store.submit(taskId, donorId, { summary, url: prUrl, patch }, this.now())
    if (result.ok) await this.store.completeSessionTask(donorId, this.now())
    return result
  }

  async acceptSubmission(taskId: string) {
    const result = await this.store.accept(taskId, this.now())
    if (result.ok) this.logger.info(`task ${taskId} accepted`)
    return result
  }

  async rejectSubmission(taskId: string, reason: string) {
    const clean = reason.trim().slice(0, 500)
    if (!clean) return { ok: false, reason: 'reason_required' }
    const result = await this.store.reject(taskId, clean, this.now())
    if (result.ok) this.logger.info(`task ${taskId} rejected`)
    return result
  }

  async keepWorking(donorId: string, taskId: string) {
    const task = await this.store.getTask(taskId)
    if (!task || task.donorId !== donorId) return { ok: false as const, reason: 'not_holder' }
    const now = this.now()
    const leaseUntil = now + mcpLeaseMs(task.size)
    const extended = await this.store.extendLease(taskId, donorId, leaseUntil, now)
    return extended ? { ok: true as const, leaseUntil } : { ok: false as const, reason: 'lease_expired' }
  }

  async release(donorId: string, taskId: string, reason?: string) {
    const clean = reason?.trim().slice(0, 500)
    const result = await this.store.release(taskId, donorId, this.now(), clean || undefined)
    if (result.ok) this.logger.info(`task ${taskId} released by donor ${donorId}`)
    return result
  }

  async requestWork(donorId: string, count: number, size: string) {
    if (!Number.isInteger(count) || count < 1 || count > 20) return { ok: false as const, reason: 'count_invalid' }
    if (!isTaskSize(size)) return { ok: false as const, reason: 'size_invalid' }
    await this.store.rollBudgets(this.now())
    const donor = await this.store.getDonor(donorId)
    if (!donor) return { ok: false as const, reason: 'donor_not_found' }
    if (donor.kind !== 'mcp') return { ok: false as const, reason: 'not_mcp_donor' }
    if (await this.store.heldTask(donorId)) return { ok: false as const, reason: 'already_holding' }
    const budget = donor.monthlyTaskBudget ?? 0
    if (donor.spentTasks + donor.reservedTasks + count > budget) return { ok: false as const, reason: 'task_budget_exceeded' }
    const now = this.now()
    const id = randomUUID()
    await this.store.openWorkSession(id, donorId, size, count, now)
    this.logger.info(`donor ${donorId} ready for ${count} ${size} tasks`)
    return { ok: true as const, sessionId: id, count, size, completed: 0 }
  }

  async stopWork(donorId: string) {
    const held = await this.store.heldTask(donorId)
    if (held) {
      const released = await this.release(donorId, held.id, 'donor stopped the session')
      if (!released.ok) return released
    }
    await this.store.stopWorkSession(donorId, this.now())
    this.logger.info(`donor ${donorId} stopped the work session`)
    return { ok: true as const }
  }

  async recordResultUrl(taskId: string, prUrl: string) {
    const clean = prUrl.trim()
    if (!/^https?:\/\/\S{1,500}$/.test(clean)) return { ok: false as const, reason: 'pr_url_invalid' }
    const wrote = await this.store.recordResultUrl(taskId, clean)
    return wrote ? { ok: true as const } : { ok: false as const, reason: 'not_recorded' }
  }

  async retry(taskId: string) {
    const result = await this.store.retry(taskId, this.now())
    if (result.ok) this.logger.info(`task ${taskId} retried state=${result.state}`)
    return result
  }

  async expireLeases(): Promise<string[]> {
    const released = await this.store.expireLeases(this.now())
    for (const taskId of released) this.logger.info(`task ${taskId} lease expired`)
    return released
  }

  private async claimNextInSession(donorId: string): Promise<ClaimResult> {
    const session = await this.store.getOpenSession(donorId)
    if (!session) {
      const last = await this.store.latestSession(donorId)
      if (last && last.status === 'done' && last.completed >= last.taskCount) return { ok: false, reason: 'session_complete' }
      return { ok: false, reason: 'no_session' }
    }
    if (session.completed >= session.taskCount) return { ok: false, reason: 'session_complete' }
    if (await this.store.heldTask(donorId)) return { ok: false, reason: 'already_holding' }
    const tasks = await this.listEligible(donorId)
    const next = tasks[0]
    if (!next) return { ok: false, reason: 'none_available' }
    return this.claim(donorId, next.taskId)
  }

  private async sessionGate(donorId: string, size: TaskSize): Promise<ClaimResult | null> {
    const session = await this.store.getOpenSession(donorId)
    if (!session) return { ok: false, reason: 'no_session' }
    if (session.completed >= session.taskCount) return { ok: false, reason: 'session_complete' }
    if (size !== session.size) return { ok: false, reason: 'size_mismatch' }
    if (await this.store.heldTask(donorId)) return { ok: false, reason: 'already_holding' }
    return null
  }

  private async failRun(taskId: string, donorId: string, reason: string, result: string | null): Promise<RunResult> {
    const safe = redact(reason).slice(0, 500)
    const wrote = await this.store.finish(taskId, donorId, { type: 'fail', reason: safe, result }, this.now())
    this.logger.error(`task ${taskId} failed: ${safe}`)
    if (!wrote) return { ok: false, status: 'not_run', taskId, reason: 'lost_lease' }
    return { ok: false, status: 'failed', taskId, reason: safe }
  }
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function toPublic(donor: DonorRecord): DonorPublic {
  return {
    id: donor.id,
    name: donor.name,
    handle: donor.handle,
    kind: donor.kind,
    provider: donor.provider,
    spendingCapUsd: donor.spendingCapUsd,
    spentUsd: donor.spentUsd,
    reservedUsd: donor.reservedUsd,
    monthlyTaskBudget: donor.monthlyTaskBudget,
    spentTasks: donor.spentTasks,
    reservedTasks: donor.reservedTasks,
    budgetPeriod: donor.budgetPeriod,
    termsAcceptedAt: donor.termsAcceptedAt,
  }
}
