// One isolated Linux test machine per task (Cloudflare Containers). It
// downloads the project at the workspace's base commit, applies the
// volunteer's changed files, runs the project's own setup and check commands,
// and stores the outcome in D1. The volunteer's computer never runs anything.

import { DurableObject } from 'cloudflare:workers'

import { D1Sql } from './d1-sql.js'
import { SqliteStore } from './sqlite-store.js'
import type { CheckRunner } from './workspace.js'

type D1Database = ConstructorParameters<typeof D1Sql>[0]

type ExecOutput = { stdout: string | Uint8Array; stderr: string | Uint8Array; exitCode: number }
type ExecProcess = {
  stdin?: WritableStream<Uint8Array>
  output(): Promise<ExecOutput>
}
type ContainerApi = {
  running: boolean
  start(options: { image: string; entrypoint?: string[]; enableInternet?: boolean; instance?: string }): void
  exec(cmd: string[], options?: { stdin?: 'pipe' }): Promise<ExecProcess>
  setInactivityTimeout(ms: number): Promise<void>
}

type Env = { DB: D1Database }

export type StartRun = Parameters<CheckRunner['start']>[0]

const IMAGE = 'cloudflare/debian-trixie'

// Prepared once per machine: Python with a virtual environment and git, next
// to the image's Node.js.
const PROVISION = [
  'set -e',
  'if [ ! -f /opt/vp-ready ]; then',
  '  apt-get update -qq',
  '  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends python3 python3-venv python3-pip git ca-certificates > /dev/null',
  '  python3 -m venv /opt/venv',
  '  touch /opt/vp-ready',
  'fi',
].join('\n')

// Reads {tarballUrl, files, setup, run} from stdin, unpacks the project into
// /work and applies the volunteer's files.
const PREPARE_JS = `
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', async () => {
  const job = JSON.parse(input);
  fs.rmSync('/work', { recursive: true, force: true });
  fs.mkdirSync('/work', { recursive: true });
  const res = await fetch(job.tarballUrl);
  if (!res.ok) { console.error('download failed ' + res.status); process.exit(3); }
  fs.writeFileSync('/tmp/src.tgz', Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['xzf', '/tmp/src.tgz', '--strip-components=1', '-C', '/work']);
  for (const f of job.files) {
    const target = path.join('/work', f.path);
    if (!target.startsWith('/work/')) continue;
    if (f.content === null) { fs.rmSync(target, { force: true }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content);
  }
  fs.writeFileSync('/tmp/setup.sh', job.setup || 'true');
  fs.writeFileSync('/tmp/run.sh', job.run);
});
`

const RUN = [
  'cd /work',
  '. /opt/venv/bin/activate',
  'export CI=1',
  'timeout 300 bash /tmp/setup.sh > /tmp/setup.log 2>&1',
  'status=$?',
  'if [ $status -ne 0 ]; then echo "--- The project setup failed (exit $status) ---"; tail -c 6000 /tmp/setup.log; exit 90; fi',
  'timeout 300 bash /tmp/run.sh > /tmp/run.log 2>&1',
  'status=$?',
  'tail -c 12000 /tmp/run.log',
  'exit $status',
].join('\n')

const text = (value: string | Uint8Array) => (typeof value === 'string' ? value : new TextDecoder().decode(value))

export class TestRunner extends DurableObject<Env> {
  private get container(): ContainerApi {
    return (this.ctx as unknown as { container: ContainerApi }).container
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('not found', { status: 404 })
    const job = (await request.json()) as StartRun
    this.ctx.waitUntil(this.runJob(job))
    return Response.json({ started: true }, { status: 202 })
  }

  private async exec(cmd: string[], stdin?: string): Promise<ExecOutput> {
    const process = await this.container.exec(cmd, stdin === undefined ? undefined : { stdin: 'pipe' })
    if (stdin !== undefined && process.stdin) {
      const writer = process.stdin.getWriter()
      await writer.write(new TextEncoder().encode(stdin))
      await writer.close()
    }
    return process.output()
  }

  private async ensureStarted() {
    if (!this.container.running) {
      this.container.start({ image: IMAGE, entrypoint: ['sleep', 'infinity'], enableInternet: true, instance: 'basic' })
    }
    await this.container.setInactivityTimeout(20 * 60 * 1000)
    // start() returns before the machine accepts commands.
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const probe = await this.exec(['true'])
        if (probe.exitCode === 0) return
      } catch {
        // not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    throw new Error('the test machine did not start')
  }

  private async runJob(job: StartRun) {
    const store = new SqliteStore(new D1Sql(this.env.DB))
    let status: 'passed' | 'failed' | 'error' = 'error'
    let exitCode: number | null = null
    let output = ''
    try {
      await store.prepare()
      await this.ensureStarted()
      const provision = await this.exec(['bash', '-lc', PROVISION])
      if (provision.exitCode !== 0) throw new Error(`preparing the test machine failed: ${text(provision.stderr).slice(-2000)}`)
      const prepare = await this.exec(['node', '-e', PREPARE_JS], JSON.stringify(job))
      if (prepare.exitCode !== 0) throw new Error(`getting the project failed: ${text(prepare.stderr).slice(-2000)}`)
      const run = await this.exec(['bash', '-lc', RUN])
      exitCode = run.exitCode
      output = (text(run.stdout) + text(run.stderr)).slice(-14000)
      status = run.exitCode === 0 ? 'passed' : 'failed'
    } catch (error) {
      output = `The checks could not run: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      await store.finishCheckRun(job.runId, status, exitCode, output, Date.now()).catch(() => undefined)
      await store.close().catch(() => undefined)
    }
  }
}

export function containerCheckRunner(namespace: {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(request: Request): Promise<Response> }
}): CheckRunner {
  return {
    async start(job) {
      const stub = namespace.get(namespace.idFromName(job.taskId))
      const response = await stub.fetch(new Request('https://test-runner/start', { method: 'POST', body: JSON.stringify(job) }))
      if (!response.ok) throw new Error(`the test machine refused the job: ${response.status}`)
    },
  }
}
