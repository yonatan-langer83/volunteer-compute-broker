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
import { parseManifestYaml } from './manifest.js'
import { createMcpServer } from './mcp-tools.js'
import { handleAuthorize } from './site/authorize.js'
import { notFoundPage } from './site/pages.js'
import { handleApply, handleJoin, handleSiteGet, handleWaitlist, passesTurnstile, type SiteDeps } from './site/router.js'
import { loadPublicBoard, renderPublicHtml } from './public-board.js'
import { SqliteStore } from './sqlite-store.js'
import { containerCheckRunner } from './test-runner.js'
import type { ProjectRecord } from './types.js'
import { Workspaces, type RepoReader } from './workspace.js'

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
}

const STATIC = /^\/(site\.css|site\.js|favicon\.svg|og\.png|fonts\/[a-z0-9-]+\.woff2)$/

function siteDeps(env: Env, store: SqliteStore): SiteDeps {
  return {
    store,
    config: { turnstileSiteKey: env.TURNSTILE_SITE_KEY || null, contactEmail: env.CONTACT_EMAIL || null },
    turnstileSecret: env.TURNSTILE_SECRET || null,
  }
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
        turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
        verifyTurnstile: (form, req) => passesTurnstile(siteDeps(env, store), form, req),
        createVolunteer: async (nickname, monthly) => {
          const response = await env.BROKER.get(env.BROKER.idFromName('broker')).fetch(
            new Request('https://broker/internal/volunteer', { method: 'POST', body: JSON.stringify({ nickname, monthly }) }),
          )
          return (await response.json()) as { ok: true; donorId: string; token: string } | { ok: false; error: string }
        },
      }))
    }
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
    const toBroker = url.pathname === '/mcp' || url.pathname.startsWith('/admin') || url.pathname === '/github/webhook' ||
      (url.pathname === '/volunteer/join' && request.method === 'POST')
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
  return new Request(request, { headers })
}

// Signed-in MCP requests: the OAuth layer has checked the token (or a
// volunteer's connection key) and put the volunteer in ctx.props.
const mcpApi = {
  async fetch(request: Request, env: Env, ctx: { props?: { donorId?: string } }): Promise<Response> {
    const donorId = ctx.props?.donorId
    if (!donorId) return Response.json({ error: 'unauthorized' }, { status: 401 })
    const headers = new Headers(request.headers)
    headers.set('x-volunteer-donor', donorId)
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
        const donorId = await withStore(env, (store) => store.findActiveDonorByTokenHash(createHash('sha256').update(token).digest('hex')))
        return donorId ? { props: { donorId }, audience: resource } : null
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
    if (url.pathname === '/internal/sync' && request.method === 'POST') return Response.json(await this.syncProjects(broker))
    if (url.pathname.startsWith('/admin')) return handleAdmin(broker, request, this.env.ADMIN_TOKEN ?? '')
    if (url.pathname === '/volunteer/join' && request.method === 'POST') {
      return handleJoin(siteDeps(this.env, this.store!), broker, request)
    }
    if (url.pathname === '/github/webhook' && request.method === 'POST') {
      return handleGithubWebhook(broker, this.store!, loadMasterKey(this.env.BROKER_MASTER_KEY), request)
    }
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  private workspaces: Workspaces | null = null

  private async createVolunteer(broker: Broker, request: Request): Promise<Response> {
    const { nickname, monthly } = (await request.json()) as { nickname: string; monthly: number }
    if (await this.store!.handleTaken(nickname)) return Response.json({ ok: false, error: `The nickname ${nickname} is taken. Please choose another.` })
    const donor = await broker.registerMcpDonor({ name: nickname, monthlyTasks: monthly, acceptTerms: true })
    const { token } = await broker.mintMcpToken(donor.id)
    return Response.json({ ok: true, donorId: donor.id, token })
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
    }
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
        const manifest = parseManifestYaml(yaml)
        if (manifest.project.name !== project.name) continue
        const agentsMd = await reader.readFile(sha, 'AGENTS.md')
        results.push(await broker.syncManifest({ manifest, agentsMd }))
      } catch (error) {
        results.push({ project: project.name, error: error instanceof Error ? error.message : String(error) })
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
