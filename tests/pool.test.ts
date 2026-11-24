import { describe, expect, it } from 'vitest'

import { loadPublicBoard, renderPublicHtml } from '../src/public-board.js'
import { setupBroker, writeManifest } from './helpers.js'

describe('two-project volunteer pool', () => {
  it('assigns each task once, keeps sessions, support, and the public history', async () => {
    const { broker, store } = setupBroker()
    const pantry = await broker.registerProject({
      manifestPath: writeManifest(`schemaVersion: 1
project:
  name: pantry
  nonprofit: true
  orgUrl: https://example.org/pantry
  github: https://github.com/example/pantry
tasks:
  - id: hours
    title: Fix the overnight hours
    instructions: Change the hour function.
    acceptance: The overnight case is four hours.
    estimatedCostUsd: 0.05
  - id: note
    title: Note the hour rule
    instructions: Write the note.
    acceptance: The note mentions four hours.
    estimatedCostUsd: 0.05
  - id: report
    title: Report the overlaps
    instructions: Report overlaps after hours are fixed.
    acceptance: The report lists the overlap.
    dependsOn: [hours]
    estimatedCostUsd: 0.05
`),
    })
    await broker.registerProject({
      manifestPath: writeManifest(`schemaVersion: 1
project:
  name: shop
tasks:
  - id: poster
    title: Write the poster
    instructions: Write the shop poster.
    acceptance: The poster names the shop.
    estimatedCostUsd: 0.05
`),
    })
    const ada = await broker.registerMcpDonor({ name: 'ada', monthlyTasks: 5, acceptTerms: true })
    const bea = await broker.registerMcpDonor({ name: 'bea', monthlyTasks: 5, acceptTerms: true })
    const cy = await broker.registerMcpDonor({ name: 'cy', monthlyTasks: 5, acceptTerms: true })
    await broker.setSupport(ada.id, ['pantry'])

    expect(await broker.requestWork(ada.id, 1, 'small')).toMatchObject({ ok: true })
    const adaFirst = await broker.claimNext(ada.id)
    expect(adaFirst.ok).toBe(true)
    if (!adaFirst.ok) return
    expect(adaFirst.projectId).toBe(pantry.id)
    expect(await broker.claim(bea.id, adaFirst.taskId)).toMatchObject({ ok: false })
    expect(await broker.requestWork(bea.id, 2, 'small')).toMatchObject({ ok: true })
    const beaBlocked = await broker.claim(bea.id, adaFirst.taskId)
    expect(beaBlocked.ok).toBe(false)
    expect((await broker.submitResult(ada.id, adaFirst.taskId, { summary: 'Fixed the hours', patch: '--- a/hours\n+++ b/hours\n' })).ok).toBe(true)
    expect(await broker.claimNext(ada.id)).toMatchObject({ ok: false, reason: 'session_complete' })

    const beaFirst = await broker.claimNext(bea.id)
    expect(beaFirst.ok).toBe(true)
    if (!beaFirst.ok) return
    expect(beaFirst.projectId).toBe(pantry.id)
    expect(beaFirst.taskId).not.toBe(adaFirst.taskId)
    expect((await broker.submitResult(bea.id, beaFirst.taskId, { summary: 'Wrote the note', prUrl: 'https://example.com/pantry/pull/2' })).ok).toBe(true)
    const beaSecond = await broker.claimNext(bea.id)
    expect(beaSecond.ok).toBe(true)
    if (!beaSecond.ok) return
    expect(beaSecond.localId).toBe('poster')
    expect(await broker.claimNext(bea.id)).toMatchObject({ ok: false, reason: 'already_holding' })
    expect((await broker.release(bea.id, beaSecond.taskId, 'the poster brief is unclear')).ok).toBe(true)
    expect(await broker.claimNext(bea.id)).toMatchObject({ ok: true, localId: 'poster' })

    expect(await broker.requestWork(cy.id, 1, 'small')).toMatchObject({ ok: true })
    expect(await broker.claimNext(cy.id)).toMatchObject({ ok: false, reason: 'none_available' })
    expect((await broker.acceptSubmission(adaFirst.taskId)).ok).toBe(true)
    const cyTask = await broker.claimNext(cy.id)
    expect(cyTask).toMatchObject({ ok: true, localId: 'report' })

    const held = new Set<string>()
    for (const project of await broker.listProjects()) {
      for (const task of await broker.listTasks(project.id)) {
        if (!task.donorId || task.state === 'open' || task.state === 'blocked') continue
        expect(held.has(task.id)).toBe(false)
        held.add(task.id)
      }
    }

    const board = await loadPublicBoard(store)
    const page = renderPublicHtml(board)
    expect(page).toContain('pantry')
    expect(page).toContain('ada')
    expect(page).toContain('https://example.com/pantry/pull/2')
    const hours = board.projects.find((project) => project.name === 'pantry')?.tasks.find((task) => task.localId === 'hours')
    expect(hours).toMatchObject({ state: 'done', donorHandle: 'ada' })
    expect(hours?.patchPath).toContain('/public/tasks/')
    const note = board.projects.find((project) => project.name === 'pantry')?.tasks.find((task) => task.localId === 'note')
    expect(note?.state).not.toBe('done')
    expect(page).not.toContain('vbk_')
    await store.close()
  })
})