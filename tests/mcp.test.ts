import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { describe, expect, it } from 'vitest'

import { completeManifest, readDatabaseText, setupBroker } from './helpers.js'

describe('MCP server', () => {
  it('claims, submits, and waits for acceptance before the work counts', async () => {
    const tokenBox: { value: string } = { value: '' }
    const { broker, store, dbPath, logs, url, close } = await startFixture()
    const riaId = (await broker.listDonors()).find((donor) => donor.name === 'ria')?.id ?? ''
    tokenBox.value = (await broker.mintMcpToken(riaId)).token
    const ria = (await broker.listDonors()).find((donor) => donor.name === 'ria')
    if (!ria) throw new Error('missing donor')
    const client = await connect(url, tokenBox.value)
    expect((await callJson<{ ok: boolean }>(client, 'request_work', { count: 4, size: 'small' })).ok).toBe(true)
    const listed = await callJson<{ localId: string }[]>(client, 'list_eligible_tasks', {})
    expect(listed.map((task) => task.localId)).toEqual(['draft'])
    const draft = listed[0]
    if (!draft) throw new Error('missing task')
    const claimed = await callJson<{ ok: boolean; taskId: string }>(client, 'claim_task', { task_id: await taskId(broker, 'alpha-notes', 'draft') })
    expect(claimed.ok).toBe(true)
    const instructions = await callJson<{
      safety: { outranksBrief: boolean; rules: string[] }
      brief: { agentsMd: string; acceptance: string }
    }>(client, 'get_task_instructions', {
      task_id: claimed.taskId,
    })
    expect(instructions.safety.outranksBrief).toBe(true)
    expect(instructions.safety.rules.join('\n')).toContain('outrank the brief')
    expect(instructions.brief.agentsMd).toContain('FOLLOW-AGENTS')
    expect(instructions.brief.acceptance).toContain('two paragraphs')
    const submitted = await callJson<{ ok: boolean }>(client, 'submit_result', {
      task_id: claimed.taskId,
      summary: 'Opened the notes pull request',
      pr_url: 'https://example.com/pull/1',
    })
    expect(submitted.ok).toBe(true)
    expect((await store.getTask(claimed.taskId))?.state).toBe('review')
    const before = await callJson<{ tasksCompleted: number; projectsFullyDone: string[] }>(client, 'my_impact', {})
    expect(before.tasksCompleted).toBe(0)
    expect(await callJson<{ localId: string }[]>(client, 'list_eligible_tasks', {})).toEqual([])
    expect((await broker.acceptSubmission(claimed.taskId)).ok).toBe(true)
    const after = await callJson<{
      tasksCompleted: number
      estimatedSpendUsd: number
      organizations: { name: string }[]
      projectsFullyDone: string[]
    }>(client, 'my_impact', {})
    expect(after.tasksCompleted).toBe(1)
    expect(after.estimatedSpendUsd).toBeCloseTo(0.05, 6)
    expect(after.organizations.map((org) => org.name)).toEqual(['alpha-notes'])
    expect(after.projectsFullyDone).toEqual([])
    const next = await callJson<{ localId: string; taskId: string }[]>(client, 'list_eligible_tasks', {})
    expect(next.map((task) => task.localId)).toEqual(['publish'])
    const publish = next[0]
    if (!publish) throw new Error('missing publish')
    expect((await callJson<{ ok: boolean }>(client, 'claim_task', { task_id: publish.taskId })).ok).toBe(true)
    expect(
      (await callJson<{ ok: boolean }>(client, 'submit_result', {
        task_id: publish.taskId,
        summary: 'Published the notes',
        patch: 'notes.md',
      })).ok,
    ).toBe(true)
    expect((await broker.acceptSubmission(publish.taskId)).ok).toBe(true)
    const finished = await callJson<{ tasksCompleted: number; projectsFullyDone: string[] }>(client, 'my_impact', {})
    expect(finished.tasksCompleted).toBe(2)
    expect(finished.projectsFullyDone).toEqual(['alpha-notes'])
    await client.close()
    await close()
    await store.close()
    const dumped = `${logs.join('\n')}\n${readDatabaseText(dbPath)}`
    expect(dumped).not.toContain(tokenBox.value)
  })

  it('lets one of two racing clients claim a task and refuses bad or revoked tokens', async () => {
    const { broker, store, dbPath, logs, url, close } = await startFixture()
    const donors = await broker.listDonors()
    const ria = donors.find((donor) => donor.name === 'ria')
    const una = donors.find((donor) => donor.name === 'una')
    if (!ria || !una) throw new Error('missing donors')
    const riaToken = (await broker.mintMcpToken(ria.id)).token
    const unaToken = (await broker.mintMcpToken(una.id)).token
    const task = await taskId(broker, 'alpha-notes', 'draft')
    const riaClient = await connect(url, riaToken)
    const unaClient = await connect(url, unaToken)
    expect((await callJson<{ ok: boolean }>(riaClient, 'request_work', { count: 1, size: 'small' })).ok).toBe(true)
    expect((await callJson<{ ok: boolean }>(unaClient, 'request_work', { count: 1, size: 'small' })).ok).toBe(true)
    const [left, right] = await Promise.all([
      callJson<{ ok: boolean; reason?: string }>(riaClient, 'claim_task', { task_id: task }),
      callJson<{ ok: boolean; reason?: string }>(unaClient, 'claim_task', { task_id: task }),
    ])
    const wins = [left, right].filter((result) => result.ok)
    expect(wins).toHaveLength(1)
    expect((await store.getTask(task))?.state).toBe('claimed')

    const refused = await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer vbk_not-a-real-token-000000', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    })
    expect(refused.status).toBe(401)
    expect(await refused.text()).not.toContain('vbk_not-a-real-token-000000')

    expect(await broker.revokeMcpTokens(una.id)).toBeGreaterThan(0)
    const revoked = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${unaToken}`, 'content-type': 'application/json' },
      body: '{}',
    })
    expect(revoked.status).toBe(401)
    await close()
    await store.close()
    const dumped = `${logs.join('\n')}\n${readDatabaseText(dbPath)}`
    expect(dumped).not.toContain(riaToken)
    expect(dumped).not.toContain(unaToken)
  })
})

async function startFixture(): Promise<{
  broker: ReturnType<typeof setupBroker>['broker']
  store: ReturnType<typeof setupBroker>['store']
  dbPath: string
  logs: string[]
  url: string
  close: () => Promise<void>
}> {
  const { broker, store, dbPath, logs } = setupBroker()
  const dir = mkdtempSync(path.join(tmpdir(), 'mcp-repo-'))
  const manifest = path.join(dir, 'volunteer-compute.yaml')
  writeFileSync(
    manifest,
    completeManifest(`schemaVersion: 1
project:
  name: alpha-notes
  nonprofit: true
  orgUrl: https://example.org/alpha-notes
tasks:
  - id: draft
    title: Draft the notes
    instructions: Write the notes.
    acceptance: The notes are two paragraphs.
    estimatedCostUsd: 0.05
  - id: publish
    title: Publish the notes
    instructions: Publish after the draft.
    acceptance: The notes are public.
    dependsOn: [draft]
    estimatedCostUsd: 0.05
`),
  )
  writeFileSync(path.join(dir, 'AGENTS.md'), 'FOLLOW-AGENTS\nDo the task and stop.\n')
  await broker.registerProject({ manifestPath: manifest, repoPath: dir })
  await registerMcp(broker, 'ria')
  await registerMcp(broker, 'una')
  const { startMcpHttpServer } = await import('../src/mcp-server.js')
  const running = await startMcpHttpServer({
    broker,
    port: 0,
    logger: {
      info(message) {
        logs.push(`info ${message}`)
      },
      error(message) {
        logs.push(`error ${message}`)
      },
    },
  })
  return { broker, store, dbPath, logs, url: running.url, close: running.close }
}

async function registerMcp(broker: ReturnType<typeof setupBroker>['broker'], name: string): Promise<void> {
  await broker.registerMcpDonor({ name, monthlyTasks: 4, acceptTerms: true })
}

async function taskId(broker: ReturnType<typeof setupBroker>['broker'], projectName: string, localId: string): Promise<string> {
  const project = (await broker.listProjects()).find((item) => item.name === projectName)
  const task = project ? (await broker.listTasks(project.id)).find((item) => item.localId === localId) : undefined
  if (!task) throw new Error(`missing ${localId}`)
  return task.id
}

async function connect(url: string, token: string): Promise<Client> {
  const client = new Client({ name: 'broker-test', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  })
  await client.connect(transport)
  return client
}

async function callJson<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content
  const text = Array.isArray(content) && content[0] && 'text' in content[0] ? String(content[0].text) : ''
  return JSON.parse(text) as T
}
