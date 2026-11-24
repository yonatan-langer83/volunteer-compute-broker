import { spawn } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { FakeCall } from '../src/fake-provider.js'
import { createFakeRegistry } from '../src/fake-provider.js'
import { openSqliteStore } from '../src/open-sqlite.js'
import {
  fixtureManifest,
  manualClock,
  readDatabaseText,
  registerDonor,
  repoRoot,
  setupBroker,
  testMasterKeyB64,
  writeManifest,
} from './helpers.js'

const keys = {
  ada: 'sk-ant-api03-ADATESTKEY9f3c1a7b6e2d4c88aaaaaaaa',
  byron: 'sk-proj-BYRONTESTKEY1a2b3c4d5e6f70819999999999',
  cy: 'AIzaSyCYTESTKEYaabbccddeeff001122334455',
}

const dependencies: Record<string, string[]> = {
  inventory: [],
  'license-note': [],
  'readme-section': ['inventory'],
  'release-checklist': ['readme-section', 'license-note'],
}

describe('end-to-end broker', () => {
  it('runs one project across three donors without double assignment or key leaks', async () => {
    const seen: FakeCall[] = []
    const { broker, store, dbPath, logs } = setupBroker({
      providers: createFakeRegistry({
        anthropic: { seen },
        openai: { seen },
        xai: { seen },
        google: { seen },
      }),
    })
    const project = await broker.registerProject({ manifestPath: fixtureManifest })
    const ada = await registerDonor(broker, { name: 'ada', provider: 'anthropic', apiKey: keys.ada })
    const byron = await registerDonor(broker, { name: 'byron', provider: 'openai', apiKey: keys.byron })
    const cy = await registerDonor(broker, { name: 'cy', provider: 'google', apiKey: keys.cy })
    const release = project.tasks.find((task) => task.localId === 'release-checklist')
    if (!release) throw new Error('missing release task')
    expect(await broker.claim(ada.id, release.id)).toMatchObject({ ok: false, reason: 'blocked' })

    const finished = new Set<string>()
    const holders = new Map<string, string>()
    const donors = [ada, byron, cy]
    for (let round = 0; round < 8; round++) {
      let progress = false
      for (const donor of donors) {
        const claim = await broker.claimNext(donor.id)
        if (!claim.ok) continue
        progress = true
        for (const dependency of dependencies[claim.localId] ?? []) {
          expect(finished.has(dependency), `${claim.localId} waited for ${dependency}`).toBe(true)
        }
        expect(holders.has(claim.taskId)).toBe(false)
        holders.set(claim.taskId, donor.id)
        const run = await broker.run(donor.id, claim.taskId)
        expect(run.ok, JSON.stringify(run)).toBe(true)
        finished.add(claim.localId)
        expect((await store.getTask(claim.taskId))?.donorId).toBe(donor.id)
      }
      if (!progress) break
    }

    const tasks = await broker.listTasks(project.id)
    expect(tasks.map((task) => task.state)).toEqual(['done', 'done', 'done', 'done'])
    expect(finished).toEqual(new Set(['inventory', 'license-note', 'readme-section', 'release-checklist']))
    const license = tasks.find((task) => task.localId === 'license-note')
    expect(license?.donorId).toBe(byron.id)
    expect(new Set(holders.values()).size).toBe(3)
    const spent = (await broker.listDonors()).reduce((sum, donor) => sum + donor.spentUsd, 0)
    expect(spent).toBeCloseTo(0.09, 6)
    expect((await broker.listDonors()).every((donor) => donor.reservedUsd === 0)).toBe(true)
    expect(new Set(seen.map((call) => call.apiKey))).toEqual(new Set(Object.values(keys)))

    const publicJson = JSON.stringify({ tasks: await broker.listTasks(project.id), donors: await broker.listDonors(), logs })
    await store.close()
    const dumped = `${publicJson}\n${readDatabaseText(dbPath)}`
    for (const key of Object.values(keys)) expect(dumped).not.toContain(key)
  })

  it('lets only one of several concurrent claims hold a task', async () => {
    const { broker, store, dbPath } = setupBroker()
    const project = await broker.registerProject({
      manifestPath: writeManifest(`schemaVersion: 1
project:
  name: race
tasks:
  - id: only
    title: Only one
    instructions: Do it once.
    acceptance: It was done once.
    estimatedCostUsd: 0.05
`),
    })
    const ada = await registerDonor(broker, { name: 'ada', provider: 'anthropic', apiKey: 'sk-ant-api03-race-ada-key-1212121212' })
    const bea = await registerDonor(broker, { name: 'bea', provider: 'anthropic', apiKey: 'sk-ant-api03-race-bea-key-3434343434' })
    const task = project.tasks[0]
    if (!task) throw new Error('missing task')
    await store.close()

    const donors = [ada.id, bea.id, ada.id, bea.id, ada.id, bea.id]
    const results = await Promise.all(donors.map((donorId) => claimChild(dbPath, task.id, donorId)))
    const wins = results.filter((result) => result === 'WON')
    expect(wins).toHaveLength(1)
    expect(results.filter((result) => result.startsWith('LOST'))).toHaveLength(5)

    const reopened = openSqliteStore(dbPath)
    const stored = await reopened.getTask(task.id)
    expect(stored?.state).toBe('claimed')
    expect([ada.id, bea.id]).toContain(stored?.donorId)
    const winner = await reopened.getDonor(stored?.donorId ?? '')
    const loser = await reopened.getDonor(stored?.donorId === ada.id ? bea.id : ada.id)
    expect(winner?.reservedUsd).toBe(0.05)
    expect(loser?.reservedUsd).toBe(0)
    await reopened.close()
  })

  it('fits monthly budgets, prefers nonprofit work, and flags a task nobody can afford', async () => {
    const clock = manualClock(Date.UTC(2026, 10, 15))
    const minaKey = 'sk-ant-api03-MINABUDGETKEY11111111111111'
    const ottoKey = 'sk-ant-api03-OTTOBUDGETKEY22222222222222'
    const { broker, store, logs } = setupBroker({ now: clock.now })
    const civic = await broker.registerProject({
      manifestPath: writeManifest(`schemaVersion: 1
project:
  name: civic-library
  nonprofit: true
  orgUrl: https://example.org/civic-library
tasks:
  - id: guide
    title: Write the guide
    instructions: Write the short guide.
    acceptance: The guide exists.
    estimatedCostUsd: 0.1
  - id: note
    title: Write the note
    instructions: Write the short note.
    acceptance: The note exists.
    estimatedCostUsd: 0.04
`),
    })
    const shop = await broker.registerProject({
      manifestPath: writeManifest(`schemaVersion: 1
project:
  name: shop-site
tasks:
  - id: poster
    title: Write the poster
    instructions: Write the poster.
    acceptance: The poster exists.
    estimatedCostUsd: 0.1
  - id: rebuild
    title: Rebuild the platform
    instructions: Rebuild everything.
    acceptance: The platform is rebuilt.
    estimatedCostUsd: 50
`),
    })
    const mina = await registerDonor(broker, {
      name: 'mina',
      provider: 'anthropic',
      apiKey: minaKey,
      spendingCapUsd: 0.1,
    })
    const otto = await registerDonor(broker, {
      name: 'otto',
      provider: 'anthropic',
      apiKey: ottoKey,
      spendingCapUsd: 20,
    })

    const flagged = await broker.unplaceable()
    expect(flagged.map((task) => task.localId)).toEqual(['rebuild'])
    expect(flagged[0]).toMatchObject({
      projectName: 'shop-site',
      reason: 'exceeds_every_monthly_budget',
      largestBudgetUsd: 20,
      estimatedCostUsd: 50,
    })
    const rebuild = shop.tasks.find((task) => task.localId === 'rebuild')
    if (!rebuild) throw new Error('missing rebuild')
    expect(await broker.claim(otto.id, rebuild.id)).toMatchObject({ ok: false, reason: 'spending_cap_exceeded' })
    expect((await store.getTask(rebuild.id))?.state).toBe('open')

    const first = await broker.claimNext(mina.id)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.localId).toBe('guide')
    expect(first.projectId).toBe(civic.id)
    expect(await broker.claimNext(mina.id)).toMatchObject({ ok: false, reason: 'spending_cap_exceeded' })
    expect((await broker.run(mina.id, first.taskId)).ok).toBe(true)
    expect(await broker.claimNext(mina.id)).toMatchObject({ ok: false, reason: 'spending_cap_exceeded' })

    clock.set(Date.UTC(2026, 11, 2))
    expect((await broker.listDonors()).find((donor) => donor.id === mina.id)?.spentUsd).toBe(0)
    expect((await broker.listDonors()).find((donor) => donor.id === mina.id)?.budgetPeriod).toBe('2026-12')
    const refilled = await broker.claimNext(mina.id)
    expect(refilled.ok).toBe(true)
    if (!refilled.ok) return
    expect(refilled.localId).toBe('note')

    const poster = await broker.claimNext(otto.id)
    expect(poster.ok).toBe(true)
    if (!poster.ok) return
    expect(poster.localId).toBe('poster')
    expect(await broker.claimNext(otto.id)).toMatchObject({ ok: false, reason: 'spending_cap_exceeded' })
    expect((await store.getTask(rebuild.id))?.donorId).toBeNull()
    expect((await broker.unplaceable()).map((task) => task.localId)).toEqual(['rebuild'])

    const ledger = await broker.ledger()
    expect(ledger).toEqual([
      expect.objectContaining({
        projectName: 'civic-library',
        nonprofit: true,
        localId: 'guide',
        donorName: 'mina',
        provider: 'anthropic',
        spendUsd: 0.1,
        period: '2026-11',
      }),
    ])
    const printed = JSON.stringify({ ledger, flagged, logs })
    expect(printed).not.toContain(minaKey)
    expect(printed).not.toContain(ottoKey)
    await store.close()
  })

  it('keeps a donor on chosen organizations and reports their impact', async () => {
    const riaKey = 'sk-ant-api03-RIAIMPACTKEY333333333333333'
    const unaKey = 'sk-ant-api03-UNAIMPACTKEY444444444444444'
    const { broker } = setupBroker()
    const alpha = await broker.registerProject({
      manifestPath: writeManifest(`schemaVersion: 1
project:
  name: alpha-clinic
  nonprofit: true
  orgUrl: https://example.org/alpha-clinic
tasks:
  - id: a1
    title: First clinic note
    instructions: Write the first note.
    acceptance: The note exists.
    estimatedCostUsd: 0.05
  - id: a2
    title: Second clinic note
    instructions: Write the second note.
    acceptance: The note exists.
    estimatedCostUsd: 0.05
`),
    })
    const beta = await broker.registerProject({
      manifestPath: writeManifest(`schemaVersion: 1
project:
  name: beta-shop
tasks:
  - id: b1
    title: First shop note
    instructions: Write the shop note.
    acceptance: The note exists.
    estimatedCostUsd: 0.05
  - id: b2
    title: Second shop note
    instructions: Write the other shop note.
    acceptance: The note exists.
    estimatedCostUsd: 0.05
`),
    })
    const ria = await registerDonor(broker, { name: 'ria', provider: 'anthropic', apiKey: riaKey, spendingCapUsd: 5 })
    const una = await registerDonor(broker, { name: 'una', provider: 'anthropic', apiKey: unaKey, spendingCapUsd: 5 })
    await broker.setSupport(ria.id, ['alpha-clinic'])

    const first = await broker.claimNext(ria.id)
    const second = await broker.claimNext(ria.id)
    expect(first.ok && first.localId).toBe('a1')
    expect(second.ok && second.localId).toBe('a2')
    expect(first.ok && first.projectId).toBe(alpha.id)
    expect(await broker.claimNext(ria.id)).toMatchObject({ ok: false, reason: 'project_not_supported' })
    const blocked = beta.tasks.find((task) => task.localId === 'b1')
    if (!blocked || !first.ok || !second.ok) throw new Error('missing claim')
    expect(await broker.claim(ria.id, blocked.id)).toMatchObject({ ok: false, reason: 'project_not_supported' })

    const unaFirst = await broker.claimNext(una.id)
    expect(unaFirst.ok && unaFirst.localId).toBe('b1')
    if (!unaFirst.ok) throw new Error('una did not claim')
    expect(unaFirst.projectId).toBe(beta.id)

    await broker.setSupport(ria.id, ['beta-shop'])
    const changed = await broker.claimNext(ria.id)
    expect(changed.ok && changed.localId).toBe('b2')
    if (!changed.ok) throw new Error('ria did not claim beta')
    await broker.setSupport(ria.id, [])
    expect(await broker.supportNames(ria.id)).toEqual([])

    const runs = [
      { donorId: ria.id, taskId: first.taskId },
      { donorId: ria.id, taskId: second.taskId },
      { donorId: una.id, taskId: unaFirst.taskId },
      { donorId: ria.id, taskId: changed.taskId },
    ]
    for (const run of runs) expect((await broker.run(run.donorId, run.taskId)).ok).toBe(true)

    const riaImpact = await broker.impact(ria.id)
    expect(riaImpact.donorName).toBe('ria')
    expect(riaImpact.tasksCompleted).toBe(3)
    expect(riaImpact.estimatedSpendUsd).toBeCloseTo(0.15, 6)
    expect(riaImpact.organizations.map((org) => org.name)).toEqual(['alpha-clinic', 'beta-shop'])
    expect(riaImpact.organizations[0]).toMatchObject({
      nonprofit: true,
      orgUrl: 'https://example.org/alpha-clinic',
      tasks: 2,
    })
    expect(riaImpact.projectsFullyDone).toEqual(['alpha-clinic', 'beta-shop'])

    const unaImpact = await broker.impact(una.id)
    expect(unaImpact.tasksCompleted).toBe(1)
    expect(unaImpact.estimatedSpendUsd).toBeCloseTo(0.05, 6)
    expect(unaImpact.organizations.map((org) => org.name)).toEqual(['beta-shop'])
    expect(unaImpact.projectsFullyDone).toEqual(['beta-shop'])

    const printed = JSON.stringify({ riaImpact, unaImpact })
    expect(printed).not.toContain(riaKey)
    expect(printed).not.toContain(unaKey)
  })

  it('redacts a provider error that contains the donor key', async () => {
    const key = 'donor-secret-ZZZZ-e2e-error-path-998877'
    const { broker, store, dbPath, logs } = setupBroker({
      hooks: {
        xai: {
          complete(apiKey) {
            throw new Error(`socket reset while using ${apiKey}`)
          },
        },
      },
    })
    const project = await broker.registerProject({
      manifestPath: writeManifest(`schemaVersion: 1
project:
  name: e2e-error
tasks:
  - id: boom
    title: Boom
    instructions: Fail loudly.
    acceptance: It does not.
    estimatedCostUsd: 0.02
`),
    })
    const donor = await registerDonor(broker, { name: 'dee', provider: 'xai', apiKey: key })
    const task = project.tasks[0]
    if (!task) throw new Error('missing task')
    expect((await broker.claim(donor.id, task.id)).ok).toBe(true)
    const run = await broker.run(donor.id, task.id)
    expect(run.ok).toBe(false)
    if (run.ok) return
    expect(run.reason).toContain('[REDACTED]')
    expect(run.reason).not.toContain(key)
    expect(logs.join('\n')).not.toContain(key)
    expect(JSON.stringify(await broker.listDonors())).not.toContain(key)
    await store.close()
    expect(readDatabaseText(dbPath)).not.toContain(key)
  })
})

function claimChild(dbPath: string, taskId: string, donorId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      BROKER_MASTER_KEY: testMasterKeyB64(),
      NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
    }
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(repoRoot, 'tests/claim-child.ts'), dbPath, taskId, donorId], {
      cwd: repoRoot,
      env,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claim child exited ${code}: ${stderr || stdout}`))
        return
      }
      resolve(stdout.trim())
    })
  })
}
