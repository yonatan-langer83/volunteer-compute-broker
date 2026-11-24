import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { parse, stringify } from 'yaml'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Broker } from '../src/broker.js'
import { sizeForCost } from '../src/task-size.js'
import { loadMasterKey } from '../src/crypto.js'
import { createFakeRegistry, type FakeHooks } from '../src/fake-provider.js'
import type { ProviderRegistry } from '../src/providers.js'
import { openSqliteStore } from '../src/open-sqlite.js'
import type { SqliteStore } from '../src/sqlite-store.js'
import type { Logger, ProviderId } from '../src/types.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export const repoRoot = path.resolve(here, '..')

export const fixtureManifest = path.join(repoRoot, 'fixtures/sample-project/volunteer-compute.yaml')

export function testMasterKeyB64(): string {
  return Buffer.alloc(32, 7).toString('base64')
}

export function tempDbPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'broker-'))
  return path.join(dir, 'broker.sqlite')
}

export function writeManifest(body: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'manifest-'))
  const file = path.join(dir, 'volunteer-compute.yaml')
  writeFileSync(file, completeManifest(body))
  return file
}

export function completeManifest(body: string): string {
  const document = parse(body) as { tasks?: Record<string, unknown>[] }
  if (!document?.tasks) return body
  for (const task of document.tasks) {
    const cost = typeof task.estimatedCostUsd === 'number' ? task.estimatedCostUsd : 0.05
    task.estimatedCostUsd = cost
    if (typeof task.goal !== 'string') task.goal = `Complete ${task.title ?? task.id} within the named files.`
    const instructionLines = String(task.instructions ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    if (instructionLines.length < 2) {
      task.instructions = `${instructionLines[0] ?? 'Do the named change.'}\nStop when the acceptance check passes.`
    }
    if (typeof task.acceptance !== 'string' || task.acceptance.trim().length < 20) {
      task.acceptance = 'The change matches the task and the test command exits 0.'
    }
    if (task.tests == null) task.tests = 'npm test'
    if (task.do == null) task.do = ['README.md']
    if (task["don't"] == null && task.dont == null) task["don't"] = ['Do not add a dependency.']
    if (typeof task.deliverable !== 'string') task.deliverable = 'A unified diff of the files named in do.'
    if (typeof task.size !== 'string') {
      const size = sizeForCost(cost)
      if (!size) throw new Error(`test cost ${cost} is outside every size band`)
      task.size = size
    }
  }
  return stringify(document)
}

export function manualClock(start: number): { now: () => number; set: (value: number) => void; advance: (by: number) => void } {
  let current = start
  return {
    now: () => current,
    set(value: number) {
      current = value
    },
    advance(by: number) {
      current += by
    },
  }
}

export function setupBroker(options?: {
  now?: () => number
  leaseMs?: number
  maxAttempts?: number
  providers?: ProviderRegistry
  hooks?: Partial<Record<ProviderId, FakeHooks>>
}): { broker: Broker; store: SqliteStore; dbPath: string; logs: string[] } {
  const dbPath = tempDbPath()
  const store = openSqliteStore(dbPath, { maxAttempts: options?.maxAttempts ?? 3 })
  const logs: string[] = []
  const logger: Logger = {
    info(message) {
      logs.push(`info ${message}`)
    },
    error(message) {
      logs.push(`error ${message}`)
    },
  }
  const broker = new Broker({
    store,
    masterKey: loadMasterKey(testMasterKeyB64()),
    providers: options?.providers ?? createFakeRegistry(options?.hooks ?? {}),
    ...(options?.now ? { now: options.now } : {}),
    leaseMs: options?.leaseMs ?? 60_000,
    logger,
  })
  return { broker, store, dbPath, logs }
}

export function readDatabaseText(dbPath: string): string {
  const chunks: Buffer[] = []
  for (const suffix of ['', '-wal', '-shm']) {
    const candidate = `${dbPath}${suffix}`
    if (existsSync(candidate)) chunks.push(readFileSync(candidate))
  }
  return Buffer.concat(chunks).toString('latin1')
}

export async function registerDonor(
  broker: Broker,
  input: { name: string; provider: ProviderId; apiKey: string; spendingCapUsd?: number; acceptTerms?: boolean },
) {
  return await broker.registerDonor({
    name: input.name,
    provider: input.provider,
    apiKey: input.apiKey,
    spendingCapUsd: input.spendingCapUsd ?? 10,
    acceptTerms: input.acceptTerms ?? true,
  })
}
