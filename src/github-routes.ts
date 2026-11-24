import { createHash } from 'node:crypto'

import type { Broker, PullRequestOpener } from './broker.js'
import { decryptSecret, encryptSecret, parseEnvelope } from './crypto.js'
import { appManifest, GitHubApp, parseRepo, taskIdFromPrBody, verifyWebhookSignature, type AppCredentials, type FetchLike } from './github-app.js'
import type { SqliteStore } from './sqlite-store.js'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export async function loadAppCredentials(store: SqliteStore, masterKey: Buffer): Promise<AppCredentials | null> {
  const row = await store.getGithubAppRow()
  if (!row) return null
  return {
    appId: row.app_id,
    slug: row.slug,
    privateKeyPem: decryptSecret(parseEnvelope(row.private_key_sealed), masterKey),
    webhookSecret: decryptSecret(parseEnvelope(row.webhook_secret_sealed), masterKey),
  }
}

export function createPullRequestOpener(store: SqliteStore, masterKey: Buffer, fetcher?: FetchLike): PullRequestOpener {
  return {
    async open(input) {
      const creds = await loadAppCredentials(store, masterKey)
      const repo = parseRepo(input.project.github)
      if (!creds || !repo) return null
      return new GitHubApp(creds, fetcher).openVolunteerPr({ ...repo, ...input })
    },
  }
}

export async function createSetupCode(store: SqliteStore, code: string, now: number, ttlMs = 2 * 60 * 60 * 1000) {
  await store.insertSetupCode(sha256(code), now + ttlMs)
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#1f2328}button{font:inherit;padding:.6rem 1.2rem;border-radius:6px;border:0;background:#1f883d;color:#fff;cursor:pointer}</style></head>
<body>${body}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

// Step 1: a one-time code opens a page that sends GitHub the app manifest.
export async function handleSetupStart(store: SqliteStore, url: URL, now: number): Promise<Response> {
  const code = url.searchParams.get('code') ?? ''
  if (!code || !(await store.setupCodeValid(sha256(code), now))) {
    return page('Link expired', '<h1>This setup link has expired or was already used.</h1>', 403)
  }
  const manifest = JSON.stringify(appManifest(url.origin))
  return page(
    'Connect GitHub',
    `<h1>Connect the volunteer pool to GitHub</h1>
<p>This creates a GitHub App that turns volunteers' work into pull requests. Merging a pull request marks the task done; closing it returns the task to the pool.</p>
<p>On the next page GitHub asks you to confirm. You can change the name there if it is already taken.</p>
<form method="post" action="https://github.com/settings/apps/new?state=${encodeURIComponent(code)}">
<input type="hidden" name="manifest" value="${escape(manifest)}"><button type="submit">Create the GitHub App</button></form>`,
  )
}

// Step 2: GitHub sends us back with a code we exchange for the app's keys.
export async function handleSetupCallback(
  store: SqliteStore, masterKey: Buffer, url: URL, now: number,
  fetcher: FetchLike = (input, init) => fetch(input, init),
): Promise<Response> {
  const state = url.searchParams.get('state') ?? ''
  const ghCode = url.searchParams.get('code') ?? ''
  if (!state || !ghCode || !(await store.setupCodeValid(sha256(state), now))) {
    return page('Link expired', '<h1>This setup link has expired or was already used.</h1>', 403)
  }
  const response = await fetcher(`https://api.github.com/app-manifests/${encodeURIComponent(ghCode)}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'volunteer-compute-broker' },
  })
  if (!response.ok) return page('GitHub refused', `<h1>GitHub did not finish creating the app (${response.status}).</h1><p>Start again from your setup link.</p>`, 502)
  const app = await response.json() as { id: number; slug: string; pem: string; webhook_secret: string }
  if (!(await store.useSetupCode(sha256(state), now))) return page('Link expired', '<h1>This setup link was already used.</h1>', 403)
  await store.saveGithubAppRow({
    appId: String(app.id),
    slug: app.slug,
    privateKeySealed: JSON.stringify(encryptSecret(app.pem, masterKey)),
    webhookSecretSealed: JSON.stringify(encryptSecret(app.webhook_secret, masterKey)),
  }, now)
  return Response.redirect(`https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new`, 302)
}

// GitHub tells us a pull request was closed. Only pull requests our own app
// opened count, and only in the repository the task's project registered.
export async function handleGithubWebhook(broker: Broker, store: SqliteStore, masterKey: Buffer, request: Request): Promise<Response> {
  const creds = await loadAppCredentials(store, masterKey)
  if (!creds) return Response.json({ error: 'not_configured' }, { status: 503 })
  const body = await request.text()
  if (!(await verifyWebhookSignature(creds.webhookSecret, body, request.headers.get('x-hub-signature-256')))) {
    return Response.json({ error: 'bad_signature' }, { status: 401 })
  }
  const kind = request.headers.get('x-github-event')
  if (kind === 'installation' || kind === 'installation_repositories') {
    const event = JSON.parse(body) as {
      action: string
      repositories?: { full_name: string }[]
      repositories_added?: { full_name: string }[]
    }
    if (event.action !== 'created' && event.action !== 'added') return Response.json({ ignored: 'action' })
    const repos = [...(event.repositories ?? []), ...(event.repositories_added ?? [])]
    const opened: string[] = []
    for (const repo of repos) opened.push(...await broker.openPendingPullRequests(repo.full_name))
    return Response.json({ opened })
  }
  if (kind === 'pull_request_review') {
    const event = JSON.parse(body) as {
      action: string
      review: { state: string; body: string | null; html_url: string }
      pull_request: { body: string | null; user: { login: string } }
      repository: { full_name: string }
    }
    if (event.action !== 'submitted') return Response.json({ ignored: 'action' })
    if (event.pull_request.user.login !== `${creds.slug}[bot]`) return Response.json({ ignored: 'not_ours' })
    const taskId = taskIdFromPrBody(event.pull_request.body)
    const state = event.review.state.toLowerCase()
    if (!taskId || (state !== 'changes_requested' && state !== 'approved')) return Response.json({ ignored: 'review' })
    return Response.json(await broker.pullRequestSignal({
      taskId, repository: event.repository.full_name, kind: state as 'changes_requested' | 'approved',
      detail: event.review.body, url: event.review.html_url,
    }))
  }
  if (kind === 'check_suite') {
    const event = JSON.parse(body) as {
      action: string
      check_suite: { conclusion: string | null; app?: { name?: string }; pull_requests: { number: number }[] }
      repository: { full_name: string }
    }
    if (event.action !== 'completed' || !event.check_suite.pull_requests.length) return Response.json({ ignored: 'action' })
    const repo = parseRepo(`https://github.com/${event.repository.full_name}`)
    if (!repo) return Response.json({ ignored: 'repo' })
    const app = new GitHubApp(creds)
    const recorded: unknown[] = []
    for (const { number } of event.check_suite.pull_requests.slice(0, 5)) {
      const pr = await app.pullRequestBody(repo.owner, repo.repo, number)
      const taskId = pr && pr.user === `${creds.slug}[bot]` ? taskIdFromPrBody(pr.body) : null
      if (!taskId) continue
      const passed = event.check_suite.conclusion === 'success' || event.check_suite.conclusion === 'neutral' || event.check_suite.conclusion === 'skipped'
      recorded.push(await broker.pullRequestSignal({
        taskId, repository: event.repository.full_name, kind: passed ? 'checks_passed' : 'checks_failed',
        detail: `${event.check_suite.app?.name ?? 'CI'}: ${event.check_suite.conclusion ?? 'unknown'}`, url: pr!.url,
      }))
    }
    return Response.json({ recorded })
  }
  if (kind !== 'pull_request') return Response.json({ ignored: 'event' })
  const event = JSON.parse(body) as {
    action: string
    pull_request: { merged: boolean; body: string | null; user: { login: string } }
    repository: { full_name: string }
  }
  if (event.action !== 'closed') return Response.json({ ignored: 'action' })
  if (event.pull_request.user.login !== `${creds.slug}[bot]`) return Response.json({ ignored: 'not_ours' })
  const taskId = taskIdFromPrBody(event.pull_request.body)
  if (!taskId) return Response.json({ ignored: 'no_task' })
  const result = await broker.pullRequestClosed({ taskId, merged: event.pull_request.merged, repository: event.repository.full_name })
  return Response.json(result)
}
