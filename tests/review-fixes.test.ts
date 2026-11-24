import { describe, expect, it } from 'vitest'

import { mcpLeaseMs } from '../src/broker.js'
import { loadPublicBoard } from '../src/public-board.js'
import { setupBroker, writeManifest } from './helpers.js'

const manifest = `schemaVersion: 1
project:
  name: pantry
  nonprofit: true
  github: https://github.com/example/pantry
tasks:
  - id: hours
    title: Fix the overnight hours
    instructions: Change the hour function.
    acceptance: The overnight case is four hours.
    estimatedCostUsd: 0.05
`

async function claimedTask() {
  const { broker, store } = setupBroker()
  await broker.registerProject({ manifestPath: writeManifest(manifest) })
  const donor = await broker.registerMcpDonor({ name: 'ada', monthlyTasks: 5, acceptTerms: true })
  expect((await broker.requestWork(donor.id, 1, 'small')).ok).toBe(true)
  const claim = await broker.claimNext(donor.id)
  if (!claim.ok) throw new Error(`claim failed: ${claim.reason}`)
  return { broker, store, donor, claim }
}

describe('review fixes', () => {
  it('gives volunteer AI claims a size-based lease', async () => {
    const { claim } = await claimedTask()
    const left = claim.leaseUntil - Date.now()
    expect(left).toBeGreaterThan(40 * 60 * 1000)
    expect(left).toBeLessThanOrEqual(mcpLeaseMs('small'))
  })

  it('lets the holder extend the claim and nobody else', async () => {
    const { broker, donor, claim } = await claimedTask()
    const other = await broker.registerMcpDonor({ name: 'bea', monthlyTasks: 5, acceptTerms: true })
    expect((await broker.keepWorking(other.id, claim.taskId)).ok).toBe(false)
    const kept = await broker.keepWorking(donor.id, claim.taskId)
    expect(kept.ok).toBe(true)
  })

  it('keeps unreviewed submissions off the public board until accepted', async () => {
    const { broker, store, donor, claim } = await claimedTask()
    const submitted = await broker.submitResult(donor.id, claim.taskId, {
      summary: 'Fixed the hours',
      prUrl: 'https://evil.example/phish',
      patch: '--- a/hours\n+++ b/hours\n',
    })
    expect(submitted.ok).toBe(true)
    let task = (await loadPublicBoard(store)).projects[0]!.tasks[0]!
    expect(task.prUrl).toBeNull()
    expect(task.patchPath).toBeNull()
    expect((await broker.acceptSubmission(claim.taskId)).ok).toBe(true)
    task = (await loadPublicBoard(store)).projects[0]!.tasks[0]!
    expect(task.patchPath).not.toBeNull()
  })
})

describe('brief consistency', () => {
  it('rejects a do list that the instructions never mention', async () => {
    const { broker } = setupBroker()
    const bad = `schemaVersion: 1
project:
  name: pantry
  github: https://github.com/example/pantry
tasks:
  - id: hours
    title: Fix the overnight hours
    goal: Fix the hours.
    size: small
    instructions: Change pantry/shifts.py so overnight shifts count forward.
    acceptance: The overnight case is four hours.
    tests: [python -m pytest]
    do: [README.md]
    don't: [Do not add a dependency.]
    deliverable: A diff.
    estimatedCostUsd: 0.05
`
    await expect(broker.registerProject({ manifestPath: writeManifest(bad) })).rejects.toThrow(/do names README.md/)
  })
})

describe('submitted patches', () => {
  it('stores a diff that ends with a newline so git apply accepts it', async () => {
    const { broker, store, donor, claim } = await claimedTask()
    await broker.submitResult(donor.id, claim.taskId, { summary: 'done', patch: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b' })
    const task = await store.getTask(claim.taskId)
    expect(task?.submissionPatch?.endsWith('+b\n')).toBe(true)
  })
})
