import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { unstable_dev, type Unstable_DevWorker } from 'wrangler'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { repoRoot, testMasterKeyB64 } from './helpers.js'

const ADMIN = 'admin-test-token'
const outdir = path.join(repoRoot, 'dist/worker')

let worker: Unstable_DevWorker

beforeAll(async () => {
  execFileSync('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', outdir], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  })
  worker = await unstable_dev(path.join(repoRoot, 'src/worker.ts'), {
    config: path.join(repoRoot, 'wrangler.jsonc'),
    local: true,
    persist: false,
    vars: {
      BROKER_MASTER_KEY: testMasterKeyB64(),
      ADMIN_TOKEN: ADMIN,
    },
    experimental: { disableExperimentalWarning: true, forceLocal: true },
    logLevel: 'error',
  })
}, 180_000)

afterAll(async () => {
  await worker?.stop()
})

describe('worker fetch', () => {
  it('serializes a claim race in the Durable Object and refuses a bad admin token', async () => {
    const manifest = readFileSync(path.join(repoRoot, 'fixtures/harbor-pantry/volunteer-compute.yaml'), 'utf8')
    const agentsMd = readFileSync(path.join(repoRoot, 'fixtures/harbor-pantry/AGENTS.md'), 'utf8')
    const missing = await worker.fetch('/admin/tasks?project=x')
    expect(missing.status).toBe(401)
    const wrongToken = 'wrong-admin-token'
    const wrong = await worker.fetch('/admin/ledger', {
      headers: { authorization: `Bearer ${wrongToken}` },
    })
    expect(wrong.status).toBe(401)
    expect(await wrong.text()).not.toContain(wrongToken)

    const registered = await admin('/admin/projects', {
      method: 'POST',
      body: { manifest, agentsMd },
    })
    const tasks = asTasks(registered.tasks)
    const boardResponse = await worker.fetch('/public.json')
    expect(boardResponse.status).toBe(200)
    const boardText = await boardResponse.text()
    expect(boardText).toContain('harbor-pantry')
    expect(boardText).not.toContain('vbk_')
    expect(registered.name).toBe('harbor-pantry')
    expect(tasks).toHaveLength(6)
    const locked = tasks.find((task) => task.localId === 'fix-overnight-hours')
    if (!locked) throw new Error('missing locked task')

    const ada = await admin('/admin/mcp-donors', {
      method: 'POST',
      body: { name: 'ada', monthlyTasks: 3, acceptTerms: true },
    })
    const bea = await admin('/admin/mcp-donors', {
      method: 'POST',
      body: { name: 'bea', monthlyTasks: 3, acceptTerms: true },
    })
    const adaToken = String((await admin('/admin/tokens', { method: 'POST', body: { donorId: ada.id } })).token)
    const beaToken = String((await admin('/admin/tokens', { method: 'POST', body: { donorId: bea.id } })).token)
    const left = await connect(adaToken)
    const right = await connect(beaToken)
    expect((await callJson<{ ok: boolean }>(left, 'request_work', { count: 1, size: 'small' })).ok).toBe(true)
    expect((await callJson<{ ok: boolean }>(right, 'request_work', { count: 1, size: 'small' })).ok).toBe(true)
    const [leftClaim, rightClaim] = await Promise.all([
      callJson<{ ok: boolean }>(left, 'claim_task', { task_id: locked.id }),
      callJson<{ ok: boolean }>(right, 'claim_task', { task_id: locked.id }),
    ])
    expect([leftClaim, rightClaim].filter((result) => result.ok)).toHaveLength(1)
    const listed = await admin(`/admin/tasks?project=${encodeURIComponent(String(registered.id))}`)
    const stored = asTasks(listed.tasks).find((task) => task.id === locked.id)
    expect(stored?.state).toBe('claimed')
    await left.close()
    await right.close()
  }, 60_000)
})

async function admin(pathname: string, init?: { method?: string; body?: unknown }): Promise<Record<string, unknown>> {
  const response = await worker.fetch(pathname, {
    method: init?.method ?? 'GET',
    headers: {
      authorization: `Bearer ${ADMIN}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${text}`)
  return JSON.parse(text) as Record<string, unknown>
}

function asTasks(value: unknown): { id: string; localId: string; state: string }[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is { id: string; localId: string; state: string } => {
    return !!item && typeof item === 'object' && 'id' in item && 'localId' in item
  })
}

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'worker-test', version: '0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://${worker.address}:${worker.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  })
  await client.connect(transport)
  return client
}

async function callJson<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as { type: string; text?: string }[]
  const block = content[0]
  if (!block || block.type !== 'text' || !block.text) throw new Error('tool returned no text')
  return JSON.parse(block.text) as T
}
