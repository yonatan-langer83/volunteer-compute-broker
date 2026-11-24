import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { redact } from './redact.js'
import { BrokerError } from './types.js'

type FlagMap = Map<string, string | true>

const REMOTE_COMMANDS = new Set([
  'register-project',
  'register-mcp-donor',
  'mcp-token',
  'mcp-revoke',
  'list-tasks',
  'accept',
  'reject',
  'record-pr',
  'approve-safety',
  'ledger',
  'impact',
])

export async function remoteDispatch(input: {
  baseUrl: string
  adminToken: string
  command: string
  flags: FlagMap
}): Promise<number> {
  if (!REMOTE_COMMANDS.has(input.command)) {
    throw new BrokerError(`${input.command} stays on the local database. Unset BROKER_URL to run it here.`, 'local_only')
  }
  const call = (pathname: string, init?: { method?: string; body?: unknown; search?: string }) =>
    adminCall(input.baseUrl, input.adminToken, pathname, init)
  switch (input.command) {
    case 'register-project': {
      const manifestPath = requireFlag(input.flags, 'manifest')
      const repo = flagString(input.flags, 'repo') ?? path.dirname(path.resolve(manifestPath))
      const agentsPath = path.join(repo, 'AGENTS.md')
      const project = await call('/admin/projects', {
        method: 'POST',
        body: {
          manifest: readFileSync(manifestPath, 'utf8'),
          ...(existsSync(agentsPath) ? { agentsMd: readFileSync(agentsPath, 'utf8') } : {}),
        },
      })
      process.stdout.write(`project_id=${project.id}\nname=${project.name}\nnonprofit=${project.nonprofit ? 'yes' : 'no'}\n`)
      for (const task of project.tasks ?? []) {
        const safety = task.safetyStatus === 'flagged' ? ` safety=flagged flags=${(task.safetyFlags ?? []).join(',')}` : ''
        process.stdout.write(`task ${task.localId} state=${task.state}${safety}\n`)
      }
      return 0
    }
    case 'register-mcp-donor': {
      const donor = await call('/admin/mcp-donors', {
        method: 'POST',
        body: {
          name: requireFlag(input.flags, 'name'),
          monthlyTasks: Number(requireFlag(input.flags, 'tasks')),
          acceptTerms: input.flags.has('accept-terms'),
        },
      })
      process.stdout.write(
        `donor_id=${donor.id}\nkind=mcp\nmonthly_tasks=${donor.monthlyTaskBudget}\nperiod=${donor.budgetPeriod}\n`,
      )
      return 0
    }
    case 'mcp-token': {
      const minted = await call('/admin/tokens', {
        method: 'POST',
        body: { donorId: requireFlag(input.flags, 'donor') },
      })
      process.stdout.write(`token=${minted.token}\n`)
      process.stderr.write('Save this token now. It is not shown again.\n')
      return 0
    }
    case 'mcp-revoke': {
      const result = await call('/admin/tokens/revoke', {
        method: 'POST',
        body: { donorId: requireFlag(input.flags, 'donor') },
      })
      process.stdout.write(`revoked=${result.revoked}\n`)
      return 0
    }
    case 'list-tasks': {
      const project = requireFlag(input.flags, 'project')
      const listed = await call('/admin/tasks', { search: `?project=${encodeURIComponent(project)}` })
      for (const task of listed.tasks ?? []) {
        process.stdout.write(`task ${task.localId} state=${task.state} donor=${task.donorId ?? '-'}\n`)
      }
      return 0
    }
    case 'accept': {
      const result = await call('/admin/submissions/accept', {
        method: 'POST',
        body: { taskId: requireFlag(input.flags, 'task') },
      })
      process.stdout.write(result.ok ? 'accept=ok\n' : `accept=lost\nreason=${result.reason}\n`)
      return result.ok ? 0 : 1
    }
    case 'reject': {
      const result = await call('/admin/submissions/reject', {
        method: 'POST',
        body: { taskId: requireFlag(input.flags, 'task'), reason: requireFlag(input.flags, 'reason') },
      })
      process.stdout.write(result.ok ? 'reject=ok\n' : `reject=lost\nreason=${result.reason}\n`)
      return result.ok ? 0 : 1
    }
    case 'approve-safety': {
      const result = await call('/admin/safety/approve', {
        method: 'POST',
        body: { taskId: requireFlag(input.flags, 'task') },
      })
      process.stdout.write(result.ok ? 'safety=approved\n' : `safety=lost\nreason=${result.reason}\n`)
      return result.ok ? 0 : 1
    }
    case 'record-pr': {
      const result = await call('/admin/results/pr', {
        method: 'POST',
        body: { taskId: requireFlag(input.flags, 'task'), prUrl: requireFlag(input.flags, 'pr') },
      })
      process.stdout.write(result.ok ? 'record=ok\n' : `record=lost\nreason=${result.reason}\n`)
      return result.ok ? 0 : 1
    }
    case 'ledger': {
      const ledger = await call('/admin/ledger')
      const rows = ledger.rows ?? [] as LedgerRow[]
      if (rows.length === 0) {
        process.stdout.write('none\n')
        return 0
      }
      process.stdout.write('by_project\n')
      const byProject = group(rows, (row) => String(row.projectName))
      for (const [name, lines] of byProject) {
        const first = lines[0]
        process.stdout.write(`project ${name} nonprofit=${first?.nonprofit ? 'yes' : 'no'} org=${first?.orgUrl ?? '-'}\n`)
        for (const line of lines) {
          process.stdout.write(
            `task ${line.localId} donor=${line.donorName} provider=${line.provider} spend_usd=${line.spendUsd} period=${line.period}\n`,
          )
        }
      }
      process.stdout.write('by_donor\n')
      const byDonor = group(rows, (row) => String(row.donorName))
      for (const [name, lines] of byDonor) {
        const first = lines[0]
        process.stdout.write(`donor ${name} provider=${first?.donorProvider}\n`)
        for (const line of lines) {
          process.stdout.write(
            `task ${line.localId} project=${line.projectName} provider=${line.provider} spend_usd=${line.spendUsd} period=${line.period}\n`,
          )
        }
      }
      return 0
    }
    case 'impact': {
      const donor = requireFlag(input.flags, 'donor')
      const report = await call('/admin/impact', { search: `?donor=${encodeURIComponent(donor)}` })
      process.stdout.write(`donor ${report.donorName}\n`)
      process.stdout.write(`tasks_completed=${report.tasksCompleted}\n`)
      process.stdout.write(`projects_helped=${report.organizations?.length ?? 0}\n`)
      process.stdout.write(`estimated_spend_usd=${report.estimatedSpendUsd}\n`)
      const organizations = report.organizations ?? []
      if (organizations.length === 0) process.stdout.write('organizations none\n')
      for (const org of organizations) {
        process.stdout.write(
          `organization ${org.name} nonprofit=${org.nonprofit ? 'yes' : 'no'} org=${org.orgUrl ?? '-'} tasks=${org.tasks} spend_usd=${org.spendUsd}\n`,
        )
      }
      const done = report.projectsFullyDone ?? []
      process.stdout.write(done.length === 0 ? 'fully_done none\n' : `fully_done ${done.join(',')}\n`)
      return 0
    }
    default:
      throw new BrokerError(`unknown command: ${input.command}`, 'bad_args')
  }
}

type LedgerRow = {
  projectName: string
  nonprofit: boolean
  orgUrl: string | null
  localId: string
  donorName: string
  donorProvider: string
  provider: string
  spendUsd: number
  period: string
}

type JsonRecord = Record<string, unknown> & {
  id?: string
  name?: string
  nonprofit?: boolean
  tasks?: { localId?: string; state?: string; donorId?: string | null; safetyStatus?: string; safetyFlags?: string[] }[]
  monthlyTaskBudget?: number | null
  budgetPeriod?: string
  token?: string
  revoked?: number
  ok?: boolean
  reason?: string
  rows?: LedgerRow[]
  donorName?: string
  tasksCompleted?: number
  estimatedSpendUsd?: number
  organizations?: { name?: string; nonprofit?: boolean; orgUrl?: string | null; tasks?: number; spendUsd?: number }[]
  projectsFullyDone?: string[]
}

async function adminCall(
  baseUrl: string,
  adminToken: string,
  pathname: string,
  init?: { method?: string; body?: unknown; search?: string },
): Promise<JsonRecord> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${pathname}${init?.search ?? ''}`, {
    method: init?.method ?? 'GET',
    headers: {
      authorization: `Bearer ${adminToken}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new BrokerError(redact(text || `remote request failed (${response.status})`), 'remote_failed')
  }
  return text ? (JSON.parse(text) as JsonRecord) : {}
}

function flagString(flags: FlagMap, key: string): string | undefined {
  const value = flags.get(key)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function requireFlag(flags: FlagMap, key: string): string {
  const value = flagString(flags, key)
  if (!value) throw new BrokerError(`missing --${key}`, 'bad_args')
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
