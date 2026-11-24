import { DurableObject } from 'cloudflare:workers'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import { handleAdmin } from './admin.js'
import { Broker } from './broker.js'
import { loadMasterKey } from './crypto.js'
import { D1Sql } from './d1-sql.js'
import { createFakeRegistry } from './fake-provider.js'
import { createPullRequestOpener, handleGithubWebhook, handleSetupCallback, handleSetupStart } from './github-routes.js'
import { createMcpServer } from './mcp-tools.js'
import { notFoundPage } from './site/pages.js'
import { handleApply, handleJoin, handleSiteGet, handleWaitlist, type SiteDeps } from './site/router.js'
import { loadPublicBoard, renderPublicHtml } from './public-board.js'
import { SqliteStore } from './sqlite-store.js'

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
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
      return withStore(env, async (store) => (await handleSiteGet(siteDeps(env, store), url)) ?? notFoundPage())
    }
    const id = env.BROKER.idFromName('broker')
    return env.BROKER.get(id).fetch(request)
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

  async fetch(request: Request): Promise<Response> {
    const run = this.queue.then(() => this.handle(request))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async handle(request: Request): Promise<Response> {
    let broker: Broker
    try {
      broker = this.broker()
    } catch {
      return Response.json({ error: 'broker_unavailable' }, { status: 500 })
    }
    const url = new URL(request.url)
    if (url.pathname === '/mcp') return handleMcp(broker, request)
    if (url.pathname.startsWith('/admin')) return handleAdmin(broker, request, this.env.ADMIN_TOKEN ?? '')
    if (url.pathname === '/volunteer/join' && request.method === 'POST') {
      return handleJoin(siteDeps(this.env, this.store!), broker, request)
    }
    if (url.pathname === '/github/webhook' && request.method === 'POST') {
      return handleGithubWebhook(broker, this.store!, loadMasterKey(this.env.BROKER_MASTER_KEY), request)
    }
    return Response.json({ error: 'not_found' }, { status: 404 })
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

async function handleMcp(broker: Broker, request: Request): Promise<Response> {
  if (request.method === 'GET' || request.method === 'DELETE') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  }
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  const donorId = token ? await broker.authenticateMcpToken(token) : null
  if (!donorId) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const mcp = createMcpServer(broker, () => donorId)
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
