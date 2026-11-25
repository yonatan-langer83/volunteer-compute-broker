import { describe, expect, it } from 'vitest'

import { handleApply, handleSiteGet, handleWaitlist, type SiteDeps } from '../src/site/router.js'
import { setupBroker, writeManifest } from './helpers.js'

const manifest = `schemaVersion: 1
project:
  name: harbor-pantry
  nonprofit: true
  github: https://github.com/example/harbor-pantry
tasks:
  - id: fix-hours
    title: Count overnight shifts forward
    instructions: Fix the hours.
    acceptance: Four hours.
    estimatedCostUsd: 0.05
`

async function setup(turnstile?: { secret: string; ok: boolean }) {
  const { broker, store } = setupBroker()
  await broker.registerProject({ manifestPath: writeManifest(manifest) })
  const deps: SiteDeps = {
    store,
    config: { turnstileSiteKey: turnstile ? 'site-key' : null, contactEmail: null },
    turnstileSecret: turnstile?.secret ?? null,
    fetcher: async () => new Response(JSON.stringify({ success: turnstile?.ok ?? true })),
  }
  return { broker, store, deps }
}

const post = (path: string, fields: Record<string, string>, ip = '203.0.113.7') =>
  new Request(`https://volunteer.example${path}`, {
    method: 'POST',
    body: new URLSearchParams(fields),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip },
  })

const get = async (deps: SiteDeps, path: string) => {
  const response = await handleSiteGet(deps, new URL(`https://volunteer.example${path}`))
  return { status: response?.status ?? 404, html: response ? await response.text() : '', response }
}

describe('public website', () => {
  it('serves every page with a unique title, a canonical link and security headers', async () => {
    const { deps } = await setup()
    const titles = new Set<string>()
    for (const path of ['/', '/volunteer', '/organizations', '/how-it-works', '/projects', '/projects/harbor-pantry', '/volunteers', '/about', '/faq', '/privacy', '/terms', '/accessibility']) {
      const { status, html, response } = await get(deps, path)
      expect(status, path).toBe(200)
      const title = html.match(/<title>([^<]+)<\/title>/)?.[1]
      expect(title, path).toBeTruthy()
      titles.add(title!)
      expect(html).toContain(`<link rel="canonical" href="https://volunteer.apishelf.dev${path === '/' ? '/' : path}">`)
      expect(html.match(/<h1[ >]/g)?.length, path).toBe(1)
      expect(response!.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    }
    expect(titles.size).toBe(12)
  })

  it('lists the live tasks on the home page and the project page', async () => {
    const { deps } = await setup()
    expect((await get(deps, '/')).html).toContain('Count overnight shifts forward')
    expect((await get(deps, '/projects/harbor-pantry')).html).toContain('Open')
  })

  it('returns real 404s and redirects trailing slashes', async () => {
    const { deps } = await setup()
    expect(await handleSiteGet(deps, new URL('https://volunteer.example/nope'))).toBeNull()
    expect((await get(deps, '/projects/nope')).status).toBe(404)
    expect((await get(deps, '/volunteers/nobody')).status).toBe(404)
    expect((await get(deps, '/faq/')).response!.status).toBe(301)
  })

  it('publishes robots.txt, a sitemap and llms.txt', async () => {
    const { deps } = await setup()
    expect((await get(deps, '/robots.txt')).html).toContain('Sitemap: https://volunteer.apishelf.dev/sitemap.xml')
    const sitemap = (await get(deps, '/sitemap.xml')).html
    expect(sitemap).toContain('<loc>https://volunteer.apishelf.dev/projects/harbor-pantry</loc>')
    expect(sitemap).not.toContain('/volunteer/join')
    expect((await get(deps, '/llms.txt')).html).toContain('/mcp')
  })
})

describe('directory and handbook', () => {
  it('searches projects and filters by cause', async () => {
    const { deps } = await setup()
    expect((await get(deps, '/projects?q=overnight')).html).toContain('harbor-pantry')
    expect((await get(deps, '/projects?q=zebra')).html).toContain('No projects match')
    expect((await get(deps, '/projects?cause=health')).html).toContain('No projects match')
  })

  it('serves every handbook page, the templates, and redirects old guide addresses', async () => {
    const { deps } = await setup()
    for (const path of ['/handbook', '/handbook/volunteers', '/handbook/organizations', '/handbook/work-packages', '/handbook/what-is-github', '/handbook/task-menu',
      '/handbook/secure-your-repository', '/handbook/safety-and-quality', '/handbook/what-happens-when', '/handbook/github-best-practice', '/handbook/open-source', '/handbook/templates']) {
      const { status, html } = await get(deps, path)
      expect(status, path).toBe(200)
      expect(html.match(/<h1[ >]/g)?.length, path).toBe(1)
    }
    expect((await get(deps, '/handbook/templates')).html).toContain('volunteer-compute.yaml')
    expect((await get(deps, '/handbook/nope')).status).toBe(404)
    expect((await get(deps, '/guides/what-is-github')).response!.status).toBe(301)
  })

  it('keeps the generated handbook in step with docs/handbook', async () => {
    const { readFileSync } = await import('node:fs')
    // @ts-expect-error plain JavaScript build script
    const { buildHandbook } = await import('../scripts/build-handbook.mjs')
    expect(readFileSync('src/site/handbook-content.ts', 'utf8')).toBe(buildHandbook())
  })
})

describe('organization applications and the waiting list', () => {
  it('stores a complete application and lists what is missing otherwise', async () => {
    const { deps, store } = await setup()
    const missing = await (await handleApply(deps, post('/organizations/apply', { org_name: 'Food Bank', email: 'bad' }))).text()
    expect(missing).toContain('Please add your name, a valid email')
    expect(missing).toContain('value="Food Bank"')
    const ok = await (await handleApply(deps, post('/organizations/apply', {
      org_name: 'Food Bank', contact_name: 'Dana', email: 'dana@example.org', status_kind: 'nonprofit', github: 'help',
      needs: 'Our sign-up page breaks on phones.', agree: 'yes',
    }))).text()
    expect(ok).toContain('we have your application')
    const rows = await store.listApplications() as { org_name: string; github: string }[]
    expect(rows.map((r) => [r.org_name, r.github])).toEqual([['Food Bank', 'help']])
  })

  it('adds an email to the waiting list once', async () => {
    const { deps } = await setup()
    for (let i = 0; i < 2; i++) {
      const html = await (await handleWaitlist(deps, post('/waitlist', { email: 'Sam@Example.org', kind: 'money' }))).text()
      expect(html).toContain('on the list')
    }
    expect(await (await handleWaitlist(deps, post('/waitlist', { email: 'nope', kind: 'money' }))).text()).toContain('valid email')
    const strict = (await setup({ secret: 's', ok: false })).deps
    expect(await (await handleWaitlist({ ...strict }, post('/waitlist', { email: 'a@b.org', kind: 'money', 'cf-turnstile-response': 't' }))).text()).toContain('anti-spam check failed')
  })
})
