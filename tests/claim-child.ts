import { Broker } from '../src/broker.js'
import { loadMasterKey } from '../src/crypto.js'
import { createFakeRegistry } from '../src/fake-provider.js'
import { openSqliteStore } from '../src/open-sqlite.js'

const dbPath = process.argv[2]
const taskId = process.argv[3]
const donorId = process.argv[4]
const master = process.env.BROKER_MASTER_KEY
if (!dbPath || !taskId || !donorId || !master) {
  process.stderr.write('missing claim arguments\n')
  process.exit(1)
}

const store = openSqliteStore(dbPath)
const broker = new Broker({
  store,
  masterKey: loadMasterKey(master),
  providers: createFakeRegistry(),
  logger: { info() {}, error() {} },
})

try {
  const result = await broker.claim(donorId, taskId)
  process.stdout.write(result.ok ? 'WON\n' : `LOST ${result.reason}\n`)
} catch (error) {
  const message = error instanceof Error ? error.message : 'claim failed'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
} finally {
  await store.close()
}
