import { describe, expect, it } from 'vitest'

import { decryptSecret, encryptSecret, loadMasterKey } from '../src/crypto.js'
import { createFakeRegistry } from '../src/fake-provider.js'
import { redact } from '../src/redact.js'
import { readDatabaseText, registerDonor, setupBroker, testMasterKeyB64, writeManifest } from './helpers.js'

const master = loadMasterKey(testMasterKeyB64())
const patterned = 'sk-ant-api03-STORAGETESTKEY999999999999'
const odd = 'donor-secret-ZZZZ-not-a-provider-prefix-884422'

describe('credential handling', () => {
  it('round-trips a key and stores only ciphertext', () => {
    const envelope = encryptSecret(patterned, master)
    const encoded = JSON.stringify(envelope)
    expect(encoded).not.toContain(patterned)
    expect(encoded).toContain('aes-256-gcm')
    expect(decryptSecret(envelope, master)).toBe(patterned)
    const tampered = { ...envelope, data: { ...envelope.data, ct: `${envelope.data.ct.slice(0, 4)}AAAA` } }
    expect(() => decryptSecret(tampered, master)).toThrow(/^decryption failed$/)
    const other = loadMasterKey(Buffer.alloc(32, 9).toString('base64'))
    expect(() => decryptSecret(envelope, other)).toThrow(/^decryption failed$/)
  })

  it('redacts known key shapes and explicit secrets', () => {
    const text = `fail ${patterned} and ${odd} and ?key=${patterned}`
    const cleaned = redact(text, [odd])
    expect(cleaned).not.toContain(patterned)
    expect(cleaned).not.toContain(odd)
    expect(cleaned).toContain('[REDACTED]')
    expect(cleaned).not.toMatch(/key=[^&\s[]/)
  })

  it('does not write a donor key into sqlite, logs, or a returned donor', async () => {
    const { broker, store, dbPath, logs } = setupBroker()
    const donor = await registerDonor(broker, { name: 'ada', provider: 'anthropic', apiKey: patterned })
    expect(JSON.stringify(donor)).not.toContain(patterned)
    expect(JSON.stringify(await broker.listDonors())).not.toContain(patterned)
    expect(logs.join('\n')).not.toContain(patterned)
    const envelope = await store.getEnvelopeJson(donor.id)
    expect(envelope).toBeTruthy()
    expect(envelope ?? '').not.toContain(patterned)
    expect(decryptSecret(JSON.parse(envelope ?? '{}'), master)).toBe(patterned)
    await store.close()
    expect(readDatabaseText(dbPath)).not.toContain(patterned)
  })

  it('does not persist a key that fails validation', async () => {
    const key = 'invalid-key-abcdefghijklmnop'
    const { broker, store, dbPath, logs } = setupBroker()
    await expect(
      registerDonor(broker, { name: 'ada', provider: 'anthropic', apiKey: key }),
    ).rejects.toThrow(/api_key_rejected/)
    expect(await broker.listDonors()).toEqual([])
    expect(logs.join('\n')).not.toContain(key)
    await store.close()
    expect(readDatabaseText(dbPath)).not.toContain(key)
  })

  it('checks local rules before asking the provider', async () => {
    let called = false
    const { broker, store } = setupBroker({
      providers: createFakeRegistry({
        anthropic: {
          validateKey() {
            called = true
            return { ok: true }
          },
        },
      }),
    })
    await expect(
      registerDonor(broker, { name: 'ada', provider: 'anthropic', apiKey: patterned, acceptTerms: false }),
    ).rejects.toThrow(/terms_not_accepted/)
    expect(called).toBe(false)
    await store.close()
  })

  it('redacts a key echoed by the model and a key thrown by the provider', async () => {
    const manifest = writeManifest(`schemaVersion: 1
project:
  name: leak-check
tasks:
  - id: work
    title: Write a note
    instructions: Write a note.
    acceptance: A note exists.
    estimatedCostUsd: 0.02
`)
    const { broker, store, dbPath, logs } = setupBroker({
      hooks: {
        anthropic: {
          complete(apiKey, request) {
            if (request.prompt.includes('ACCEPTANCE CHECK')) {
              expect(request.prompt).not.toContain(odd)
              return { text: JSON.stringify({ accepted: true, reason: 'ok' }) }
            }
            return { text: JSON.stringify({ output: `see ${apiKey}`, summary: apiKey }) }
          },
        },
      },
    })
    const project = await broker.registerProject({ manifestPath: manifest })
    const donor = await registerDonor(broker, { name: 'ada', provider: 'anthropic', apiKey: odd })
    const task = project.tasks[0]
    if (!task) throw new Error('missing task')
    expect((await broker.claim(donor.id, task.id)).ok).toBe(true)
    const run = await broker.run(donor.id, task.id)
    expect(run.ok).toBe(true)
    if (!run.ok) return
    expect(run.output).not.toContain(odd)
    expect((await store.getTask(task.id))?.result ?? '').not.toContain(odd)
    expect(logs.join('\n')).not.toContain(odd)

    const failing = writeManifest(`schemaVersion: 1
project:
  name: leak-error
tasks:
  - id: boom
    title: Boom
    instructions: Boom.
    acceptance: Boom.
    estimatedCostUsd: 0.02
`)
    const errorKey = 'sk-ant-api03-ERRORTTESTKEY888888888888'
    const errorBroker = setupBroker({
      hooks: {
        anthropic: {
          complete(apiKey) {
            throw new Error(`upstream blew up with ${apiKey}`)
          },
        },
      },
    })
    const errorProject = await errorBroker.broker.registerProject({ manifestPath: failing })
    const errorDonor = await registerDonor(errorBroker.broker, { name: 'bea', provider: 'anthropic', apiKey: errorKey })
    const errorTask = errorProject.tasks[0]
    if (!errorTask) throw new Error('missing task')
    expect((await errorBroker.broker.claim(errorDonor.id, errorTask.id)).ok).toBe(true)
    const failed = await errorBroker.broker.run(errorDonor.id, errorTask.id)
    expect(failed.ok).toBe(false)
    if (failed.ok) return
    expect(failed.reason).not.toContain(errorKey)
    expect(failed.reason).toContain('[REDACTED]')
    expect(errorBroker.logs.join('\n')).not.toContain(errorKey)
    expect((await errorBroker.store.getTask(errorTask.id))?.failureReason ?? '').not.toContain(errorKey)
    await store.close()
    await errorBroker.store.close()
    const dumped = `${readDatabaseText(dbPath)}\n${readDatabaseText(errorBroker.dbPath)}`
    expect(dumped).not.toContain(odd)
    expect(dumped).not.toContain(errorKey)
  })
})
