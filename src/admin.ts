import type { Broker } from './broker.js'
import { redact } from './redact.js'
import { parseManifestYaml, ManifestError } from './manifest.js'
import { secretEquals } from './secret.js'
import { BrokerError } from './types.js'

export async function handleAdmin(broker: Broker, request: Request, adminToken: string): Promise<Response> {
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (!secretEquals(provided, adminToken)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '')
  try {
    if (request.method === 'POST' && path === '/admin/projects') {
      const body = await readJson(request)
      if (typeof body.manifest !== 'string' || body.manifest.length === 0) return jsonError('manifest_required', 400)
      const manifest = parseManifestYaml(body.manifest)
      const agentsMd = typeof body.agentsMd === 'string' ? body.agentsMd : null
      const project = await broker.registerManifest({
        manifest,
        repoPath: manifest.project.github ?? '',
        agentsMd,
      })
      return Response.json(project)
    }
    if (request.method === 'GET' && path === '/admin/applications') {
      return Response.json({ applications: await broker.listApplications() })
    }
    if (request.method === 'POST' && path === '/admin/mcp-donors') {
      const body = await readJson(request)
      const donor = await broker.registerMcpDonor({
        name: typeof body.name === 'string' ? body.name : '',
        monthlyTasks: typeof body.monthlyTasks === 'number' ? body.monthlyTasks : Number.NaN,
        acceptTerms: body.acceptTerms === true,
      })
      return Response.json(donor)
    }
    if (request.method === 'POST' && path === '/admin/tokens') {
      const body = await readJson(request)
      if (typeof body.donorId !== 'string') return jsonError('donor_required', 400)
      const minted = await broker.mintMcpToken(body.donorId)
      return Response.json(minted)
    }
    if (request.method === 'POST' && path === '/admin/tokens/revoke') {
      const body = await readJson(request)
      if (typeof body.donorId !== 'string') return jsonError('donor_required', 400)
      const revoked = await broker.revokeMcpTokens(body.donorId)
      return Response.json({ revoked })
    }
    if (request.method === 'GET' && path === '/admin/tasks') {
      const project = url.searchParams.get('project') ?? ''
      if (!project) return jsonError('project_required', 400)
      const tasks = await broker.listTasks(project)
      return Response.json({
        tasks: tasks.map((task) => ({
          id: task.id,
          localId: task.localId,
          title: task.title,
          state: task.state,
          donorId: task.donorId,
          providerOverride: task.providerOverride,
          estimatedCostUsd: task.estimatedCostUsd,
          submissionSummary: task.submissionSummary ?? null,
          submissionUrl: task.submissionUrl ?? null,
          submissionPatch: task.submissionPatch ?? null,
        })),
      })
    }
    if (request.method === 'POST' && path === '/admin/submissions/accept') {
      const body = await readJson(request)
      if (typeof body.taskId !== 'string') return jsonError('task_required', 400)
      return Response.json(await broker.acceptSubmission(body.taskId))
    }
    if (request.method === 'POST' && path === '/admin/safety/approve') {
      const body = await readJson(request)
      if (typeof body.taskId !== 'string') return jsonError('task_required', 400)
      return Response.json(await broker.approveSafety(body.taskId))
    }
    if (request.method === 'POST' && path === '/admin/results/pr') {
      const body = await readJson(request)
      if (typeof body.taskId !== 'string') return jsonError('task_required', 400)
      if (typeof body.prUrl !== 'string') return jsonError('pr_required', 400)
      return Response.json(await broker.recordResultUrl(body.taskId, body.prUrl))
    }
    if (request.method === 'POST' && path === '/admin/submissions/reject') {
      const body = await readJson(request)
      if (typeof body.taskId !== 'string') return jsonError('task_required', 400)
      if (typeof body.reason !== 'string') return jsonError('reason_required', 400)
      return Response.json(await broker.rejectSubmission(body.taskId, body.reason))
    }
    if (request.method === 'GET' && path === '/admin/ledger') {
      return Response.json({ rows: await broker.ledger() })
    }
    if (request.method === 'GET' && path === '/admin/impact') {
      const donor = url.searchParams.get('donor') ?? ''
      if (!donor) return jsonError('donor_required', 400)
      return Response.json(await broker.impact(donor))
    }
    return jsonError('not_found', 404)
  } catch (error) {
    if (error instanceof BrokerError || error instanceof ManifestError) {
      return jsonError(error.message, 400)
    }
    if (error instanceof SyntaxError) return jsonError('invalid_json', 400)
    const message = error instanceof Error ? error.message : 'request failed'
    console.error(redact(message))
    return jsonError('request_failed', 500)
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.length === 0) return {}
  const value = JSON.parse(text) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BrokerError('json object required', 'bad_body')
  }
  return value as Record<string, unknown>
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status })
}
