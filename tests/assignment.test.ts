import { describe, expect, it } from 'vitest'

import { createFakeRegistry } from '../src/fake-provider.js'
import { manualClock, registerDonor, setupBroker, writeManifest } from './helpers.js'

function projectYaml(name: string, tasks: string): string {
  return `schemaVersion: 1\nproject:\n  name: ${name}\ntasks:\n${tasks}`
}

const twoTasks = projectYaml(
  'queue',
  `  - id: alpha
    title: Alpha
    instructions: Do alpha.
    acceptance: Alpha is done.
    estimatedCostUsd: 0.04
  - id: beta
    title: Beta
    instructions: Do beta.
    acceptance: Beta is done.
    estimatedCostUsd: 0.04
    dependsOn: [alpha]
`,
)

describe('assignment', () => {
  it('gives a task to one donor and refuses a second claim', async () => {
    const { broker, store } = setupBroker()
    const project = await broker.registerProject({ manifestPath: writeManifest(twoTasks) })
    const ada = await registerDonor(broker, { name: 'ada', provider: 'anthropic', apiKey: 'sk-ant-api03-ada-key-111111111111' })
    const bea = await registerDonor(broker, { name: 'bea', provider: 'anthropic', apiKey: 'sk-ant-api03-bea-key-222222222222' })
    const alpha = project.tasks.find((task) => task.localId === 'alpha')
    const beta = project.tasks.find((task) => task.localId === 'beta')
    if (!alpha || !beta) throw new Error('missing tasks')
    expect(await broker.claim(ada.id, beta.id)).toMatchObject({ ok: false, reason: 'blocked' })
    expect((await broker.claim(ada.id, alpha.id)).ok).toBe(true)
    expect(await broker.claim(bea.id, alpha.id)).toMatchObject({ ok: false, reason: 'not_open' })
    const run = await broker.run(ada.id, alpha.id)
    expect(run.ok).toBe(true)
    expect((await store.getTask(beta.id))?.state).toBe('open')
    expect((await broker.claim(bea.id, beta.id)).ok).toBe(true)
    await store.close()
  })

  it('returns an abandoned claim to the open pool after the lease', async () => {
    const clock = manualClock(1_000_000)
    const { broker, store } = setupBroker({ now: clock.now, leaseMs: 1_000 })
    const project = await broker.registerProject({ manifestPath: writeManifest(twoTasks) })
    const ada = await registerDonor(broker, { name: 'ada', provider: 'openai', apiKey: 'sk-ada-lease-key-333333333333' })
    const bea = await registerDonor(broker, { name: 'bea', provider: 'openai', apiKey: 'sk-bea-lease-key-444444444444' })
    const alpha = project.tasks[0]
    if (!alpha) throw new Error('missing task')
    expect((await broker.claim(ada.id, alpha.id)).ok).toBe(true)
    clock.advance(1_001)
    expect((await broker.claim(bea.id, alpha.id)).ok).toBe(true)
    const late = await broker.run(ada.id, alpha.id)
    expect(late).toMatchObject({ ok: false, status: 'not_run', reason: 'not_claimed' })
    expect((await store.getDonor(ada.id))?.reservedUsd).toBe(0)
    expect((await store.getDonor(bea.id))?.reservedUsd).toBe(0.04)
    await store.close()
  })

  it('keeps a task on the provider the project asked for', async () => {
    const manifest = writeManifest(projectYaml(
      'providers',
      `  - id: note
    title: Note
    provider: openai
    instructions: Write a note.
    acceptance: A note exists.
    estimatedCostUsd: 0.02
`,
    ))
    const { broker, store } = setupBroker()
    const project = await broker.registerProject({ manifestPath: manifest })
    const ada = await registerDonor(broker, { name: 'ada', provider: 'anthropic', apiKey: 'sk-ant-api03-ada-key-555555555555' })
    const byron = await registerDonor(broker, { name: 'byron', provider: 'openai', apiKey: 'sk-byron-openai-key-666666666666' })
    const note = project.tasks[0]
    if (!note) throw new Error('missing task')
    expect(await broker.claim(ada.id, note.id)).toMatchObject({ ok: false, reason: 'provider_mismatch' })
    expect(await broker.claimNext(ada.id)).toMatchObject({ ok: false, reason: 'none_available' })
    expect((await broker.claim(byron.id, note.id)).ok).toBe(true)
    await store.close()
  })

  it('holds the spending cap until the task finishes or fails', async () => {
    const manifest = writeManifest(projectYaml(
      'budget',
      `  - id: first
    title: First
    instructions: First.
    acceptance: FORCE_REJECT this once.
    estimatedCostUsd: 0.04
  - id: second
    title: Second
    instructions: Second.
    acceptance: Second is done.
    estimatedCostUsd: 0.04
`,
    ))
    const { broker, store } = setupBroker()
    const project = await broker.registerProject({ manifestPath: manifest })
    const ada = await registerDonor(broker, {
      name: 'ada',
      provider: 'google',
      apiKey: 'AIzaSyADABUDGETKEY0000000000000000',
      spendingCapUsd: 0.05,
    })
    const first = project.tasks.find((task) => task.localId === 'first')
    const second = project.tasks.find((task) => task.localId === 'second')
    if (!first || !second) throw new Error('missing tasks')
    expect((await broker.claim(ada.id, first.id)).ok).toBe(true)
    expect(await broker.claim(ada.id, second.id)).toMatchObject({ ok: false, reason: 'spending_cap_exceeded' })
    const failed = await broker.run(ada.id, first.id)
    expect(failed.ok).toBe(false)
    expect((await store.getDonor(ada.id))?.reservedUsd).toBe(0)
    expect((await broker.claim(ada.id, second.id)).ok).toBe(true)
    await store.close()
  })

  it('retries a failed task until the attempt limit', async () => {
    let checks = 0
    const { broker, store } = setupBroker({
      maxAttempts: 2,
      providers: createFakeRegistry({
        anthropic: {
          complete(_apiKey, request) {
            if (!request.prompt.includes('ACCEPTANCE CHECK')) {
              return { text: JSON.stringify({ output: 'work', summary: 'ok' }) }
            }
            checks += 1
            const accepted = checks >= 2
            return { text: JSON.stringify({ accepted, reason: accepted ? 'ok' : 'not yet' }) }
          },
        },
      }),
    })
    const project = await broker.registerProject({
      manifestPath: writeManifest(projectYaml(
        'retry',
        `  - id: once
    title: Once
    instructions: Try.
    acceptance: Eventually.
    estimatedCostUsd: 0.02
`,
      )),
    })
    const ada = await registerDonor(broker, { name: 'ada', provider: 'anthropic', apiKey: 'sk-ant-api03-retry-key-777777777777' })
    const task = project.tasks[0]
    if (!task) throw new Error('missing task')
    expect((await broker.claim(ada.id, task.id)).ok).toBe(true)
    expect((await broker.run(ada.id, task.id)).status).toBe('failed')
    expect(await broker.retry(task.id)).toMatchObject({ ok: true, state: 'open' })
    expect((await broker.claim(ada.id, task.id)).ok).toBe(true)
    expect((await broker.run(ada.id, task.id)).status).toBe('done')
    expect((await store.getTask(task.id))?.state).toBe('done')
    await store.close()
  })
})
