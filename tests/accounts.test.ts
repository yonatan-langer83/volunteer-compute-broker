import { describe, expect, it } from 'vitest'

import { encryptSecret, loadMasterKey } from '../src/crypto.js'
import { openSqliteStore } from '../src/open-sqlite.js'
import {
  accountAction, accountPage, currentAccount, emailStart, emailVerify, emailVerifyPage, githubCallback, githubStart, safeReturn, type AccountDeps,
} from '../src/site/account.js'
import { setupBroker, tempDbPath, testMasterKeyB64 } from './helpers.js'

const ORIGIN = 'https://volunteer.apishelf.dev'
const masterKey = loadMasterKey(testMasterKeyB64())

async function setup(options: { github?: boolean } = {}) {
  const store = openSqliteStore(tempDbPath(), { maxAttempts: 3 })
  const { broker } = setupBroker({ store })
  const sent: { to: string; text: string }[] = []
  const github: { calls: string[] } = { calls: [] }
  if (options.github) {
    await store.saveSigninApp({ clientId: 'Iv1.test', clientSecretSealed: JSON.stringify(encryptSecret('shh', masterKey)), slug: 'vp-signin' }, 1)
  }
  const deps: AccountDeps = {
    store,
    masterKey,
    oauth: null,
    sendEmail: async (m) => { sent.push({ to: m.to, text: m.text }) },
    turnstileSiteKey: null,
    verifyTurnstile: async () => true,
    createVolunteer: async ({ nickname, monthly, accountId }) => {
      const donor = await broker.registerMcpDonor({ name: nickname, monthlyTasks: monthly, acceptTerms: true })
      await store.linkDonorToAccount(donor.id, accountId)
      return { ok: true, donorId: donor.id }
    },
    githubApp: async () => null,
    fetcher: async (input) => {
      github.calls.push(input)
      if (input.startsWith('https://github.com/login/oauth/access_token')) return Response.json({ access_token: 'gho_test' })
      if (input === 'https://api.github.com/user') return Response.json({ id: 42, login: 'harbor-admin' })
      if (input === 'https://api.github.com/user/emails') return Response.json([{ email: 'Admin@Harbor.org', primary: true, verified: true }])
      return new Response('no', { status: 404 })
    },
  }
  return { store, broker, deps, sent, github }
}

const cookieOf = (response: Response, name: string) =>
  response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))!.split(';')[0]!

function post(path: string, fields: Record<string, string>, cookie?: string, origin = ORIGIN) {
  const body = new URLSearchParams(fields)
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST', body,
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
  })
}

describe('sign-in', () => {
  it('only returns to paths on this site', () => {
    expect(safeReturn('/authorize?client_id=x')).toBe('/authorize?client_id=x')
    expect(safeReturn('//evil.example/x')).toBe('/account')
    expect(safeReturn('https://evil.example')).toBe('/account')
    expect(safeReturn('/\\evil')).toBe('/account')
  })

  it('signs in with GitHub, checks the state, and returns to where the person was', async () => {
    const ctx = await setup({ github: true })
    const start = await githubStart(ctx.deps, new URL(`${ORIGIN}/auth/github?return=${encodeURIComponent('/authorize?x=1')}`))
    const location = new URL(start.headers.get('location')!)
    expect(location.origin).toBe('https://github.com')
    const state = location.searchParams.get('state')!
    const stateCookie = cookieOf(start, '__Host-vp_state')

    const forged = await githubCallback(ctx.deps, new Request(`${ORIGIN}/auth/github/callback?code=c&state=other`, { headers: { cookie: stateCookie } }), new URL(`${ORIGIN}/auth/github/callback?code=c&state=other`))
    expect(await forged.text()).toContain('expired')

    const url = new URL(`${ORIGIN}/auth/github/callback?code=c&state=${state}`)
    const done = await githubCallback(ctx.deps, new Request(url, { headers: { cookie: stateCookie } }), url)
    expect(done.status).toBe(303)
    expect(done.headers.get('location')).toBe('/authorize?x=1')
    const session = cookieOf(done, '__Host-vp_session')
    expect(done.headers.getSetCookie().join(';')).toContain('HttpOnly')
    const account = await currentAccount(ctx.store, new Request(ORIGIN, { headers: { cookie: session } }), Date.now())
    expect(account).toMatchObject({ github_login: 'harbor-admin', email: 'admin@harbor.org' })
  })

  it('emails a single-use link and never says whether an address has an account', async () => {
    const ctx = await setup()
    const first = await emailStart(ctx.deps, post('/auth/email', { email: 'new@example.org', return: '/account' }))
    expect(await first.text()).toContain('If <strong>new@example.org</strong> can receive email')
    expect(ctx.sent).toHaveLength(1)
    const token = ctx.sent[0]!.text.match(/token=([A-Za-z0-9_-]+)/)![1]!

    const crossSite = await emailStart(ctx.deps, post('/auth/email', { email: 'new@example.org' }, undefined, 'https://evil.example'))
    expect(await crossSite.text()).toContain('Please use the form')
    expect(ctx.sent).toHaveLength(1)

    expect(await (await emailVerifyPage(ctx.deps, new URL(`${ORIGIN}/auth/email/verify?token=${token}`))).text()).toContain('Finish signing in')
    const verified = await emailVerify(ctx.deps, post('/auth/email/verify', { token }))
    expect(verified.status).toBe(303)
    const again = await emailVerify(ctx.deps, post('/auth/email/verify', { token }))
    expect(await again.text()).toContain('expired or was already used')
  })
})

describe('account page', () => {
  async function signedIn() {
    const ctx = await setup({ github: true })
    const start = await githubStart(ctx.deps, new URL(`${ORIGIN}/auth/github`))
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!
    const url = new URL(`${ORIGIN}/auth/github/callback?code=c&state=${state}`)
    const done = await githubCallback(ctx.deps, new Request(url, { headers: { cookie: cookieOf(start, '__Host-vp_state') } }), url)
    return { ...ctx, cookie: cookieOf(done, '__Host-vp_session') }
  }

  it('sends signed-out visitors to sign in', async () => {
    const ctx = await setup()
    const response = await accountPage(ctx.deps, new Request(`${ORIGIN}/account`))
    expect(response.headers.get('location')).toBe('/signin?return=%2Faccount')
  })

  it('starts volunteering, changes the limit, makes and switches off per-tool keys', async () => {
    const ctx = await signedIn()
    expect((await accountAction(ctx.deps, post('/account/volunteer', { nickname: 'Harbor-Helper', monthly: '4', agree: 'yes' }, ctx.cookie), 'volunteer')).headers.get('location')).toContain('Welcome')
    let html = await (await accountPage(ctx.deps, new Request(`${ORIGIN}/account`, { headers: { cookie: ctx.cookie } }))).text()
    expect(html).toContain('harbor-helper')
    expect(html).toContain('0 of 4')

    await accountAction(ctx.deps, post('/account/monthly', { monthly: '0' }, ctx.cookie), 'monthly')
    const keyPage = await (await accountAction(ctx.deps, post('/account/keys', { label: 'Claude Code laptop' }, ctx.cookie), 'keys')).text()
    const key = keyPage.match(/vbk_[A-Za-z0-9_-]+/)![0]
    expect(keyPage).toContain('claude mcp add')
    const donorId = (await ctx.store.findActiveDonorByTokenHash((await import('node:crypto')).createHash('sha256').update(key).digest('hex')))!
    expect(donorId).toBeTruthy()

    html = await (await accountPage(ctx.deps, new Request(`${ORIGIN}/account`, { headers: { cookie: ctx.cookie } }))).text()
    expect(html).toContain('Claude Code laptop')
    expect(html).toContain('0 of 0')
    const keyId = (await ctx.store.listTokens(donorId))[0]!.id
    await accountAction(ctx.deps, post('/account/keys/revoke', { key: keyId }, ctx.cookie), 'keys/revoke')
    expect(await ctx.store.listTokens(donorId)).toEqual([])
  })

  it('links an existing volunteer name by its key, once', async () => {
    const ctx = await signedIn()
    const donor = await ctx.broker.registerMcpDonor({ name: 'old-friend', monthlyTasks: 3, acceptTerms: true })
    const { token } = await ctx.broker.mintMcpToken(donor.id)
    const wrong = await accountAction(ctx.deps, post('/account/link', { key: 'vbk_nope' }, ctx.cookie), 'link')
    expect(decodeURIComponent(wrong.headers.get('location')!)).toContain("wasn't recognized")
    await accountAction(ctx.deps, post('/account/link', { key: token }, ctx.cookie), 'link')
    const html = await (await accountPage(ctx.deps, new Request(`${ORIGIN}/account`, { headers: { cookie: ctx.cookie } }))).text()
    expect(html).toContain('old-friend')
  })

  it('ignores posts from other sites', async () => {
    const ctx = await signedIn()
    const response = await accountAction(ctx.deps, post('/account/volunteer', { nickname: 'x-y', monthly: '1', agree: 'yes' }, ctx.cookie, 'https://evil.example'), 'volunteer')
    expect(await response.text()).toContain('Please use the forms')
  })
})
