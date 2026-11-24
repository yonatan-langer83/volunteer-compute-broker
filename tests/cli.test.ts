import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { fixtureManifest, readDatabaseText, repoRoot, tempDbPath, testMasterKeyB64 } from './helpers.js'

const donorKey = 'sk-ant-api03-CLITESTKEY9999999999999999'

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(repoRoot, 'src/cli.ts'), ...args], {
      cwd: repoRoot,
      env,
    })
    if (!child.stdout || !child.stderr) {
      reject(new Error('stdio was not piped'))
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

function field(output: string, name: string): string {
  const line = output.split('\n').find((item) => item.startsWith(`${name}=`))
  if (!line) throw new Error(`missing ${name} in:\n${output}`)
  return line.slice(name.length + 1)
}

describe('cli', () => {
  it('mints a master key and refuses a key passed on argv', async () => {
    const minted = await runCli(['init-key'], cleanEnv({}))
    expect(minted.code).toBe(0)
    expect(Buffer.from(minted.stdout.trim(), 'base64')).toHaveLength(32)
    const refused = await runCli(['register-donor', '--api-key', donorKey], cleanEnv({}))
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('Refusing --api-key')
    expect(refused.stderr).not.toContain(donorKey)
    expect(refused.stdout).not.toContain(donorKey)
  })

  it('registers a fixture project and a donor without printing the key', async () => {
    const dbPath = tempDbPath()
    const keyFile = path.join(mkdtempSync(path.join(tmpdir(), 'key-')), 'donor.key')
    writeFileSync(keyFile, `${donorKey}\n`)
    const env = cleanEnv({
      BROKER_MASTER_KEY: testMasterKeyB64(),
      BROKER_DB: dbPath,
      BROKER_PROVIDERS: 'fake',
    })
    const project = await runCli(['register-project', '--manifest', fixtureManifest], env)
    expect(project.code).toBe(0)
    expect(project.stdout).toContain('task inventory state=open')
    expect(project.stdout).toContain('task release-checklist state=blocked')
    const donor = await runCli(
      ['register-donor', '--name', 'ada', '--provider', 'anthropic', '--cap', '5', '--accept-terms', '--api-key-file', keyFile],
      env,
    )
    expect(donor.code).toBe(0)
    const donorId = field(donor.stdout, 'donor_id')
    const claimed = await runCli(['claim-next', '--donor', donorId], env)
    expect(claimed.code).toBe(0)
    const taskId = field(claimed.stdout, 'task_id')
    const run = await runCli(['run', '--donor', donorId, '--task', taskId], env)
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('run=done')
    const status = await runCli(['status'], env)
    expect(status.code).toBe(0)
    const tooBig = await runCli(['too-big'], env)
    expect(tooBig.code).toBe(0)
    expect(tooBig.stdout).toContain('task license-note project=leaflet-docs')
    expect(tooBig.stdout).toContain('reason=no_eligible_donor')
    const ledger = await runCli(['ledger'], env)
    expect(ledger.code).toBe(0)
    expect(ledger.stdout).toContain('donor=ada')
    expect(ledger.stdout).toContain('by_project')
    expect(ledger.stdout).toContain('by_donor')
    const impact = await runCli(['impact', '--donor', donorId], env)
    expect(impact.code).toBe(0)
    expect(impact.stdout).toContain('donor ada')
    expect(impact.stdout).toContain('tasks_completed=1')
    expect(impact.stdout).toContain('organization leaflet-docs')
    expect(impact.stdout).toContain('fully_done none')
    const combined = [project, donor, claimed, run, status, tooBig, ledger, impact]
      .map((result) => `${result.stdout}\n${result.stderr}`)
      .join('\n')
    expect(combined).not.toContain(donorKey)
    expect(readDatabaseText(dbPath)).not.toContain(donorKey)
  })
})

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, NODE_OPTIONS: '--disable-warning=ExperimentalWarning', ...extra }
}
