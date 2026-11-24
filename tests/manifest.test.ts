import { describe, expect, it } from 'vitest'

import { findCycle, loadManifest, ManifestError } from '../src/manifest.js'
import { BrokerError } from '../src/types.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { fixtureManifest, setupBroker, writeManifest } from './helpers.js'

function writeRaw(body: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'raw-manifest-'))
  const file = path.join(dir, 'volunteer-compute.yaml')
  writeFileSync(file, body)
  return file
}

const valid = `schemaVersion: 1
project:
  name: sample
tasks:
  - id: one
    title: First
    instructions: Do the first thing.
    acceptance: It is done.
  - id: two
    title: Second
    instructions: Do the second thing.
    acceptance: It follows the first.
    dependsOn: [one]
`

describe('manifest', () => {
  it('loads the sample fixture and blocks tasks that wait on others', () => {
    const manifest = loadManifest(fixtureManifest)
    expect(manifest.project.name).toBe('leaflet-docs')
    expect(manifest.project.nonprofit).toBe(true)
    expect(manifest.project.orgUrl).toBe('https://example.org/leaflet-docs')
    expect(manifest.tasks.map((task) => task.id)).toEqual([
      'inventory',
      'license-note',
      'readme-section',
      'release-checklist',
    ])
    expect(manifest.tasks.find((task) => task.id === 'license-note')?.provider).toBe('openai')
    expect(manifest.tasks.find((task) => task.id === 'release-checklist')?.dependsOn).toEqual([
      'readme-section',
      'license-note',
    ])
  })

  it('rejects a dependency cycle before anything is stored', async () => {
    const cycle = findCycle([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] },
    ])
    expect(cycle).toEqual(['a', 'b', 'a'])
    const cyclic = writeManifest(`schemaVersion: 1
project:
  name: cyclic
tasks:
  - id: alpha
    title: Alpha
    instructions: Start.
    acceptance: Started.
    dependsOn: [beta]
  - id: beta
    title: Beta
    instructions: Finish.
    acceptance: Finished.
    dependsOn: [alpha]
`)
    expect(() => loadManifest(cyclic)).toThrow(ManifestError)
    expect(() => loadManifest(cyclic)).toThrow(/dependency cycle: alpha -> beta -> alpha/)
    const { broker, store } = setupBroker()
    await expect(broker.registerProject({ manifestPath: cyclic })).rejects.toThrow(BrokerError)
    expect(await broker.listProjects()).toEqual([])
    await store.close()
  })

  it('rejects a vague task with a specific message', () => {
    const vague = writeRaw(`schemaVersion: 1
project:
  name: vague-project
tasks:
  - id: fix
    title: Fix it
    goal: Fix it.
    instructions: Fix it.
    acceptance: done
    tests: tests
    do:
      - etc
    don't:
      - no
    deliverable: something
    size: small
    estimatedCostUsd: 0.05
`)
    expect(() => loadManifest(vague)).toThrow(/goal is too vague/)
    expect(() => loadManifest(vague)).toThrow(/instructions must be steps/)
    expect(() => loadManifest(vague)).toThrow(/tests must be an exact command/)
  })

  it('rejects unknown dependencies and duplicate ids', () => {
    const unknown = writeManifest(valid.replace('dependsOn: [one]', 'dependsOn: [missing]'))
    expect(() => loadManifest(unknown)).toThrow(/unknown task missing/)
    const duplicate = writeManifest(`${valid}  - id: one\n    title: Again\n    instructions: Again.\n    acceptance: Again.\n`)
    expect(() => loadManifest(duplicate)).toThrow(/duplicate task id one/)
  })
})
