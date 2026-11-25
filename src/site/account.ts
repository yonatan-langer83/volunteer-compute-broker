// Website accounts: sign in with GitHub or an emailed link, then manage your
// volunteer name, monthly limit, connected AI apps and coding-tool keys, and
// (for organizations) see your projects. Sessions are an opaque random id in
// an HttpOnly cookie; only its hash is stored.

import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider'

import { decryptSecret, encryptSecret, parseEnvelope } from '../crypto.js'
import type { FetchLike, GitHubApp } from '../github-app.js'
import { parseRepo } from '../github-app.js'
import type { AccountRow, SqliteStore } from '../sqlite-store.js'
import { esc, page, SITE, slugify, statusLabel } from './layout.js'

export const MCP_URL = `${SITE.origin}/mcp`
const SESSION_COOKIE = '__Host-vp_session'
const STATE_COOKIE = '__Host-vp_state'
const SESSION_MS = 30 * 24 * 60 * 60 * 1000
const LINK_MS = 15 * 60 * 1000

export type SendEmail = (message: { to: string; subject: string; text: string; html: string }) => Promise<void>

export type CreateLinkedVolunteer = (input: { nickname: string; monthly: number; accountId: string }) =>
  Promise<{ ok: true; donorId: string } | { ok: false; error: string }>

export type AccountDeps = {
  store: SqliteStore
  masterKey: Buffer
  oauth: OAuthHelpers | null
  fetcher?: FetchLike
  sendEmail: SendEmail | null
  turnstileSiteKey: string | null
  verifyTurnstile: (form: FormData, request: Request) => Promise<boolean>
  createVolunteer: CreateLinkedVolunteer
  githubApp: () => Promise<GitHubApp | null>
  now?: () => number
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const nowOf = (deps: AccountDeps) => deps.now?.() ?? Date.now()
const fetchOf = (deps: AccountDeps): FetchLike => deps.fetcher ?? ((input, init) => fetch(input, init))

// ---------- cookies, sessions, return paths ----------

function cookies(request: Request): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0) map.set(part.slice(0, at).trim(), part.slice(at + 1).trim())
  }
  return map
}

const setCookie = (name: string, value: string, maxAgeSeconds: number) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`

// Only paths on this site, never another host.
export function safeReturn(value: string | null | undefined, fallback = '/account'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\r\n]/.test(value)) return fallback
  return value.slice(0, 2000)
}

export async function currentAccount(store: SqliteStore, request: Request, now: number): Promise<AccountRow | null> {
  const id = cookies(request).get(SESSION_COOKIE)
  if (!id || !/^[A-Za-z0-9_-]{20,}$/.test(id)) return null
  const accountId = await store.findSessionAccount(sha256(id), now)
  return accountId ? store.getAccount(accountId) : null
}

async function startSession(store: SqliteStore, accountId: string, now: number): Promise<string> {
  const id = randomBytes(32).toString('base64url')
  await store.insertAccountSession(sha256(id), accountId, now, now + SESSION_MS)
  return setCookie(SESSION_COOKIE, id, SESSION_MS / 1000)
}

function redirect(location: string, cookie?: string | string[]): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' })
  for (const c of [cookie ?? []].flat()) headers.append('set-cookie', c)
  return new Response(null, { status: 303, headers })
}

// Forms on this site post only from this site.
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  return !!origin && origin === new URL(request.url).origin
}

const privatePage = (title: string, body: string, status = 200, extra: Record<string, string> = {}, turnstile = false) =>
  page({ title: `${title} | ${SITE.name}`, description: title, path: '/account', noindex: true, turnstile }, body, status, extra)

// ---------- sign-in page ----------

export async function signinPage(deps: AccountDeps, returnTo: string, message?: string, forApp?: string | null): Promise<Response> {
  const github = await deps.store.getSigninApp()
  const back = encodeURIComponent(returnTo)
  const ts = deps.turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${esc(deps.turnstileSiteKey)}"></div>` : ''
  const options: string[] = []
  if (github) {
    options.push(`<div class="signin-option">
  <h2>With GitHub</h2>
  <p>Best for organizations and developers. Organizations see the projects they manage on GitHub.</p>
  <a class="button" href="/auth/github?return=${back}">Sign in with GitHub</a>
</div>`)
  }
  if (deps.sendEmail) {
    options.push(`<div class="signin-option">
  <h2>With your email</h2>
  <p>No password. We email you a sign-in link that works once, for 15 minutes.</p>
  <form method="post" action="/auth/email" class="form">
    <input type="hidden" name="return" value="${esc(returnTo)}">
    <label for="email">Email address</label>
    <input id="email" name="email" type="email" autocomplete="email" required>
    <div class="hp" aria-hidden="true"><label>Leave this empty <input name="website_url" tabindex="-1" autocomplete="off"></label></div>
    ${ts}
    <button class="button" type="submit">Email me a sign-in link</button>
  </form>
</div>`)
  }
  if (!options.length) {
    options.push('<p class="notice">Sign-in is being set up. Please check back soon.</p>')
  }
  return privatePage(
    'Sign in',
    `<div class="wrap page-head narrow">
  <h1>${forApp ? `Sign in to connect ${esc(forApp.slice(0, 60))}` : `Sign in to ${SITE.name}`}</h1>
  <p class="lead">${forApp ? 'New here? Signing in creates your account. Then you choose a public name and allow the app to volunteer.' : 'One account for your volunteer name, your AI apps and your organization\'s projects.'}</p>
  ${message ? `<p class="error" role="alert">${esc(message)}</p>` : ''}
</div>
<section class="wrap section narrow signin-options">${options.join('\n')}</section>`,
    200,
    {},
    !!deps.sendEmail && !!deps.turnstileSiteKey,
  )
}

// ---------- GitHub sign-in ----------

async function signinCredentials(deps: AccountDeps) {
  const row = await deps.store.getSigninApp()
  if (!row) return null
  return { clientId: row.client_id, clientSecret: decryptSecret(parseEnvelope(row.client_secret_sealed), deps.masterKey) }
}

export async function githubStart(deps: AccountDeps, url: URL): Promise<Response> {
  const creds = await signinCredentials(deps)
  if (!creds) return signinPage(deps, '/account', 'GitHub sign-in is not set up yet.')
  const state = randomBytes(24).toString('base64url')
  const returnTo = safeReturn(url.searchParams.get('return'))
  const target = new URL('https://github.com/login/oauth/authorize')
  target.searchParams.set('client_id', creds.clientId)
  target.searchParams.set('redirect_uri', `${url.origin}/auth/github/callback`)
  target.searchParams.set('state', state)
  target.searchParams.set('allow_signup', 'true')
  const cookie = setCookie(STATE_COOKIE, `${state}.${Buffer.from(returnTo).toString('base64url')}`, 600)
  return redirect(target.toString(), cookie)
}

export async function githubCallback(deps: AccountDeps, request: Request, url: URL): Promise<Response> {
  const stored = cookies(request).get(STATE_COOKIE) ?? ''
  const [state, encodedReturn] = stored.split('.')
  const clear = setCookie(STATE_COOKIE, '', 0)
  if (!state || state !== url.searchParams.get('state')) return signinPage(deps, '/account', 'That sign-in attempt expired. Please try again.')
  const returnTo = safeReturn(encodedReturn ? Buffer.from(encodedReturn, 'base64url').toString() : null)
  const code = url.searchParams.get('code')
  const creds = await signinCredentials(deps)
  if (!code || !creds) return signinPage(deps, returnTo, 'GitHub did not finish the sign-in. Please try again.')
  const fetcher = fetchOf(deps)
  const exchange = await fetcher('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'volunteer-pool' },
    body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, code, redirect_uri: `${url.origin}/auth/github/callback` }),
  })
  const token = (await exchange.json().catch(() => ({}))) as { access_token?: string }
  if (!token.access_token) return signinPage(deps, returnTo, 'GitHub did not finish the sign-in. Please try again.')
  const headers = { authorization: `Bearer ${token.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'volunteer-pool' }
  const userResponse = await fetcher('https://api.github.com/user', { headers })
  if (!userResponse.ok) return signinPage(deps, returnTo, 'GitHub did not share your profile. Please try again.')
  const user = (await userResponse.json()) as { id: number; login: string }
  let email: string | null = null
  const emails = await fetcher('https://api.github.com/user/emails', { headers }).catch(() => null)
  if (emails?.ok) {
    const list = (await emails.json()) as { email: string; primary: boolean; verified: boolean }[]
    email = list.find((e) => e.primary && e.verified)?.email.toLowerCase() ?? null
  }
  const now = nowOf(deps)
  let account = await deps.store.findAccountByGithub(String(user.id))
  // Someone signed in by email connects GitHub from their account page.
  const current = await currentAccount(deps.store, request, now)
  if (current && !current.github_id) {
    if (account && account.id !== current.id) return redirect(`/account?notice=${encodeURIComponent('That GitHub account already belongs to another Volunteer Pool account.')}`, clear)
    await deps.store.linkAccountGithub(current.id, String(user.id), user.login)
    return redirect(returnTo, clear)
  }
  if (!account && email) {
    // Someone who first signed in by email, now with GitHub: same verified address, same account.
    const byEmail = await deps.store.findAccountByEmail(email)
    if (byEmail && !byEmail.github_id) {
      await deps.store.linkAccountGithub(byEmail.id, String(user.id), user.login)
      account = { ...byEmail, github_id: String(user.id), github_login: user.login }
    }
  }
  if (!account) {
    const taken = email ? await deps.store.findAccountByEmail(email) : null
    account = { id: randomUUID(), github_id: String(user.id), github_login: user.login, email: taken ? null : email }
    await deps.store.insertAccount(account, now)
  } else {
    await deps.store.updateAccountLogin(account.id, { github_login: user.login }, now)
  }
  return redirect(returnTo, [clear, await startSession(deps.store, account.id, now)])
}

// ---------- email sign-in ----------

function clientKey(request: Request, now: number): string {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  return sha256(`signin:${ip}:${new Date(now).toISOString().slice(0, 10)}`)
}

export async function emailStart(deps: AccountDeps, request: Request): Promise<Response> {
  if (!deps.sendEmail) return signinPage(deps, '/account', 'Email sign-in is not set up yet.')
  if (!sameOrigin(request)) return signinPage(deps, '/account', 'Please use the form on this page.')
  const form = await request.formData()
  const returnTo = safeReturn(String(form.get('return') ?? ''))
  if (String(form.get('website_url') ?? '')) return signinPage(deps, returnTo)
  const email = String(form.get('email') ?? '').trim().toLowerCase().slice(0, 200)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return signinPage(deps, returnTo, 'Please enter a valid email address.')
  if (!(await deps.verifyTurnstile(form, request))) return signinPage(deps, returnTo, 'The anti-spam check failed. Please try again.')
  const now = nowOf(deps)
  const okIp = await deps.store.hitRateLimit(clientKey(request, now), 10, 24 * 60 * 60 * 1000, now)
  const okAddress = await deps.store.hitRateLimit(sha256(`signin-email:${email}`), 5, 60 * 60 * 1000, now)
  if (okIp && okAddress) {
    const token = randomBytes(32).toString('base64url')
    await deps.store.insertLoginLink(sha256(token), email, returnTo, now, now + LINK_MS)
    const link = `${new URL(request.url).origin}/auth/email/verify?token=${token}`
    await deps.sendEmail({
      to: email,
      subject: `Your ${SITE.name} sign-in link`,
      text: `Sign in to ${SITE.name}:\n\n${link}\n\nThe link works once, for 15 minutes. If you didn't ask for it, ignore this email.\n`,
      html: `<p>Sign in to ${SITE.name}:</p><p><a href="${esc(link)}">Sign in</a></p><p>The link works once, for 15 minutes. If you didn't ask for it, ignore this email.</p>`,
    })
  }
  // The same answer either way, so this page never says whether an address has an account.
  return privatePage('Check your email', `<div class="wrap page-head narrow">
  <h1>Check your email</h1>
  <p class="lead">If <strong>${esc(email)}</strong> can receive email, a sign-in link is on its way. It works once, for 15 minutes.</p>
  <p>Nothing arrived? Check your spam folder, or <a href="/signin?return=${encodeURIComponent(returnTo)}">try again</a>.</p>
</div>`)
}

// The link opens a page with a button, so mail scanners that open links can't use it up.
export async function emailVerifyPage(deps: AccountDeps, url: URL): Promise<Response> {
  const token = url.searchParams.get('token') ?? ''
  if (!/^[A-Za-z0-9_-]{30,}$/.test(token) || !(await deps.store.loginLinkValid(sha256(token), nowOf(deps)))) {
    return signinPage(deps, '/account', 'That sign-in link has expired or was already used. Ask for a new one below.')
  }
  return privatePage('Finish signing in', `<div class="wrap page-head narrow">
  <h1>Finish signing in</h1>
  <form method="post" action="/auth/email/verify"><input type="hidden" name="token" value="${esc(token)}"><button class="button" type="submit">Sign in</button></form>
</div>`)
}

export async function emailVerify(deps: AccountDeps, request: Request): Promise<Response> {
  if (!sameOrigin(request)) return signinPage(deps, '/account', 'Please use the button on the sign-in page.')
  const form = await request.formData()
  const token = String(form.get('token') ?? '')
  const now = nowOf(deps)
  const link = /^[A-Za-z0-9_-]{30,}$/.test(token) ? await deps.store.useLoginLink(sha256(token), now) : null
  if (!link) return signinPage(deps, '/account', 'That sign-in link has expired or was already used. Ask for a new one below.')
  let account = await deps.store.findAccountByEmail(link.email)
  if (!account) {
    account = { id: randomUUID(), github_id: null, github_login: null, email: link.email }
    await deps.store.insertAccount(account, now)
  } else {
    await deps.store.updateAccountLogin(account.id, {}, now)
  }
  return redirect(safeReturn(link.return_to), await startSession(deps.store, account.id, now))
}

export async function signOut(deps: AccountDeps, request: Request): Promise<Response> {
  const id = cookies(request).get(SESSION_COOKIE)
  if (id && sameOrigin(request)) await deps.store.deleteAccountSession(sha256(id))
  return redirect('/', setCookie(SESSION_COOKIE, '', 0))
}

// ---------- the account page ----------

type Protections = Awaited<ReturnType<GitHubApp['branchProtections']>>
type OrgProject = {
  name: string; github: string; permission: string; counts: Record<string, number>
  review: { localId: string; title: string; url: string | null; signals: string[] }[]
  protections: Protections
}

async function organizationProjects(deps: AccountDeps, account: AccountRow): Promise<OrgProject[]> {
  if (!account.github_login) return []
  const app = await deps.githubApp()
  if (!app) return []
  const result: OrgProject[] = []
  for (const project of (await deps.store.listProjects()).slice(0, 30)) {
    const repo = parseRepo(project.github)
    if (!repo) continue
    const permission = await app.collaboratorPermission(repo.owner, repo.repo, account.github_login).catch(() => 'none')
    if (!['admin', 'maintain', 'write'].includes(permission)) continue
    const tasks = await deps.store.listTasks(project.id)
    const counts: Record<string, number> = {}
    for (const task of tasks) counts[task.state] = (counts[task.state] ?? 0) + 1
    const review = await Promise.all(tasks.filter((t) => t.state === 'review').map(async (t) => {
      const latest = new Map<string, string>()
      for (const sig of await deps.store.listTaskSignals(t.id)) {
        const group = sig.kind.startsWith('checks') ? 'checks' : 'review'
        if (!latest.has(group)) latest.set(group, SIGNAL_TEXT[sig.kind] ?? sig.kind)
      }
      return { localId: t.localId, title: t.title, url: t.submissionUrl, signals: [...latest.values()] }
    }))
    result.push({
      name: project.name,
      github: project.github!,
      permission,
      counts,
      review,
      protections: await app.branchProtections(repo.owner, repo.repo).catch(() => null),
    })
  }
  return result
}

const SIGNAL_TEXT: Record<string, string> = {
  changes_requested: 'you asked for changes',
  approved: 'you approved it',
  checks_failed: 'CI failed',
  checks_passed: 'CI passed',
}

function protectionList(p: Protections): string {
  if (!p) return '<p class="muted">We could not read this repository\'s protections.</p>'
  const item = (ok: boolean, good: string, bad: string) => `<li class="${ok ? 'ok' : 'todo'}">${ok ? good : bad}</li>`
  return `<ul class="checklist">
    ${item(p.pullRequestRequired, `Changes to <code>${esc(p.branch)}</code> need a pull request`, `Require a pull request before merging into <code>${esc(p.branch)}</code>`)}
    ${item(p.checksRequired, 'Your checks must pass before merging', 'Make your tests a required check before merging')}
    ${item(p.reviewsRequired > 0, `At least ${p.reviewsRequired} approving review required`, 'Require at least one approving review')}
  </ul>
  <p class="help"><a href="/guides/secure-your-repository">Secure your repository in 5 minutes</a> also covers secret scanning, push protection and code scanning.</p>`
}

const date = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : 'never')

function clientLabel(clientId: string, name?: string | null): string {
  if (name) return name
  try {
    return new URL(clientId).hostname
  } catch {
    return 'AI app'
  }
}

export async function accountPage(deps: AccountDeps, request: Request, notice?: string): Promise<Response> {
  const now = nowOf(deps)
  const account = await currentAccount(deps.store, request, now)
  if (!account) return redirect(`/signin?return=${encodeURIComponent('/account')}`)
  const donorId = await deps.store.donorForAccount(account.id)
  const donor = donorId ? await deps.store.getDonor(donorId) : null
  const who = account.github_login ? `GitHub: ${account.github_login}` : account.email ?? ''

  let volunteer: string
  if (donor) {
    const allTasks = await deps.store.listAllTasks()
    const done = allTasks.filter((t) => t.donorId === donor.id && t.state === 'done')
    const projects = new Set(done.map((t) => t.projectId)).size
    const limit = donor.monthlyTaskBudget ?? 0
    const keys = await deps.store.listTokens(donor.id)
    let apps: { id: string; label: string; created: number }[] = []
    if (deps.oauth) {
      const grants = await deps.oauth.listUserGrants(donor.id).catch(() => ({ items: [] as { id: string; clientId: string; createdAt: number }[] }))
      apps = await Promise.all(grants.items.map(async (g) => {
        const client = await deps.oauth!.lookupClient(g.clientId).catch(() => null)
        return { id: g.id, label: clientLabel(g.clientId, client?.clientName), created: g.createdAt * (g.createdAt < 1e12 ? 1000 : 1) }
      }))
    }
    volunteer = `<section class="panel" aria-labelledby="v-head">
  <h2 id="v-head">Your volunteering</h2>
  <div class="stats">
    <div class="stat"><strong>${done.length}</strong><span>tasks finished</span></div>
    <div class="stat"><strong>${projects}</strong><span>projects helped</span></div>
    <div class="stat"><strong>${donor.spentTasks} of ${limit}</strong><span>tasks this month</span></div>
  </div>
  <p>Your public name is <strong>${esc(donor.handle)}</strong>. <a href="/volunteers/${encodeURIComponent(donor.handle)}">See your public record</a>.</p>

  <h3>Tasks per month</h3>
  <form method="post" action="/account/monthly" class="form inline-form">
    <label for="monthly">At most</label>
    <input id="monthly" name="monthly" type="number" min="0" max="50" value="${limit}">
    <button class="button button-quiet" type="submit">Save</button>
  </form>
  <p class="help">0 pauses volunteering. Each task uses about as much of your AI plan as a normal working session of 15 to 60 minutes.</p>

  <h3>Connected AI apps</h3>
  ${apps.length ? `<ul class="rows">${apps.map((a) => `<li><span><strong>${esc(a.label)}</strong> <span class="muted">since ${date(a.created)}</span></span>
    <form method="post" action="/account/apps/disconnect"><input type="hidden" name="grant" value="${esc(a.id)}"><button class="link-button" type="submit">Disconnect</button></form></li>`).join('')}</ul>`
    : '<p class="muted">None yet. Add the connector in your AI app: <a href="/volunteer#start">how to connect</a>.</p>'}

  <h3>Keys for coding tools</h3>
  <p class="help">Chat apps sign in by themselves and need no key. Coding tools such as Claude Code, Codex or Gemini CLI use a key: make one per tool, so you can switch each off on its own.</p>
  ${keys.length ? `<ul class="rows">${keys.map((k) => `<li><span><strong>${esc(k.label ?? 'Key from your first sign-up')}</strong> <span class="muted">made ${date(k.created_at)}, last used ${date(k.last_used_at)}</span></span>
    <form method="post" action="/account/keys/revoke"><input type="hidden" name="key" value="${esc(k.id)}"><button class="link-button" type="submit">Switch off</button></form></li>`).join('')}</ul>` : ''}
  <form method="post" action="/account/keys" class="form inline-form">
    <label for="label">Key for</label>
    <input id="label" name="label" maxlength="40" placeholder="Claude Code on my laptop" required>
    <button class="button button-quiet" type="submit">Make a key</button>
  </form>
</section>`
  } else {
    volunteer = `<section class="panel" aria-labelledby="v-head">
  <h2 id="v-head">Volunteer with your AI</h2>
  <p>Pick a public name and how many tasks a month you'd like to give. You can change both later.</p>
  <form method="post" action="/account/volunteer" class="form">
    <label for="nickname">Public name</label>
    <input id="nickname" name="nickname" maxlength="32" pattern="[A-Za-z][A-Za-z0-9-]{1,31}" required>
    <p class="help">Shown next to the tasks you finish. 2 to 32 letters, numbers or dashes. Not your email.</p>
    <label for="monthly">Tasks per month, at most</label>
    <input id="monthly" name="monthly" type="number" min="1" max="50" value="5">
    <label class="check"><input type="checkbox" name="agree" value="yes" required> <span>I've read the <a href="/terms#volunteers">volunteer rules</a>. My AI works on my own plan, within its terms.</span></label>
    <button class="button" type="submit">Start volunteering</button>
  </form>
  <details class="more">
    <summary>Already volunteering with a connection key?</summary>
    <form method="post" action="/account/link" class="form">
      <label for="key">Your connection key</label>
      <input id="key" name="key" autocomplete="off" spellcheck="false" placeholder="vbk_..." required>
      <button class="button button-quiet" type="submit">Add it to this account</button>
    </form>
  </details>
</section>`
  }

  const orgProjects = await organizationProjects(deps, account)
  const applications = await deps.store.listApplicationsFor(account.email, account.github_login)
  const org = orgProjects.length || applications.length
    ? `<section class="panel" aria-labelledby="o-head">
  <h2 id="o-head">Your organization's projects</h2>
  ${orgProjects.map((p) => `<article class="org-project">
    <h3><a href="/projects/${slugify(p.name)}">${esc(p.name)}</a></h3>
    <p class="muted"><a href="https://github.com/${esc(p.github.replace(/^https:\/\/github.com\//, ''))}">${esc(p.github.replace(/^https:\/\/github.com\//, ''))}</a> · you can ${p.permission === 'write' ? 'merge' : 'manage'} it on GitHub</p>
    <p>${Object.entries(p.counts).map(([state, n]) => `<span class="status ${statusLabel(state).cls}">${n} ${esc(statusLabel(state).text.toLowerCase())}</span>`).join(' ') || 'No tasks yet.'}</p>
    ${p.review.length ? `<p><strong>Waiting for your review:</strong></p><ul>${p.review.map((r) => `<li>${r.url ? `<a href="${esc(r.url)}">${esc(r.title)}</a>` : esc(r.title)}${r.signals.length ? ` <span class="muted">(${esc(r.signals.join(', '))})</span>` : ''}</li>`).join('')}</ul>` : ''}
    <h4>Safety settings on GitHub</h4>
    ${protectionList(p.protections)}
  </article>`).join('')}
  ${applications.length ? `<h3>Applications</h3><ul class="rows">${applications.map((a) => `<li><span><strong>${esc(a.org_name)}</strong> <span class="muted">sent ${date(a.created_at)}</span></span><span class="status">${esc(a.state === 'new' ? 'being reviewed' : a.state)}</span></li>`).join('')}</ul>` : ''}
  <p class="help">To change a task, edit <code>volunteer-compute.yaml</code> in your repository. Changes show here within 15 minutes.</p>
</section>`
    : `<section class="panel" aria-labelledby="o-head">
  <h2 id="o-head">For organizations</h2>
  <p>${account.github_login ? "We don't see a project you manage yet." : 'Sign in with GitHub to see the projects you manage.'} <a href="/organizations">How to bring your work here</a>.</p>
</section>`

  const github = await deps.store.getSigninApp()
  const connectGithub = !account.github_login && github
    ? `<p><a class="button button-quiet button-small" href="/auth/github?return=%2Faccount">Connect GitHub</a> <span class="muted">to see projects you manage, or to code tasks yourself.</span></p>`
    : ''
  return privatePage('Your account', `<div class="wrap page-head narrow">
  <h1>Your account</h1>
  <p class="lead">${esc(who)}</p>
  ${connectGithub}
  ${notice ? `<p class="notice" role="status">${esc(notice)}</p>` : ''}
</div>
<div class="wrap section narrow account">
${volunteer}
${org}
<form method="post" action="/signout"><button class="button button-quiet" type="submit">Sign out</button></form>
</div>`)
}

// ---------- account actions ----------

export function toolSetup(token: string): string {
  const t = esc(token)
  const claude = `claude mcp add --scope user --transport http volunteer ${MCP_URL} --header "Authorization: Bearer ${t}"`
  const gemini = `gemini mcp add --scope user --transport http --header "Authorization: Bearer ${t}" volunteer ${MCP_URL}`
  return `<h3>Claude Code</h3><pre><code>${claude}</code></pre><button class="copy" type="button" data-copy="${claude}">Copy command</button>
<h3>Gemini CLI</h3><pre><code>${gemini}</code></pre><button class="copy" type="button" data-copy="${gemini}">Copy command</button>
<h3>Codex</h3><pre><code>export VOLUNTEER_TOKEN=${t}
codex mcp add volunteer --url ${MCP_URL} --bearer-token-env-var VOLUNTEER_TOKEN</code></pre>
<h3>Other tools</h3><p>Server address <code>${MCP_URL}</code>, header <code>Authorization: Bearer</code> followed by the key.</p>`
}

export async function accountAction(deps: AccountDeps, request: Request, action: string): Promise<Response> {
  if (!sameOrigin(request)) return accountPage(deps, request, 'Please use the forms on this page.')
  const now = nowOf(deps)
  const account = await currentAccount(deps.store, request, now)
  if (!account) return redirect('/signin?return=%2Faccount')
  const form = await request.formData()
  const donorId = await deps.store.donorForAccount(account.id)
  const back = (notice: string) => redirect(`/account?notice=${encodeURIComponent(notice)}`)

  if (action === 'volunteer') {
    if (donorId) return back('You already volunteer.')
    const nickname = String(form.get('nickname') ?? '').trim().toLowerCase()
    const monthly = Number(form.get('monthly'))
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(nickname)) return back('Choose a name of 2 to 32 letters, numbers or dashes, starting with a letter.')
    if (!Number.isInteger(monthly) || monthly < 1 || monthly > 50) return back('Choose between 1 and 50 tasks per month.')
    if (form.get('agree') !== 'yes') return back('Please confirm the volunteer rules.')
    if (await deps.store.handleTaken(nickname)) return back(`The name ${nickname} is taken. Please choose another.`)
    const created = await deps.createVolunteer({ nickname, monthly, accountId: account.id })
    return back(created.ok ? `Welcome, ${nickname}. Now connect your AI app.` : created.error)
  }
  if (action === 'link') {
    if (donorId) return back('This account already has a volunteer name.')
    const key = String(form.get('key') ?? '').trim()
    const okRate = await deps.store.hitRateLimit(sha256(`link:${account.id}:${new Date(now).toISOString().slice(0, 10)}`), 10, 24 * 60 * 60 * 1000, now)
    const found = okRate && key.startsWith('vbk_') ? await deps.store.findActiveDonorByTokenHash(sha256(key)) : null
    if (!found) return back("That key wasn't recognized.")
    const linked = await deps.store.linkDonorToAccount(found, account.id)
    return back(linked ? 'Your volunteer name is now part of this account.' : 'That volunteer name already belongs to another account.')
  }
  if (!donorId) return back('Start volunteering first.')
  if (action === 'monthly') {
    const monthly = Number(form.get('monthly'))
    if (!Number.isInteger(monthly) || monthly < 0 || monthly > 50) return back('Choose between 0 and 50 tasks per month.')
    await deps.store.setMonthlyTaskBudget(donorId, monthly)
    return back(monthly === 0 ? 'Volunteering is paused.' : `Saved: at most ${monthly} tasks a month.`)
  }
  if (action === 'keys/revoke') {
    const changed = await deps.store.revokeToken(donorId, String(form.get('key') ?? ''), now)
    return back(changed ? 'That key is switched off.' : 'That key was already off.')
  }
  if (action === 'apps/disconnect') {
    if (deps.oauth) await deps.oauth.revokeGrant(String(form.get('grant') ?? ''), donorId).catch(() => undefined)
    return back('That app is disconnected.')
  }
  if (action === 'keys') {
    const label = String(form.get('label') ?? '').trim().slice(0, 40) || 'Coding tool'
    if ((await deps.store.listTokens(donorId)).length >= 10) return back('You have 10 keys. Switch one off first.')
    const token = `vbk_${randomBytes(32).toString('base64url')}`
    await deps.store.insertToken(randomUUID(), donorId, sha256(token), now, label)
    return privatePage('Your new key', `<div class="wrap page-head narrow">
  <h1>Your key for ${esc(label)}</h1>
  <p class="lead">Copy it into your tool now. It's shown only once. If you lose it, switch it off on your account page and make a new one.</p>
  <div class="keybox"><code>${esc(token)}</code><button class="copy" type="button" data-copy="${esc(token)}">Copy key</button></div>
</div>
<section class="wrap section narrow">
<h2>Add it to your tool</h2>
${toolSetup(token)}
<p class="actions"><a class="button" href="/account">Back to your account</a></p>
</section>`)
  }
  return back('Unknown action.')
}

// ---------- one-time setup: the GitHub app used only for signing in ----------

export function signinAppManifest(origin: string) {
  return {
    name: 'Volunteer Pool sign-in',
    url: origin,
    description: 'Sign in to Volunteer Pool with GitHub. It can read your public profile and email address, nothing else.',
    callback_urls: [`${origin}/auth/github/callback`],
    redirect_url: `${origin}/setup/signin/callback`,
    public: true,
    hook_attributes: { url: `${origin}/github/webhook`, active: false },
    default_permissions: { emails: 'read' },
    default_events: [],
  }
}

export async function signinSetupStart(store: SqliteStore, url: URL, now: number): Promise<Response> {
  const code = url.searchParams.get('code') ?? ''
  if (!code || !(await store.setupCodeValid(sha256(code), now))) return privatePage('Link expired', '<div class="wrap page-head narrow"><h1>This setup link has expired or was already used.</h1></div>', 403)
  const manifest = esc(JSON.stringify(signinAppManifest(url.origin)))
  return privatePage('Set up GitHub sign-in', `<div class="wrap page-head narrow">
  <h1>Set up "Sign in with GitHub"</h1>
  <p class="lead">This creates a small GitHub App used only to sign people in. It can read a person's profile and email address, nothing in any repository.</p>
  <form method="post" action="https://github.com/settings/apps/new?state=${encodeURIComponent(code)}">
    <input type="hidden" name="manifest" value="${manifest}">
    <button class="button" type="submit">Create the sign-in app on GitHub</button>
  </form>
</div>`, 200, { 'content-security-policy': "default-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; form-action https://github.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'" })
}

export async function signinSetupCallback(store: SqliteStore, masterKey: Buffer, url: URL, now: number, fetcher: FetchLike = (i, init) => fetch(i, init)): Promise<Response> {
  const state = url.searchParams.get('state') ?? ''
  const ghCode = url.searchParams.get('code') ?? ''
  if (!state || !ghCode || !(await store.setupCodeValid(sha256(state), now))) return privatePage('Link expired', '<div class="wrap page-head narrow"><h1>This setup link has expired or was already used.</h1></div>', 403)
  const response = await fetcher(`https://api.github.com/app-manifests/${encodeURIComponent(ghCode)}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'volunteer-pool' },
  })
  if (!response.ok) return privatePage('GitHub refused', `<div class="wrap page-head narrow"><h1>GitHub did not finish creating the app (${response.status}).</h1></div>`, 502)
  const app = (await response.json()) as { slug: string; client_id: string; client_secret: string }
  if (!(await store.useSetupCode(sha256(state), now))) return privatePage('Link expired', '<div class="wrap page-head narrow"><h1>This setup link was already used.</h1></div>', 403)
  await store.saveSigninApp({ clientId: app.client_id, clientSecretSealed: JSON.stringify(encryptSecret(app.client_secret, masterKey)), slug: app.slug }, now)
  return redirect('/signin?return=%2Faccount')
}
