import { createHash, randomUUID } from 'node:crypto'

import type { Broker } from '../broker.js'
import type { FetchLike } from '../github-app.js'
import { loadPublicBoard } from '../public-board.js'
import type { SqliteStore } from '../sqlite-store.js'
import { SITE, slugify } from './layout.js'
import {
  aboutPage, accessibilityPage, faqPage, homePage, howPage, joinedPage, notFoundPage, organizationsPage, privacyPage,
  projectPage, projectsPage, termsPage, thanksPage, volunteerImpactPage, volunteerPage, volunteersPage, type SiteConfig,
} from './pages.js'

export type SiteDeps = {
  store: SqliteStore
  config: SiteConfig
  turnstileSecret: string | null
  fetcher?: FetchLike
  now?: () => number
}

const PAGES = ['/', '/volunteer', '/organizations', '/how-it-works', '/projects', '/volunteers', '/about', '/faq', '/privacy', '/terms', '/accessibility']

const text = (body: string, type = 'text/plain') =>
  new Response(body, { headers: { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'public, max-age=300' } })

export async function handleSiteGet(deps: SiteDeps, url: URL): Promise<Response | null> {
  const path = url.pathname.length > 1 && url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
  if (path !== url.pathname) return Response.redirect(`${url.origin}${path}${url.search}`, 301)
  const { store, config } = deps
  switch (path) {
    case '/volunteer': return volunteerPage(config)
    case '/organizations': return organizationsPage(config)
    case '/how-it-works': return howPage()
    case '/about': return aboutPage(config)
    case '/faq': return faqPage()
    case '/privacy': return privacyPage(config)
    case '/terms': return termsPage()
    case '/accessibility': return accessibilityPage(config)
    case '/robots.txt': return text(`User-agent: *\nAllow: /\nDisallow: /volunteer/join\nDisallow: /setup/\nSitemap: ${SITE.origin}/sitemap.xml\n`)
    case '/.well-known/security.txt':
      return text(`Contact: ${config.contactEmail ? `mailto:${config.contactEmail}` : `${SITE.origin}/about`}\nExpires: 2027-11-01T00:00:00Z\nPreferred-Languages: en\n`)
  }
  if (path === '/' || path === '/projects' || path === '/volunteers' || path.startsWith('/projects/') || path.startsWith('/volunteers/') || path === '/sitemap.xml' || path === '/llms.txt') {
    const board = await loadPublicBoard(store)
    if (path === '/') return homePage(board)
    if (path === '/projects') return projectsPage(board)
    if (path === '/volunteers') return volunteersPage(board)
    if (path.startsWith('/projects/')) {
      const project = board.projects.find((p) => slugify(p.name) === path.slice('/projects/'.length))
      return project ? projectPage(project) : notFoundPage()
    }
    if (path.startsWith('/volunteers/')) {
      const handle = decodeURIComponent(path.slice('/volunteers/'.length))
      const known = /^[a-z][a-z0-9-]{1,31}$/.test(handle) && await store.handleTaken(handle)
      return volunteerImpactPage(board, handle, known) ?? notFoundPage()
    }
    const urls = [
      ...PAGES,
      ...board.projects.map((p) => `/projects/${slugify(p.name)}`),
      ...board.donors.map((d) => `/volunteers/${d.handle}`),
    ]
    if (path === '/sitemap.xml') {
      return text(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE.origin}${u}</loc></url>`).join('\n')}\n</urlset>\n`, 'application/xml')
    }
    return text(`# ${SITE.name}\n\n> ${SITE.description}\n\n## Start here\n- [Volunteer with your AI tool](${SITE.origin}/volunteer): nickname, one command, no GitHub account.\n- [For organizations](${SITE.origin}/organizations): apply, get set up on GitHub, merge or close pull requests.\n- [How it works](${SITE.origin}/how-it-works)\n- [Questions](${SITE.origin}/faq)\n\n## Public record\n- [Projects](${SITE.origin}/projects)\n- [Volunteers](${SITE.origin}/volunteers)\n- [Machine-readable board](${SITE.origin}/public.json)\n\n## For AI agents\n- MCP server: ${SITE.origin}/mcp (needs a volunteer connection key from ${SITE.origin}/volunteer)\n`)
  }
  return null
}

// ---------- forms ----------

function clientKey(request: Request, now: number, salt: string): string {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const day = new Date(now).toISOString().slice(0, 10)
  return createHash('sha256').update(`${salt}:${ip}:${day}`).digest('hex')
}

export async function passesTurnstile(deps: SiteDeps, form: FormData, request: Request): Promise<boolean> {
  if (!deps.turnstileSecret) return true
  const token = String(form.get('cf-turnstile-response') ?? '')
  if (!token) return false
  const body = new FormData()
  body.set('secret', deps.turnstileSecret)
  body.set('response', token)
  const ip = request.headers.get('cf-connecting-ip')
  if (ip) body.set('remoteip', ip)
  const fetcher = deps.fetcher ?? ((input: string, init?: RequestInit) => fetch(input, init))
  const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
  const result = await response.json() as { success?: boolean }
  return result.success === true
}

const field = (form: FormData, name: string, max = 200) => String(form.get(name) ?? '').trim().slice(0, max)
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
const isUrl = (v: string) => /^https?:\/\/[^\s]+$/i.test(v)

async function guard(deps: SiteDeps, request: Request, form: FormData, bucket: string, limit: number): Promise<string | null> {
  const now = deps.now?.() ?? Date.now()
  if (field(form, 'website_url')) return 'Something went wrong. Please try again.'
  if (!(await passesTurnstile(deps, form, request))) return 'The anti-spam check failed. Please try again.'
  const ok = await deps.store.hitRateLimit(`${bucket}:${clientKey(request, now, bucket)}`, limit, 24 * 60 * 60 * 1000, now)
  return ok ? null : "Too many requests from your network today. Please try again tomorrow."
}

// Runs inside the broker's Durable Object, so nickname checks and sign-ups
// happen one at a time.
export async function handleJoin(deps: SiteDeps, broker: Broker, request: Request): Promise<Response> {
  const form = await request.formData()
  const nickname = field(form, 'nickname', 40)
  const monthlyRaw = field(form, 'monthly', 4)
  const values = { nickname, monthly: monthlyRaw }
  const monthly = Number(monthlyRaw)
  const blocked = await guard(deps, request, form, 'join', 20)
  if (blocked) return volunteerPage(deps.config, blocked, values)
  if (!/^[A-Za-z][A-Za-z0-9-]{1,31}$/.test(nickname)) {
    return volunteerPage(deps.config, 'Choose a nickname of 2 to 32 letters, numbers or dashes, starting with a letter.', values)
  }
  if (!Number.isInteger(monthly) || monthly < 1 || monthly > 50) {
    return volunteerPage(deps.config, 'Choose between 1 and 50 tasks per month.', values)
  }
  if (field(form, 'agree') !== 'yes') return volunteerPage(deps.config, 'Please confirm the volunteer rules.', values)
  const handle = nickname.toLowerCase()
  if (await deps.store.handleTaken(handle)) {
    return volunteerPage(deps.config, `The nickname ${handle} is taken. Please choose another.`, values)
  }
  const donor = await broker.registerMcpDonor({ name: handle, monthlyTasks: monthly, acceptTerms: true })
  const { token } = await broker.mintMcpToken(donor.id)
  return joinedPage(handle, token)
}

export async function handleApply(deps: SiteDeps, request: Request): Promise<Response> {
  const form = await request.formData()
  const values: Record<string, string> = {}
  for (const name of ['org_name', 'org_site', 'contact_name', 'email', 'country', 'status_kind', 'github', 'repo_url']) values[name] = field(form, name)
  values.needs = field(form, 'needs', 4000)
  const blocked = await guard(deps, request, form, 'apply', 5)
  if (blocked) return organizationsPage(deps.config, blocked, values)
  const problems: string[] = []
  if (!values.org_name) problems.push('the organization name')
  if (!values.contact_name) problems.push('your name')
  if (!isEmail(values.email!)) problems.push('a valid email')
  if (!['nonprofit', 'public-good', 'other'].includes(values.status_kind!)) problems.push('what kind of organization you are')
  if (!['yes', 'help'].includes(values.github!)) problems.push('whether you are on GitHub')
  if (!values.needs) problems.push('what you need help with')
  if (values.org_site && !isUrl(values.org_site)) problems.push('a website link starting with https://')
  if (values.repo_url && !isUrl(values.repo_url)) problems.push('a repository link starting with https://')
  if (field(form, 'agree') !== 'yes') problems.push('your agreement to the terms')
  if (problems.length) return organizationsPage(deps.config, `Please add ${problems.join(', ')}.`, values)
  await deps.store.insertApplication({
    id: randomUUID(),
    createdAt: deps.now?.() ?? Date.now(),
    orgName: values.org_name!,
    website: values.org_site || null,
    contactName: values.contact_name!,
    email: values.email!,
    country: values.country || null,
    statusKind: values.status_kind!,
    github: values.github!,
    repoUrl: values.repo_url || null,
    needs: values.needs!,
  })
  return thanksPage('Thanks, we have your application.', `We'll reply to ${values.email} within a week.`)
}

export async function handleWaitlist(deps: SiteDeps, request: Request): Promise<Response> {
  const form = await request.formData()
  const blocked = await guard(deps, request, form, 'waitlist', 10)
  if (blocked) return volunteerPage(deps.config, blocked)
  const email = field(form, 'email').toLowerCase()
  const kind = field(form, 'kind') === 'money' ? 'money' : 'chat'
  if (!isEmail(email)) return volunteerPage(deps.config, 'Please enter a valid email for the list.')
  await deps.store.addToWaitlist(email, kind, deps.now?.() ?? Date.now())
  return thanksPage("You're on the list.", `We'll write once when ${kind === 'money' ? 'giving money' : 'volunteering from a chat app'} opens. Nothing else.`)
}
