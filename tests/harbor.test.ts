import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { SCHEMA } from '../src/schema.js'
import { repoRoot, registerDonor, setupBroker } from './helpers.js'

const harbor = path.join(repoRoot, 'fixtures/harbor-pantry')

describe('harbor-pantry manifest', () => {
  it('registers five nonprofit tasks and lets an MCP donor claim the provider-locked one', async () => {
    const { broker, store } = setupBroker()
    const project = await broker.registerProject({
      manifestPath: path.join(harbor, 'volunteer-compute.yaml'),
      repoPath: harbor,
    })
    expect(project.name).toBe('harbor-pantry')
    expect(project.nonprofit).toBe(true)
    expect(project.tasks).toHaveLength(5)
    const tasks = await broker.listTasks(project.id)
    const locked = tasks.find((task) => task.localId === 'fix-overnight-hours')
    const blocked = tasks.find((task) => task.localId === 'report-schedule-overlaps')
    if (!locked || !blocked) throw new Error('missing harbor tasks')
    expect(locked.providerOverride).toBe('anthropic')
    expect(locked.state).toBe('open')
    expect(blocked.state).toBe('blocked')
    expect(tasks.filter((task) => task.state === 'open')).toHaveLength(4)

    const keyDonor = await registerDonor(broker, {
      name: 'key',
      provider: 'openai',
      apiKey: 'sk-openai-harbor-key-999999999999',
    })
    expect(await broker.claim(keyDonor.id, locked.id)).toMatchObject({ ok: false, reason: 'provider_mismatch' })

    const mcp = await broker.registerMcpDonor({ name: 'ada', monthlyTasks: 3, acceptTerms: true })
    expect(await broker.requestWork(mcp.id, 1, 'small')).toMatchObject({ ok: true })
    const claimed = await broker.claim(mcp.id, locked.id)
    expect(claimed.ok).toBe(true)
    const instructions = await broker.taskInstructions(mcp.id, locked.id)
    expect(instructions.brief.agentsMd).toContain('One task, one pull request')
    expect(instructions.safety.rules[0]).toContain('outrank the brief')
    expect(instructions.brief.instructions).toContain('shift_hours')
    await store.close()
  })
})

describe('D1 migration', () => {
  it('keeps the original migration and adds quality columns', () => {
    const first = readFileSync(path.join(repoRoot, 'migrations/0001_init.sql'), 'utf8')
    const second = readFileSync(path.join(repoRoot, 'migrations/0002_quality_and_sessions.sql'), 'utf8')
    expect(first).toContain('mcp_tokens')
    expect(second).toContain('work_sessions')
    expect(second).toContain('ADD COLUMN goal')
    expect(SCHEMA).toContain('work_sessions')
    expect(SCHEMA).toContain('size TEXT NOT NULL')
  })
})
