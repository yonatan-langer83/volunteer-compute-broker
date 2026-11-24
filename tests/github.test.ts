import { createHmac, createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadMasterKey } from '../src/crypto.js'
import { appJwt, applyFilePatch, parseUnifiedDiff, verifyWebhookSignature, type FetchLike } from '../src/github-app.js'
import { createPullRequestOpener, createSetupCode, handleGithubWebhook, handleSetupCallback, handleSetupStart } from '../src/github-routes.js'
import { openSqliteStore } from '../src/open-sqlite.js'
import { repoRoot, setupBroker, tempDbPath, testMasterKeyB64, writeManifest } from './helpers.js'

const fx = (name: string) => readFileSync(path.join(repoRoot, 'fixtures/github', name), 'utf8')
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string
const SECRET = 'webhook-secret'
const sign = (body: string) => 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex')

describe('github app basics', () => {
  it('signs an app JWT with a PKCS#1 key that the public key verifies', async () => {
    const jwt = await appJwt('123', pem, Date.now())
    const [h, p, s] = jwt.split('.')
    const ok = verify('sha256', Buffer.from(`${h}.${p}`), createPublicKey(privateKey), Buffer.from(s!, 'base64url'))
    expect(ok).toBe(true)
    expect(JSON.parse(Buffer.from(p!, 'base64url').toString()).iss).toBe('123')
  })

  it('verifies webhook signatures and refuses forged ones', async () => {
    expect(await verifyWebhookSignature(SECRET, '{"a":1}', sign('{"a":1}'))).toBe(true)
    expect(await verifyWebhookSignature(SECRET, '{"a":2}', sign('{"a":1}'))).toBe(false)
    expect(await verifyWebhookSignature(SECRET, '{"a":1}', null)).toBe(false)
  })

  it('applies the real volunteer diff byte for byte, with or without a final newline', () => {
    for (const patch of [fx('volunteer.patch'), fx('volunteer.patch') + '\n']) {
      const files = parseUnifiedDiff(patch)
      expect(files.map((f) => f.newPath)).toEqual(['pantry_shifts/shifts.py', 'tests/test_shifts.py'])
      expect(applyFilePatch(fx('shifts.before.py'), files[0]!)).toBe(fx('shifts.after.py'))
      expect(applyFilePatch(fx('test_shifts.before.py'), files[1]!)).toBe(fx('test_shifts.after.py'))
    }
  })

  it('creates new files and refuses a diff that does not match', () => {
    const [created] = parseUnifiedDiff('--- /dev/null\n+++ b/tests/test_new.py\n@@ -0,0 +1,2 @@\n+def test_x():\n+    assert True\n')
    expect(applyFilePatch(null, created!)).toBe('def test_x():\n    assert True\n')
    const [bad] = parseUnifiedDiff('--- a/x.py\n+++ b/x.py\n@@ -1,1 +1,1 @@\n-nope\n+yes\n')
    expect(() => applyFilePatch('something else\n', bad!)).toThrow(/does not apply/)
  })
})

// A tiny in-memory GitHub: one repo, the REST calls the broker makes.
function fakeGitHub(files: Record<string, string>) {
  const calls: string[] = []
  let tree: { path: string; content?: string; sha?: null }[] = []
  let pr: { title: string; head: string; body: string } | null = null
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
  const fetcher: FetchLike = async (input, init) => {
    const url = new URL(input)
    const route = `${init?.method ?? 'GET'} ${url.pathname}`
    calls.push(route)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (route === 'GET /repos/pantry/shifts/installation') return json({ id: 7 })
    if (route === 'POST /app/installations/7/access_tokens') return json({ token: 'inst-token' })
    if (route === 'GET /repos/pantry/shifts') return json({ default_branch: 'main' })
    if (route === 'GET /repos/pantry/shifts/git/ref/heads/main') return json({ object: { sha: 'base000' } })
    if (route === 'GET /repos/pantry/shifts/git/commits/base000') return json({ tree: { sha: 'tree000' } })
    const content = url.pathname.match(/^\/repos\/pantry\/shifts\/contents\/(.+)$/)
    if (content) {
      const file = files[decodeURIComponent(content[1]!)]
      return file == null ? json({}, 404) : json({ content: Buffer.from(file).toString('base64'), encoding: 'base64' })
    }
    if (route === 'POST /repos/pantry/shifts/git/trees') {
      tree = body.tree
      return json({ sha: 'tree111' })
    }
    if (route === 'POST /repos/pantry/shifts/git/commits') return json({ sha: 'abcdef1234' })
    if (route === 'POST /repos/pantry/shifts/git/refs') return json({}, 201)
    if (route === 'POST /repos/pantry/shifts/pulls') {
      pr = body
      return json({ html_url: 'https://github.com/pantry/shifts/pull/9' }, 201)
    }
    return json({ message: `unexpected ${route}` }, 500)
  }
  return { fetcher, calls, tree: () => tree, pr: () => pr }
}

const manifest = `schemaVersion: 1
project:
  name: pantry
  nonprofit: true
  github: https://github.com/pantry/shifts
tasks:
  - id: fix-overnight-hours
    title: Count overnight shifts forward
    instructions: Fix shift_hours in pantry_shifts/shifts.py and tests/test_shifts.py.
    acceptance: python -m pytest exits 0.
    estimatedCostUsd: 0.05
`

async function setup() {
  const dbPath = tempDbPath()
  const store = openSqliteStore(dbPath, { maxAttempts: 3 })
  const masterKey = loadMasterKey(testMasterKeyB64())
  const gh = fakeGitHub({ 'pantry_shifts/shifts.py': fx('shifts.before.py'), 'tests/test_shifts.py': fx('test_shifts.before.py') })
  const { broker } = setupBroker({ store, pullRequests: createPullRequestOpener(store, masterKey, gh.fetcher) })
  await broker.registerProject({ manifestPath: writeManifest(manifest) })
  const donor = await broker.registerMcpDonor({ name: 'ada', monthlyTasks: 5, acceptTerms: true })
  return { store, masterKey, gh, broker, donor }
}

async function installApp(store: ReturnType<typeof openSqliteStore>, masterKey: Buffer) {
  await createSetupCode(store, 'setup-code', Date.now())
  const fetcher: FetchLike = async () => new Response(JSON.stringify({ id: 42, slug: 'volunteer-broker', pem, webhook_secret: SECRET }), { status: 201 })
  const url = new URL('https://volunteer.example/setup/github/callback?code=gh123&state=setup-code')
  return handleSetupCallback(store, masterKey, url, Date.now(), fetcher)
}

function webhook(event: string, payload: unknown) {
  const body = JSON.stringify(payload)
  return new Request('https://volunteer.example/github/webhook', {
    method: 'POST',
    body,
    headers: { 'x-github-event': event, 'x-hub-signature-256': sign(body) },
  })
}

async function submitted() {
  const ctx = await setup()
  expect((await installApp(ctx.store, ctx.masterKey)).status).toBe(302)
  expect((await ctx.broker.requestWork(ctx.donor.id, 1, 'small')).ok).toBe(true)
  const claim = await ctx.broker.claimNext(ctx.donor.id)
  if (!claim.ok) throw new Error(claim.reason)
  const result = await ctx.broker.submitResult(ctx.donor.id, claim.taskId, { summary: 'Fixed; 13 passed', patch: fx('volunteer.patch') })
  return { ...ctx, taskId: claim.taskId, result }
}

describe('github app flow', () => {
  it('only lets a valid, unused setup code create the app, then sends you to install it', async () => {
    const { store, masterKey } = await setup()
    const denied = await handleSetupStart(store, new URL('https://volunteer.example/setup/github?code=wrong'), Date.now())
    expect(denied.status).toBe(403)
    const first = await installApp(store, masterKey)
    expect(first.headers.get('location')).toBe('https://github.com/apps/volunteer-broker/installations/new')
    const again = await handleSetupCallback(store, masterKey, new URL('https://volunteer.example/setup/github/callback?code=x&state=setup-code'), Date.now(),
      async () => new Response('{}', { status: 201 }))
    expect(again.status).toBe(403)
    const row = await store.getGithubAppRow()
    expect(row?.private_key_sealed).not.toContain('PRIVATE KEY')
  })

  it('opens a pull request with the applied diff when a volunteer submits', async () => {
    const { gh, store, taskId, result } = await submitted()
    expect((result as { pullRequest?: string }).pullRequest).toBe('https://github.com/pantry/shifts/pull/9')
    expect(gh.tree().find((t) => t.path === 'pantry_shifts/shifts.py')?.content).toBe(fx('shifts.after.py'))
    expect(gh.pr()?.head).toBe('volunteer/fix-overnight-hours-abcdef1')
    expect(gh.pr()?.body).toContain(`<!-- volunteer-task: ${taskId} -->`)
    expect((await store.getTask(taskId))?.submissionUrl).toBe('https://github.com/pantry/shifts/pull/9')
  })

  it('marks the task done when the pull request is merged', async () => {
    const { broker, store, masterKey, taskId } = await submitted()
    const response = await handleGithubWebhook(broker, store, masterKey, webhook('pull_request', {
      action: 'closed',
      pull_request: { merged: true, body: `x <!-- volunteer-task: ${taskId} -->`, user: { login: 'volunteer-broker[bot]' } },
      repository: { full_name: 'pantry/shifts' },
    }))
    expect(await response.json()).toEqual({ ok: true })
    expect((await store.getTask(taskId))?.state).toBe('done')
  })

  it('returns the task to the pool when the pull request is closed without merging', async () => {
    const { broker, store, masterKey, taskId } = await submitted()
    await handleGithubWebhook(broker, store, masterKey, webhook('pull_request', {
      action: 'closed',
      pull_request: { merged: false, body: `<!-- volunteer-task: ${taskId} -->`, user: { login: 'volunteer-broker[bot]' } },
      repository: { full_name: 'pantry/shifts' },
    }))
    expect((await store.getTask(taskId))?.state).toBe('open')
  })

  it('ignores forged signatures, other authors and other repositories', async () => {
    const { broker, store, masterKey, taskId } = await submitted()
    const forged = webhook('pull_request', {})
    forged.headers.set('x-hub-signature-256', 'sha256=00')
    expect((await handleGithubWebhook(broker, store, masterKey, forged)).status).toBe(401)
    const stranger = await handleGithubWebhook(broker, store, masterKey, webhook('pull_request', {
      action: 'closed', pull_request: { merged: true, body: `<!-- volunteer-task: ${taskId} -->`, user: { login: 'mallory' } },
      repository: { full_name: 'pantry/shifts' },
    }))
    expect(await stranger.json()).toEqual({ ignored: 'not_ours' })
    const elsewhere = await handleGithubWebhook(broker, store, masterKey, webhook('pull_request', {
      action: 'closed', pull_request: { merged: true, body: `<!-- volunteer-task: ${taskId} -->`, user: { login: 'volunteer-broker[bot]' } },
      repository: { full_name: 'mallory/other' },
    }))
    expect(await elsewhere.json()).toEqual({ ok: false, reason: 'wrong_repository' })
    expect((await store.getTask(taskId))?.state).toBe('review')
  })

  it('opens pull requests for waiting submissions when the app is installed', async () => {
    const { broker, store, masterKey, gh, donor } = await setup()
    expect((await broker.requestWork(donor.id, 1, 'small')).ok).toBe(true)
    const claim = await broker.claimNext(donor.id)
    if (!claim.ok) throw new Error(claim.reason)
    await broker.submitResult(donor.id, claim.taskId, { summary: 'done', patch: fx('volunteer.patch') })
    expect(gh.pr()).toBeNull()
    await installApp(store, masterKey)
    const response = await handleGithubWebhook(broker, store, masterKey, webhook('installation', {
      action: 'created', repositories: [{ full_name: 'pantry/shifts' }],
    }))
    expect(await response.json()).toEqual({ opened: ['https://github.com/pantry/shifts/pull/9'] })
  })
})
