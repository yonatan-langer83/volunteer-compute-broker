import { NO_REVIEW_RULE, reviewRequired } from './routines.js'
import { createHash } from 'node:crypto'

import { DurableObject } from 'cloudflare:workers'
import OAuthProvider, { type OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import { handleAdmin } from './admin.js'
import { Broker } from './broker.js'
import { loadMasterKey } from './crypto.js'
import { D1Sql } from './d1-sql.js'
import { createFakeRegistry } from './fake-provider.js'
import { GitHubApp, parseRepo } from './github-app.js'
import { createPullRequestOpener, handleGithubWebhook, handleSetupCallback, handleSetupStart, loadAppCredentials } from './github-routes.js'
import { issueToTask, READY_LABEL } from './issue-tasks.js'
import { parseManifestYaml, type ManifestTask } from './manifest.js'
import { createMcpServer } from './mcp-tools.js'
import {
  accountAction, accountPage, emailStart, emailVerify, emailVerifyPage, githubCallback, githubStart, signinPage,
  signinSetupCallback, signinSetupStart, signOut, safeReturn, type AccountDeps, type CreateLinkedVolunteer,
} from './site/account.js'
import { handleAuthorize } from './site/authorize.js'
import { notFoundPage } from './site/pages.js'
import { handleApply, handleSiteGet, handleWaitlist, passesTurnstile, type SiteDeps } from './site/router.js'
import { loadPublicBoard, renderPublicHtml } from './public-board.js'
import { SqliteStore } from './sqlite-store.js'
import { containerCheckRunner } from './test-runner.js'
import type { ProjectRecord } from './types.js'
import { Workspaces, type RepoReader } from './workspace.js'


const NO_REVIEW_NOTE = 'Your tasks are paused until your main branch requires a pull request with at least one approving review. Add a branch ruleset: Settings → Rules → Rulesets → New branch ruleset, target the default branch, turn on "Require a pull request before merging" with 1 required approval. (Classic branch protection is not visible to our app, so please use a ruleset.)'

const CONFLICT_NOTE = [
  'This volunteer change now conflicts with the main branch, so GitHub cannot bring it up to date by itself.',
  '',
  'Two easy ways forward:',
  '- **Small conflict:** use "Resolve conflicts" on this page and keep both sides where they make sense.',
  '- **Otherwise:** close this pull request. The task goes back to the pool and the next volunteer starts from the current main branch.',
].join('\n')

export { TestRunner } from './test-runner.js'


type D1Database = ConstructorParameters<typeof D1Sql>[0]

type ObjectId = { toString(): string }

type ObjectNamespace = {
  idFromName(name: string): ObjectId
  get(id: ObjectId): { fetch(request: Request): Promise<Response> }
}

export interface Env {
  DB: D1Database
  BROKER: ObjectNamespace
  BROKER_MASTER_KEY: string
  ADMIN_TOKEN: string
  ASSETS?: { fetch(request: Request): Promise<Response> }
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_SECRET?: string
  CONTACT_EMAIL?: string
  OAUTH_KV: unknown
  OAUTH_PROVIDER: OAuthHelpers
  TEST_RUNNER?: ObjectNamespace
  // "true" once the Cloudflare deploy token may create test machines (Containers).
  CHECKS_ENABLED?: string
  // Cloudflare Email Sending (needs Workers Paid). Without it, email sign-in is hidden.
  EMAIL?: { send(message: { to: string; from: { email: string; name: string }; subject: string; text: string; html: string }): Promise<unknown> }
  EMAIL_FROM?: string
}

const STATIC = /^\/(site\.css|site\.js|favicon\.svg|favicon\.ico|apple-touch-icon\.png|icon-512\.png|og\.png|fonts\/[a-zA-Z0-9.-]+)$/

function siteDeps(env: Env, store: SqliteStore): SiteDeps {
  return {
    store,
    config: { turnstileSiteKey: env.TURNSTILE_SITE_KEY || null, contactEmail: env.CONTACT_EMAIL || null },
    turnstileSecret: env.TURNSTILE_SECRET || null,
  }
}

function createLinkedVolunteer(env: Env): CreateLinkedVolunteer {
  return async ({ nickname, monthly, accountId }) => {
    const response = await env.BROKER.get(env.BROKER.idFromName('broker')).fetch(
      new Request('https://broker/internal/volunteer', { method: 'POST', body: JSON.stringify({ nickname, monthly, accountId }) }),
    )
    return (await response.json()) as { ok: true; donorId: string } | { ok: false; error: string }
  }
}

function accountDeps(env: Env, store: SqliteStore): AccountDeps {
  const masterKey = loadMasterKey(env.BROKER_MASTER_KEY)
  const email = env.EMAIL
  return {
    store,
    masterKey,
    oauth: env.OAUTH_PROVIDER ?? null,
    sendEmail: email
      ? async (message) => {
        await email.send({ ...message, from: { email: env.EMAIL_FROM || 'signin@apishelf.dev', name: 'Volunteer Pool' } })
      }
      : null,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
    verifyTurnstile: (form, req) => passesTurnstile(siteDeps(env, store), form, req),
    createVolunteer: createLinkedVolunteer(env),
    githubApp: async () => {
      const creds = await loadAppCredentials(store, masterKey)
      return creds ? new GitHubApp(creds) : null
    },
  }
}

const ACCOUNT_ACTIONS = new Set(['volunteer', 'link', 'monthly', 'keys', 'keys/revoke', 'apps/disconnect', 'reviewer', 'onboarder', 'onboarding/take', 'onboarding/update'])

async function accountRoutes(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname
  const get = request.method === 'GET' || request.method === 'HEAD'
  const post = request.method === 'POST'
  const run = (fn: (deps: AccountDeps) => Promise<Response>) => withStore(env, (store) => fn(accountDeps(env, store)))
  if (get && path === '/signin') {
    const app = url.searchParams.get('for')
    return run((deps) => signinPage(deps, safeReturn(url.searchParams.get('return')), undefined, app))
  }
  if (get && path === '/auth/github') return run((deps) => githubStart(deps, url))
  if (get && path === '/auth/github/callback') return run((deps) => githubCallback(deps, request, url))
  if (post && path === '/auth/email') return run((deps) => emailStart(deps, request))
  if (get && path === '/auth/email/verify') return run((deps) => emailVerifyPage(deps, url))
  if (post && path === '/auth/email/verify') return run((deps) => emailVerify(deps, request))
  if (post && path === '/signout') return run((deps) => signOut(deps, request))
  if (get && path === '/account') return run((deps) => accountPage(deps, request, url.searchParams.get('notice') ?? undefined))
  if (post && path.startsWith('/account/') && ACCOUNT_ACTIONS.has(path.slice('/account/'.length))) {
    return run((deps) => accountAction(deps, request, path.slice('/account/'.length)))
  }
  if (get && path === '/setup/signin') return withStore(env, (store) => signinSetupStart(store, url, Date.now()))
  if (get && path === '/setup/signin/callback') return withStore(env, (store) => signinSetupCallback(store, loadMasterKey(env.BROKER_MASTER_KEY), url, Date.now()))
  return null
}

async function withStore<T>(env: Env, run: (store: SqliteStore) => Promise<T>): Promise<T> {
  const store = new SqliteStore(new D1Sql(env.DB))
  try {
    await store.prepare()
    return await run(store)
  } finally {
    await store.close()
  }
}

// Public pages change only when the board changes. Keep a copy at the edge
// for a minute so most visits skip the database entirely.
async function cachedPage(request: Request, ctx: { waitUntil?(p: Promise<unknown>): void } | undefined, render: () => Promise<Response>): Promise<Response> {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default
  if (!cache || request.method !== 'GET') return render()
  const key = new Request(new URL(request.url).toString(), { method: 'GET' })
  const hit = await cache.match(key)
  if (hit) return hit
  const response = await render()
  const control = response.headers.get('cache-control') ?? ''
  if (response.status === 200 && control.includes('public') && !response.headers.has('set-cookie')) {
    const put = cache.put(key, response.clone())
    if (ctx?.waitUntil) ctx.waitUntil(put)
    else await put
  }
  return response
}

const siteHandler = {
  async fetch(request: Request, env: Env, ctx?: { waitUntil?(p: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/authorize') {
      return withStore(env, (store) => handleAuthorize(request, {
        oauth: env.OAUTH_PROVIDER,
        store,
        createVolunteer: createLinkedVolunteer(env),
      }))
    }
    const account = await accountRoutes(request, env, url)
    if (account) return account
    if ((request.method === 'GET' || request.method === 'HEAD') && STATIC.test(url.pathname) && env.ASSETS) return env.ASSETS.fetch(request)
    if (request.method === 'GET' && isPublicPath(url.pathname)) return servePublic(env, url.pathname)
    if (request.method === 'GET' && (url.pathname === '/setup/github' || url.pathname === '/setup/github/callback')) {
      const store = new SqliteStore(new D1Sql(env.DB))
      try {
        await store.prepare()
        return url.pathname === '/setup/github'
          ? await handleSetupStart(store, url, Date.now())
          : await handleSetupCallback(store, loadMasterKey(env.BROKER_MASTER_KEY), url, Date.now())
      } finally {
        await store.close()
      }
    }
    if (request.method === 'POST' && url.pathname === '/organizations/apply') return withStore(env, (store) => handleApply(siteDeps(env, store), request))
    if (request.method === 'POST' && url.pathname === '/waitlist') return withStore(env, (store) => handleWaitlist(siteDeps(env, store), request))
    // The old key form now starts at sign-in.
    if (url.pathname === '/volunteer/join') return Response.redirect(`${url.origin}/signin?return=%2Faccount`, 303)
    const toBroker = url.pathname === '/mcp' || url.pathname.startsWith('/admin') || url.pathname === '/github/webhook'
    if (!toBroker) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return Response.json({ error: 'not_found' }, { status: 404 })
      return cachedPage(request, ctx, () => withStore(env, async (store) => (await handleSiteGet(siteDeps(env, store), url)) ?? notFoundPage()))
    }
    const id = env.BROKER.idFromName('broker')
    return env.BROKER.get(id).fetch(stripInternal(request))
  },
}

// Only the Worker may say who the volunteer is.
function stripInternal(request: Request): Request {
  const headers = new Headers(request.headers)
  headers.delete('x-volunteer-donor')
  headers.delete('x-volunteer-tool')
  return new Request(request, { headers })
}

// Signed-in MCP requests: the OAuth layer has checked the token (or a
// volunteer's connection key) and put the volunteer in ctx.props.
const mcpApi = {
  async fetch(request: Request, env: Env, ctx: { props?: { donorId?: string; via?: string } }): Promise<Response> {
    const donorId = ctx.props?.donorId
    if (!donorId) return Response.json({ error: 'unauthorized' }, { status: 401 })
    const headers = new Headers(request.headers)
    headers.set('x-volunteer-donor', donorId)
    // A connection key means a coding tool on the volunteer's computer; sign-in means a chat app.
    headers.set('x-volunteer-tool', ctx.props?.via === 'key' ? 'coding' : 'chat')
    return env.BROKER.get(env.BROKER.idFromName('broker')).fetch(new Request(request, { headers }))
  },
}

// One sign-in layer per public origin: the real domain in production, the
// local address in local tests. Anything else falls back to the real domain.
const PRODUCTION_ORIGIN = 'https://volunteer.apishelf.dev'
const providers = new Map<string, OAuthProvider<Env>>()

function providerFor(request: Request): OAuthProvider<Env> {
  const origin = new URL(request.url).origin
  const allowed = origin === PRODUCTION_ORIGIN || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin) ? origin : PRODUCTION_ORIGIN
  let provider = providers.get(allowed)
  if (!provider) {
    const resource = `${allowed}/mcp`
    provider = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: mcpApi as never,
      defaultHandler: siteHandler as never,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: ['volunteer'],
      requiredScopes: ['volunteer'],
      resourceMetadata: { resource, authorization_servers: [allowed] },
      clientIdMetadataDocumentEnabled: true,
      // Coding tools keep using a volunteer's connection key as a bearer token.
      resolveExternalToken: async ({ token, env }) => {
        if (!token.startsWith('vbk_')) return null
        const hash = createHash('sha256').update(token).digest('hex')
        const donorId = await withStore(env, async (store) => {
          const found = await store.findActiveDonorByTokenHash(hash)
          if (found) await store.touchToken(hash, Date.now())
          return found
        })
        return donorId ? { props: { donorId, via: 'key' }, audience: resource } : null
      },
    })
    providers.set(allowed, provider)
  }
  return provider
}

export default {
  fetch: (request: Request, env: Env, ctx: unknown) => {
    // Local dev serves the production host over plain http; treat it as https.
    if (request.url.startsWith('http://volunteer.apishelf.dev/')) request = new Request(request.url.replace('http://', 'https://'), request)
    return providerFor(request).fetch(request, env, ctx as never)
  },
  // Every 15 minutes: bring registered projects in line with their task lists on GitHub.
  async scheduled(_event: unknown, env: Env) {
    await env.BROKER.get(env.BROKER.idFromName('broker')).fetch(new Request('https://broker/internal/sync', { method: 'POST' }))
  },
}

export class BrokerObject extends DurableObject<Env> {
  private cached: Broker | null = null
  private store: SqliteStore | null = null
  // D1 calls are outside I/O, so a Durable Object can interleave two requests
  // while either awaits D1. This queue runs broker requests strictly one at a
  // time, which is what the claim and budget logic assumes.
  private queue: Promise<unknown> = Promise.resolve()

  constructor(ctx: unknown, env: Env) {
    super(ctx, env)
  }

  // Changes to shared state run one at a time; reads and test runs don't wait.
  private serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = this.queue.then(fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/mcp') {
      let broker: Broker
      try {
        broker = this.broker()
      } catch {
        return Response.json({ error: 'broker_unavailable' }, { status: 500 })
      }
      return handleMcp(broker, request, request.headers.get('x-volunteer-donor'), {
        connection: request.headers.get('x-volunteer-tool') === 'coding' ? 'coding' : 'chat',
        workspaces: this.workspaces,
        serialize: this.serialize,
      })
    }
    return this.serialize(() => this.handle(request))
  }

  private async handle(request: Request): Promise<Response> {
    let broker: Broker
    try {
      broker = this.broker()
    } catch {
      return Response.json({ error: 'broker_unavailable' }, { status: 500 })
    }
    const url = new URL(request.url)
    if (url.pathname === '/internal/volunteer' && request.method === 'POST') return this.createVolunteer(broker, request)
    if (url.pathname === '/internal/sync' && request.method === 'POST') {
      return Response.json({ ...(await this.syncProjects(broker)), reminders: await this.sendReviewReminders(broker), refreshed: await this.refreshVolunteerPrs(broker) })
    }
    if (url.pathname.startsWith('/admin')) return handleAdmin(broker, request, this.env.ADMIN_TOKEN ?? '')
    if (url.pathname === '/github/webhook' && request.method === 'POST') {
      return handleGithubWebhook(broker, this.store!, loadMasterKey(this.env.BROKER_MASTER_KEY), request)
    }
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  private workspaces: Workspaces | null = null

  private async createVolunteer(broker: Broker, request: Request): Promise<Response> {
    const { nickname, monthly, accountId } = (await request.json()) as { nickname: string; monthly: number; accountId?: string }
    if (await this.store!.handleTaken(nickname)) return Response.json({ ok: false, error: `The name ${nickname} is taken. Please choose another.` })
    if (accountId && await this.store!.donorForAccount(accountId)) return Response.json({ ok: false, error: 'This account already has a volunteer name.' })
    const donor = await broker.registerMcpDonor({ name: nickname, monthlyTasks: monthly, acceptTerms: true })
    if (accountId) {
      // Account volunteers connect apps by signing in, and make keys on their account page.
      await this.store!.linkDonorToAccount(donor.id, accountId)
      return Response.json({ ok: true, donorId: donor.id })
    }
    const { token } = await broker.mintMcpToken(donor.id)
    return Response.json({ ok: true, donorId: donor.id, token })
  }

  private async githubApp(): Promise<GitHubApp | null> {
    const creds = await loadAppCredentials(this.store!, loadMasterKey(this.env.BROKER_MASTER_KEY))
    return creds ? new GitHubApp(creds) : null
  }

  private async reader(project: ProjectRecord): Promise<RepoReader | null> {
    const creds = await loadAppCredentials(this.store!, loadMasterKey(this.env.BROKER_MASTER_KEY))
    const repo = parseRepo(project.github)
    if (!creds || !repo) return null
    const app = new GitHubApp(creds)
    return {
      headSha: () => app.headSha(repo.owner, repo.repo),
      listFiles: (sha) => app.listFiles(repo.owner, repo.repo, sha),
      readFile: (sha, path) => app.readFile(repo.owner, repo.repo, sha, path),
      tarballUrl: (sha) => app.tarballUrl(repo.owner, repo.repo, sha),
      pullRequestHead: (prUrl) => app.pullRequestHead(prUrl),
    }
  }

  // Handbook routine: remind organizations of volunteer pull requests waiting for review.
  private async sendReviewReminders(broker: Broker) {
    const creds = await loadAppCredentials(this.store!, loadMasterKey(this.env.BROKER_MASTER_KEY))
    if (!creds) return []
    const app = new GitHubApp(creds)
    const sent: string[] = []
    for (const due of await broker.reviewReminders()) {
      try {
        if (await app.commentOnPullRequest(due.url, due.body)) {
          await broker.markReminderSent(due.taskId, due.days)
          sent.push(due.url)
        }
      } catch {
        // Try again at the next run.
      }
    }
    return sent
  }

  // Volunteer pull requests that fell behind main get main merged in, so they
  // don't go stale while they wait. A conflict gets one plain comment.
  private async refreshVolunteerPrs(broker: Broker) {
    const app = await this.githubApp()
    if (!app) return []
    const report: { url: string; result: string }[] = []
    for (const task of await this.store!.tasksInReview()) {
      if (!task.submissionUrl) continue
      try {
        const result = await app.refreshPullRequest(task.submissionUrl)
        if (result === 'conflict' && await broker.firstConflictNotice(task.id)) {
          await app.commentOnPullRequest(task.submissionUrl, CONFLICT_NOTE)
        }
        if (result !== 'current') report.push({ url: task.submissionUrl, result })
      } catch (error) {
        console.error('refresh failed', task.submissionUrl, error)
      }
    }
    return report
  }

  private async syncProjects(broker: Broker) {
    const results: unknown[] = []
    for (const project of await this.store!.listProjects()) {
      try {
        const reader = await this.reader(project)
        if (!reader) continue
        const sha = await reader.headSha()
        const yaml = await reader.readFile(sha, 'volunteer-compute.yaml')
        if (!yaml) continue
        // Tasks written as GitHub issues join the ones in the file.
        const issueTasks: ManifestTask[] = []
        const issueProblems: { issue: number; errors: string[] }[] = []
        const app = await this.githubApp()
        const repo = parseRepo(project.github)
        if (app && repo) {
          // Supervision without enforcement is only advice: no tasks go out until a
          // person must approve every change to the main branch.
          const rules = await app.branchProtections(repo.owner, repo.repo)
          if (!reviewRequired(rules)) {
            await this.store!.pauseProjectTasks(project.id, NO_REVIEW_RULE)
            await this.store!.saveSyncNotes(project.id, [{ ref: 'review-rule', message: NO_REVIEW_NOTE }], Date.now())
            results.push({ project: project.name, paused: 'no_review_rule' })
            continue
          }
          let issues: Awaited<ReturnType<GitHubApp['listReadyIssues']>> = []
          try {
            issues = await app.listReadyIssues(repo.owner, repo.repo, READY_LABEL)
          } catch (error) {
            // Most often the installation hasn't accepted the Issues permission yet.
            issueProblems.push({ issue: 0, errors: [`Could not read task issues from GitHub: ${String((error as Error)?.message ?? error).slice(0, 300)}`] })
            console.error('sync: listReadyIssues failed', project.name, error)
          }
          console.log('sync: ready issues', project.name, issues.map((i) => i.number))
          for (const issue of issues) {
            const parsed = issueToTask(issue)
            if (parsed.task) issueTasks.push(parsed.task)
            else issueProblems.push({ issue: issue.number, errors: parsed.errors })
          }
          await this.store!.saveSyncNotes(project.id, issueProblems.map((p) => ({ ref: p.issue ? `issue-${p.issue}` : 'issues', message: p.errors.join('; ') })), Date.now())
        }
        const manifest = parseManifestYaml(yaml, issueTasks)
        if (manifest.project.name !== project.name) continue
        const agentsMd = await reader.readFile(sha, 'AGENTS.md')
        results.push(await broker.syncManifest({ manifest, agentsMd }))
        await this.store!.resumeProjectTasks(project.id, NO_REVIEW_RULE)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('sync failed', project.name, message)
        // Keep it visible to the organization (and us) on the account page.
        await this.store!.saveSyncNotes(project.id, [{ ref: 'sync', message: `Your task list could not be read: ${message.slice(0, 600)}` }], Date.now()).catch(() => undefined)
        results.push({ project: project.name, error: message })
      }
    }
    return { synced: results }
  }

  private broker(): Broker {
    if (this.cached) return this.cached
    const store = new SqliteStore(new D1Sql(this.env.DB))
    this.store = store
    const masterKey = loadMasterKey(this.env.BROKER_MASTER_KEY)
    this.cached = new Broker({
      store,
      masterKey,
      pullRequests: createPullRequestOpener(store, masterKey),
      requirePlan: true,
      providers: createFakeRegistry(),
      logger: {
        info() {},
        error(message) {
          console.error(message)
        },
      },
    })
    this.workspaces = new Workspaces({
      store,
      broker: this.cached,
      reader: (project) => this.reader(project),
      checks: this.env.CHECKS_ENABLED === 'true' && this.env.TEST_RUNNER ? containerCheckRunner(this.env.TEST_RUNNER as never) : null,
    })
    return this.cached
  }
}

function isPublicPath(pathname: string): boolean {
  return pathname === '/public.json' || /^\/public\/tasks\/[^/]+\/patch$/.test(pathname)
}

async function servePublic(env: Env, pathname: string): Promise<Response> {
  const store = new SqliteStore(new D1Sql(env.DB))
  try {
    await store.prepare()
    if (pathname.endsWith('/patch')) {
      const id = decodeURIComponent(pathname.split('/')[3] ?? '')
      const task = await store.getTask(id)
      if (!task?.submissionPatch || task.state !== 'done') return new Response('not found\n', { status: 404 })
      return new Response(task.submissionPatch, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
    }
    const board = await loadPublicBoard(store)
    if (pathname === '/public.json') return Response.json(board)
    return new Response(renderPublicHtml(board), { headers: { 'content-type': 'text/html; charset=utf-8' } })
  } finally {
    await store.close()
  }
}

async function handleMcp(
  broker: Broker,
  request: Request,
  donorId: string | null,
  options: Parameters<typeof createMcpServer>[2],
): Promise<Response> {
  if (request.method === 'GET' || request.method === 'DELETE') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  }
  if (!donorId) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const mcp = createMcpServer(broker, () => donorId, options)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await mcp.connect(transport)
  try {
    return await transport.handleRequest(request)
  } finally {
    await mcp.close()
  }
}
