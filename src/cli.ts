import { readFileSync } from 'node:fs'
import path from 'node:path'

import { Broker } from './broker.js'
import { loadManifest } from './manifest.js'
import { serveMcpStdio, startMcpHttpServer } from './mcp-server.js'
import { generateMasterKey, loadMasterKey } from './crypto.js'
import { createFakeRegistry } from './fake-provider.js'
import { createProviderRegistry } from './providers.js'
import { redact } from './redact.js'
import { openSqliteStore } from './open-sqlite.js'
import { remoteDispatch } from './remote-cli.js'
import type { SqliteStore } from './sqlite-store.js'
import { BrokerError, type ClaimResult } from './types.js'

const HELP = `volunteer-compute-broker

  init-key
  lint --manifest <file>
  register-project --manifest <file> [--repo <path>]
  register-donor --name <name> --provider <anthropic|openai|xai|google> --budget <usd> --accept-terms (--api-key-file <file> | --api-key-env <var>)
  list-tasks --project <id>
  claim-next --donor <id>
  claim --donor <id> --task <id>
  run --donor <id> --task <id>
  release --donor <id> --task <id>
  retry --task <id>
  expire-leases
  too-big
  ledger
  impact --donor <id>
  support --donor <id> (--projects <name,name> | --clear)
  register-mcp-donor --name <name> --tasks <count> --accept-terms
  mcp-token --donor <id>
  mcp-revoke --donor <id>
  accept --task <id>
  reject --task <id> --reason <text>
  record-pr --task <id> --pr <url>
  approve-safety --task <id>
  mcp-serve [--port <n>]
  mcp-stdio
  status

Environment: BROKER_MASTER_KEY (base64, 32 bytes), BROKER_DB, BROKER_PROVIDERS=fake
Remote admin: BROKER_URL=https://volunteer.apishelf.dev BROKER_ADMIN_TOKEN=...
  register-project, register-mcp-donor, mcp-token, mcp-revoke, list-tasks, accept, reject, ledger, impact
`

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2)
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP)
    return 0
  }
  const { flags } = parseFlags(rest)
  if (flags.has('api-key')) {
    throw new BrokerError(
      'Refusing --api-key. Pass --api-key-file or --api-key-env so the key is not in the process list.',
      'bad_args',
    )
  }
  if (command === 'init-key') {
    process.stdout.write(`${generateMasterKey()}\n`)
    return 0
  }
  if (command === 'lint') {
    const manifest = loadManifest(requireFlag(flags, 'manifest'))
    process.stdout.write(`ok name=${manifest.project.name} tasks=${manifest.tasks.length}\n`)
    return 0
  }
  if (command === 'mcp-stdio') {
    const token = process.env.MCP_TOKEN ?? ''
    if (!token) throw new BrokerError('Set MCP_TOKEN to the donor token', 'missing_token')
    const opened = openBroker()
    try {
      await serveMcpStdio(opened.broker, token)
      return 0
    } finally {
      await opened.store.close()
    }
  }
  const remoteUrl = process.env.BROKER_URL
  if (remoteUrl) {
    const adminToken = process.env.BROKER_ADMIN_TOKEN ?? ''
    if (!adminToken) throw new BrokerError('Set BROKER_ADMIN_TOKEN', 'missing_admin_token')
    return remoteDispatch({ baseUrl: remoteUrl, adminToken, command, flags })
  }
  const opened = openBroker()
  try {
    return await dispatch(opened.broker, command, flags)
  } finally {
    await opened.store.close()
  }
}

async function dispatch(broker: Broker, command: string, flags: FlagMap): Promise<number> {
  switch (command) {
    case 'register-project': {
      const manifest = requireFlag(flags, 'manifest')
      const repo = flagString(flags, 'repo')
      const project = await broker.registerProject({ manifestPath: manifest, ...(repo ? { repoPath: repo } : {}) })
      process.stdout.write(`project_id=${project.id}\nname=${project.name}\nnonprofit=${project.nonprofit ? 'yes' : 'no'}\n`)
      for (const task of project.tasks) {
        const safety = task.safetyStatus === 'flagged' ? ` safety=flagged flags=${task.safetyFlags.join(',')}` : ''
        process.stdout.write(`task ${task.localId} state=${task.state}${safety}\n`)
      }
      return 0
    }
    case 'register-donor': {
      const donor = await broker.registerDonor({
        name: requireFlag(flags, 'name'),
        provider: requireFlag(flags, 'provider'),
        spendingCapUsd: Number(requireBudget(flags)),
        acceptTerms: flags.has('accept-terms'),
        apiKey: readDonorKey(flags),
      })
      const supports = flagString(flags, 'supports')
      if (supports) await broker.setSupport(donor.id, supports.split(','))
      process.stdout.write(
        `donor_id=${donor.id}\nprovider=${donor.provider}\nmonthly_budget_usd=${donor.spendingCapUsd}\nperiod=${donor.budgetPeriod}\nspent_usd=${donor.spentUsd}\n`,
      )
      return 0
    }
    case 'list-tasks': {
      const tasks = await broker.listTasks(requireFlag(flags, 'project'))
      for (const task of tasks) writeTask(task.localId, task.state, task.donorId)
      return 0
    }
    case 'claim-next':
      return writeClaim(await broker.claimNext(requireFlag(flags, 'donor')))
    case 'claim':
      return writeClaim(await broker.claim(requireFlag(flags, 'donor'), requireFlag(flags, 'task')))
    case 'run': {
      const result = await broker.run(requireFlag(flags, 'donor'), requireFlag(flags, 'task'))
      if (result.ok) {
        process.stdout.write(`run=done\ntask_id=${result.taskId}\n`)
        return 0
      }
      process.stdout.write(`run=${result.status}\ntask_id=${result.taskId}\nreason=${redact(result.reason)}\n`)
      return 1
    }
    case 'release': {
      const result = await broker.release(requireFlag(flags, 'donor'), requireFlag(flags, 'task'))
      process.stdout.write(result.ok ? 'release=ok\n' : `release=lost\nreason=${result.reason}\n`)
      return result.ok ? 0 : 1
    }
    case 'retry': {
      const result = await broker.retry(requireFlag(flags, 'task'))
      process.stdout.write(result.ok ? `retry=ok\nstate=${result.state}\n` : `retry=lost\nreason=${result.reason}\n`)
      return result.ok ? 0 : 1
    }
    case 'too-big': {
      const rows = await broker.unplaceable()
      if (rows.length === 0) {
        process.stdout.write('none\n')
        return 0
      }
      for (const row of rows) {
        const largest = row.largestBudgetUsd == null ? '-' : String(row.largestBudgetUsd)
        process.stdout.write(
          `task ${row.localId} project=${row.projectName} cost_usd=${row.estimatedCostUsd} reason=${row.reason} largest_budget_usd=${largest}\n`,
        )
      }
      return 0
    }
    case 'ledger': {
      const lines = await broker.ledger()
      if (lines.length === 0) {
        process.stdout.write('none\n')
        return 0
      }
      process.stdout.write('by_project\n')
      const byProject = group(lines, (line) => line.projectName)
      for (const [name, groupLines] of byProject) {
        const first = groupLines[0]
        if (!first) continue
        process.stdout.write(`project ${name} nonprofit=${first.nonprofit ? 'yes' : 'no'} org=${first.orgUrl ?? '-'}\n`)
        for (const line of groupLines) {
          process.stdout.write(
            `task ${line.localId} donor=${line.donorName} provider=${line.provider} spend_usd=${line.spendUsd} period=${line.period}\n`,
          )
        }
      }
      process.stdout.write('by_donor\n')
      const byDonor = group(lines, (line) => line.donorName)
      for (const [name, groupLines] of byDonor) {
        const first = groupLines[0]
        if (!first) continue
        process.stdout.write(`donor ${name} provider=${first.donorProvider}\n`)
        for (const line of groupLines) {
          process.stdout.write(
            `task ${line.localId} project=${line.projectName} provider=${line.provider} spend_usd=${line.spendUsd} period=${line.period}\n`,
          )
        }
      }
      return 0
    }
    case 'impact': {
      const report = await broker.impact(requireFlag(flags, 'donor'))
      process.stdout.write(`donor ${report.donorName}\n`)
      process.stdout.write(`tasks_completed=${report.tasksCompleted}\n`)
      process.stdout.write(`projects_helped=${report.organizations.length}\n`)
      process.stdout.write(`estimated_spend_usd=${report.estimatedSpendUsd}\n`)
      if (report.organizations.length === 0) process.stdout.write('organizations none\n')
      for (const org of report.organizations) {
        process.stdout.write(
          `organization ${org.name} nonprofit=${org.nonprofit ? 'yes' : 'no'} org=${org.orgUrl ?? '-'} tasks=${org.tasks} spend_usd=${org.spendUsd}\n`,
        )
      }
      process.stdout.write(
        report.projectsFullyDone.length === 0 ? 'fully_done none\n' : `fully_done ${report.projectsFullyDone.join(',')}\n`,
      )
      return 0
    }
    case 'support': {
      const donorId = requireFlag(flags, 'donor')
      if (flags.has('clear') && flagString(flags, 'projects')) {
        throw new BrokerError('pass only one of --clear or --projects', 'bad_args')
      }
      if (!flags.has('clear') && !flagString(flags, 'projects')) {
        const names = await broker.supportNames(donorId)
        process.stdout.write(`supports=${names.length === 0 ? 'all' : names.join(',')}\n`)
        return 0
      }
      await broker.setSupport(donorId, flags.has('clear') ? [] : (flagString(flags, 'projects') ?? '').split(','))
      const names = await broker.supportNames(donorId)
      process.stdout.write(`supports=${names.length === 0 ? 'all' : names.join(',')}\n`)
      return 0
    }
    case 'register-mcp-donor': {
      const donor = await broker.registerMcpDonor({
        name: requireFlag(flags, 'name'),
        monthlyTasks: Number(requireFlag(flags, 'tasks')),
        acceptTerms: flags.has('accept-terms'),
      })
      process.stdout.write(
        `donor_id=${donor.id}\nkind=mcp\nmonthly_tasks=${donor.monthlyTaskBudget}\nperiod=${donor.budgetPeriod}\n`,
      )
      return 0
    }
    case 'mcp-token': {
      const minted = await broker.mintMcpToken(requireFlag(flags, 'donor'))
      process.stdout.write(`token=${minted.token}\n`)
      process.stderr.write('Save this token now. It is not shown again.\n')
      return 0
    }
    case 'mcp-revoke': {
      const revoked = await broker.revokeMcpTokens(requireFlag(flags, 'donor'))
      process.stdout.write(`revoked=${revoked}\n`)
      return 0
    }
    case 'accept': {
      const result = await broker.acceptSubmission(requireFlag(flags, 'task'))
      process.stdout.write(result.ok ? 'accept=ok\n' : `accept=lost\nreason=${result.reason}\n`)
      return result.ok ? 0 : 1
    }
    case 'reject': {
      const result = await broker.rejectSubmission(requireFlag(flags, 'task'), requireFlag(flags, 'reason'))
      process.stdout.write(result.ok ? 'reject=ok\n' : `reject=lost\nreason=${result.reason}\n`)
      return result.ok ? 0 : 1
    }
    case 'record-pr': {
      const result = await broker.recordResultUrl(requireFlag(flags, 'task'), requireFlag(flags, 'pr'))
      process.stdout.write(result.ok ? 'record=ok\n' : `record=lost\nreason=${result.reason}\n`)
      return result.ok ? 0 : 1
    }
    case 'approve-safety': {
      const result = await broker.approveSafety(requireFlag(flags, 'task'))
      process.stdout.write(result.ok ? 'safety=approved\n' : `safety=lost\nreason=${result.reason}\n`)
      return result.ok ? 0 : 1
    }
    case 'mcp-serve': {
      const port = Number(flagString(flags, 'port') ?? '8788')
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new BrokerError('invalid --port', 'bad_args')
      const running = await startMcpHttpServer({ broker, port })
      process.stdout.write(`mcp_url=${running.url}\n`)
      return await new Promise<number>(() => {})
    }
    case 'expire-leases': {
      const released = await broker.expireLeases()
      process.stdout.write(`expired=${released.length}\n`)
      for (const taskId of released) process.stdout.write(`task_id=${taskId}\n`)
      return 0
    }
    case 'status': {
      for (const project of await broker.listProjects()) {
        process.stdout.write(`project ${project.id} ${project.name}\n`)
        for (const task of await broker.listTasks(project.id)) writeTask(task.localId, task.state, task.donorId)
      }
      for (const donor of await broker.listDonors()) {
        process.stdout.write(
          `donor ${donor.id} ${donor.name} provider=${donor.provider} monthly_budget=${donor.spendingCapUsd} spent=${donor.spentUsd} reserved=${donor.reservedUsd} period=${donor.budgetPeriod} supports=${(await broker.supportNames(donor.id)).join(',') || 'all'}\n`,
        )
      }
      return 0
    }
    default:
      throw new BrokerError(`unknown command: ${command}`, 'bad_args')
  }
}

function writeTask(localId: string, state: string, donorId: string | null): void {
  process.stdout.write(`task ${localId} state=${state} donor=${donorId ?? '-'}\n`)
}

function writeClaim(result: ClaimResult): number {
  if (!result.ok) {
    process.stdout.write(`claim=lost\nreason=${redact(result.reason)}\n`)
    return 1
  }
  process.stdout.write(
    `claim=won\ntask_id=${result.taskId}\nlocal_id=${result.localId}\nlease_until=${result.leaseUntil}\n`,
  )
  return 0
}

function readDonorKey(flags: FlagMap): string {
  const file = flagString(flags, 'api-key-file')
  const envName = flagString(flags, 'api-key-env')
  if (file && envName) throw new BrokerError('pass only one of --api-key-file or --api-key-env', 'bad_args')
  if (file) return readFileSync(file, 'utf8').replace(/\r?\n$/, '')
  if (envName) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) throw new BrokerError('invalid --api-key-env name', 'bad_args')
    const value = process.env[envName]
    if (!value) throw new BrokerError(`environment variable ${envName} is empty`, 'bad_args')
    return value
  }
  throw new BrokerError('pass --api-key-file or --api-key-env', 'bad_args')
}

function openBroker(): { broker: Broker; store: SqliteStore } {
  const mode = process.env.BROKER_PROVIDERS ?? 'real'
  if (mode !== 'fake' && mode !== 'real') {
    throw new BrokerError('BROKER_PROVIDERS must be fake or real', 'bad_args')
  }
  const master = process.env.BROKER_MASTER_KEY
  if (!master) {
    throw new BrokerError('Set BROKER_MASTER_KEY to a base64 32-byte key. Run: npm run cli -- init-key', 'missing_master_key')
  }
  const dbPath = process.env.BROKER_DB ?? path.join(process.cwd(), 'data', 'broker.sqlite')
  const store = openSqliteStore(dbPath)
  const providers = mode === 'fake' ? createFakeRegistry() : createProviderRegistry()
  const broker = new Broker({ store, masterKey: loadMasterKey(master), providers })
  return { broker, store }
}

type FlagMap = Map<string, string | true>

function parseFlags(args: string[]): { positionals: string[]; flags: FlagMap } {
  const flags: FlagMap = new Map()
  const positionals: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg == null) continue
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = args[index + 1]
    if (next == null || next.startsWith('--')) {
      flags.set(key, true)
    } else {
      flags.set(key, next)
      index++
    }
  }
  return { positionals, flags }
}

function flagString(flags: FlagMap, key: string): string | undefined {
  const value = flags.get(key)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function requireBudget(flags: FlagMap): string {
  const value = flagString(flags, 'budget') ?? flagString(flags, 'cap')
  if (!value) throw new BrokerError('missing --budget', 'bad_args')
  return value
}

function group<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const item of items) {
    const name = key(item)
    const existing = grouped.get(name)
    if (existing) existing.push(item)
    else grouped.set(name, [item])
  }
  return grouped
}

function requireFlag(flags: FlagMap, key: string): string {
  const value = flagString(flags, key)
  if (!value) throw new BrokerError(`missing --${key}`, 'bad_args')
  return value
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'command failed'
    process.stderr.write(`${redact(message)}\n`)
    process.exitCode = 1
  })
