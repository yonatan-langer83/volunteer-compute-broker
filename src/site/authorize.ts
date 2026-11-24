// The sign-in page an AI app opens when a volunteer adds the pool as a
// connector. The volunteer picks a nickname (or uses their existing key),
// says how many tasks a month at most, and allows the app to work for them.

import { createHash } from 'node:crypto'

import { AuthorizationError, CimdFetchError, type ConsentDescription, type OAuthHelpers } from '@cloudflare/workers-oauth-provider'

import type { SqliteStore } from '../sqlite-store.js'
import { esc, page, SITE } from './layout.js'

export type CreateVolunteer = (nickname: string, monthly: number) => Promise<{ ok: true; donorId: string; token: string } | { ok: false; error: string }>

export type AuthorizeDeps = {
  oauth: OAuthHelpers
  store: SqliteStore
  turnstileSiteKey: string | null
  verifyTurnstile: (form: FormData, request: Request) => Promise<boolean>
  createVolunteer: CreateVolunteer
  now?: () => number
}

const SCOPE = ['volunteer']

const authorizeHeaders = (turnstile: boolean): Record<string, string> => ({
  // The approval redirects to the AI app's own address, so form-action must allow https.
  'content-security-policy': [
    "default-src 'self'",
    `script-src 'self'${turnstile ? ' https://challenges.cloudflare.com' : ''}`,
    `frame-src ${turnstile ? 'https://challenges.cloudflare.com' : "'none'"}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "form-action 'self' https:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; '),
  'cache-control': 'no-store',
})

function withHeaders(response: Response, headers: Headers | Record<string, string>): Response {
  const merged = new Headers(response.headers)
  new Headers(headers).forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') merged.append(key, value)
    else merged.set(key, value)
  })
  return new Response(response.body, { status: response.status, headers: merged })
}

function form(details: ConsentDescription, handle: string, deps: AuthorizeDeps, error?: string, values: Record<string, string> = {}): Response {
  const app = esc(details.clientName)
  const who = details.clientDomain
    ? `It's published by <strong>${esc(details.clientDomain)}</strong>.`
    : "The app named itself, so we can't confirm the name."
  const mode = values.mode === 'existing' ? 'existing' : 'new'
  const ts = deps.turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${esc(deps.turnstileSiteKey)}"></div>` : ''
  const response = page(
    {
      title: `Connect ${details.clientName} | ${SITE.name}`,
      description: 'Let your AI app volunteer for nonprofits.',
      path: '/authorize',
      noindex: true,
      turnstile: !!deps.turnstileSiteKey,
    },
    `<div class="wrap page-head narrow">
  <h1>Let ${app} volunteer for nonprofits</h1>
  <p class="lead">${app} is asking to work on volunteer tasks in your name. ${who} After you allow it, it can ask for tasks, read the project's files, make changes and hand in work. It can't see anything else about you.</p>
  <p class="help">Access goes to <strong>${esc(details.redirectHost)}</strong>.${details.redirectIsLoopback ? ' That is an app on your own computer: continue only if you just started connecting from it.' : ''}</p>
</div>
<section class="wrap section narrow">
  ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
  <form method="post" action="/authorize" class="form">
    <input type="hidden" name="handle" value="${esc(handle)}">
    <input type="hidden" name="client_name" value="${esc(details.clientName)}">
    <input type="hidden" name="client_domain" value="${esc(details.clientDomain ?? '')}">
    <input type="hidden" name="redirect_host" value="${esc(details.redirectHost)}">
    <input type="hidden" name="loopback" value="${details.redirectIsLoopback ? '1' : ''}">
    <fieldset>
      <legend>Are you new here?</legend>
      <label class="check"><input type="radio" name="mode" value="new"${mode === 'new' ? ' checked' : ''}> <span>Yes, I'm a new volunteer</span></label>
      <label class="check"><input type="radio" name="mode" value="existing"${mode === 'existing' ? ' checked' : ''}> <span>No, I already have a connection key</span></label>
    </fieldset>

    <label for="nickname">Nickname <span class="optional">(new volunteers)</span></label>
    <input id="nickname" name="nickname" maxlength="32" pattern="[A-Za-z][A-Za-z0-9-]{1,31}" autocomplete="nickname" value="${esc(values.nickname)}" aria-describedby="nick-help">
    <p class="help" id="nick-help">Shown publicly next to the tasks you finish. 2 to 32 letters, numbers or dashes.</p>

    <label for="monthly">Tasks per month, at most <span class="optional">(new volunteers)</span></label>
    <input id="monthly" name="monthly" type="number" min="1" max="50" value="${esc(values.monthly || '10')}">

    <label for="key">Your connection key <span class="optional">(if you already volunteer)</span></label>
    <input id="key" name="key" autocomplete="off" spellcheck="false" placeholder="vbk_...">

    <label class="check"><input type="checkbox" name="agree" value="yes"> <span>I've read the <a href="/terms#volunteers">volunteer rules</a>. My AI works on my own plan, within its terms.</span></label>
    <div class="hp" aria-hidden="true"><label>Leave this empty <input name="website_url" tabindex="-1" autocomplete="off"></label></div>
    ${ts}
    <div class="actions">
      <button class="button" type="submit" name="decision" value="approve">Allow ${app} to volunteer</button>
      <button class="button button-quiet" type="submit" name="decision" value="deny">Cancel</button>
    </div>
  </form>
</section>`,
  )
  return withHeaders(response, authorizeHeaders(!!deps.turnstileSiteKey))
}

function problem(message: string, status = 400): Response {
  return withHeaders(
    page(
      { title: `Connection problem | ${SITE.name}`, description: message, path: '/authorize', noindex: true },
      `<div class="wrap page-head narrow"><h1>That didn't work</h1><p class="lead">${esc(message)}</p><p>Go back to your AI app and add the connector again.</p></div>`,
      status,
    ),
    authorizeHeaders(false),
  )
}

const keyHash = (key: string) => createHash('sha256').update(key).digest('hex')

export async function handleAuthorize(request: Request, deps: AuthorizeDeps): Promise<Response> {
  try {
    if (request.method === 'GET') {
      const authRequest = await deps.oauth.parseAuthRequest(request)
      const details = await deps.oauth.describeConsent(authRequest)
      const consent = await deps.oauth.beginConsent(authRequest)
      return withHeaders(form(details, consent.handle, deps), consent.headers)
    }
    if (request.method !== 'POST') return problem('Unsupported request.', 405)

    const body = await request.formData()
    const handle = String(body.get('handle') ?? '')
    if (body.get('decision') !== 'approve') {
      const denied = await deps.oauth.denyConsent(request, handle)
      return new Response(null, { status: 302, headers: denied.headers })
    }
    const values = {
      mode: String(body.get('mode') ?? 'new'),
      nickname: String(body.get('nickname') ?? '').trim(),
      monthly: String(body.get('monthly') ?? '10').trim(),
    }
    // Redraw the same page with an error. These fields only describe the app
    // for display; the approval itself uses the request stored server-side.
    const shown = {
      clientId: '',
      clientName: String(body.get('client_name') ?? 'Your AI app').slice(0, 120),
      ...(String(body.get('client_domain') ?? '') ? { clientDomain: String(body.get('client_domain')).slice(0, 120) } : {}),
      redirectUri: '',
      redirectHost: String(body.get('redirect_host') ?? '').slice(0, 200),
      redirectIsLoopback: body.get('loopback') === '1',
      scope: SCOPE,
    } as unknown as ConsentDescription
    const again = async (message: string) => form(shown, handle, deps, message, values)
    if (String(body.get('website_url') ?? '')) return problem('Something went wrong.')
    if (!(await deps.verifyTurnstile(body, request))) return again('The anti-spam check failed. Please try again.')
    if (body.get('agree') !== 'yes') return again('Please confirm the volunteer rules.')

    let donorId: string
    let newKey: string | null = null
    if (values.mode === 'existing') {
      const key = String(body.get('key') ?? '').trim()
      const found = key ? await deps.store.findActiveDonorByTokenHash(keyHash(key)) : null
      if (!found) return again("That connection key wasn't recognized. Check it, or choose 'Yes, I'm a new volunteer'.")
      donorId = found
    } else {
      const monthly = Number(values.monthly)
      if (!/^[A-Za-z][A-Za-z0-9-]{1,31}$/.test(values.nickname)) return again('Choose a nickname of 2 to 32 letters, numbers or dashes, starting with a letter.')
      if (!Number.isInteger(monthly) || monthly < 1 || monthly > 50) return again('Choose between 1 and 50 tasks per month.')
      if (await deps.store.handleTaken(values.nickname.toLowerCase())) return again(`The nickname ${values.nickname.toLowerCase()} is taken. Please choose another.`)
      donorId = ''
    }

    // Approve first, so a failed approval never leaves an unused volunteer behind.
    const approved = await deps.oauth.approveConsent(request, handle, { scope: SCOPE })
    if (values.mode !== 'existing') {
      const created = await deps.createVolunteer(values.nickname.toLowerCase(), Number(values.monthly))
      if (!created.ok) return problem(`${created.error} Please start connecting again from your AI app.`)
      donorId = created.donorId
      newKey = created.token
    }
    const { redirectTo } = await deps.oauth.completeAuthorization({
      request: approved.request,
      userId: donorId,
      metadata: {},
      scope: approved.request.scope,
      props: { donorId },
    })
    if (!newKey) {
      approved.headers.set('Location', redirectTo)
      return new Response(null, { status: 302, headers: approved.headers })
    }
    // New volunteers see their backup key once, for connecting more apps later.
    const welcome = page(
      { title: `Welcome to ${SITE.name}`, description: 'Your volunteer account is ready.', path: '/authorize', noindex: true },
      `<div class="wrap page-head narrow">
  <h1>Welcome, ${esc(values.nickname.toLowerCase())}. You're connected.</h1>
  <p class="lead">One more thing: this is your connection key. You only need it to connect another AI app or a coding tool later, and it's shown only now. Keep it like a password.</p>
  <div class="keybox"><code>${esc(newKey)}</code><button class="copy" type="button" data-copy="${esc(newKey)}">Copy key</button></div>
  <p class="actions"><a class="button" href="${esc(redirectTo)}">Back to your AI app</a></p>
  <p>Then tell it: <q>I'm ready for 1 small volunteer task.</q></p>
</div>`,
    )
    return withHeaders(withHeaders(welcome, authorizeHeaders(false)), approved.headers)
  } catch (error) {
    if (error instanceof AuthorizationError && (error as { redirectTo?: string }).redirectTo) {
      return Response.redirect((error as { redirectTo: string }).redirectTo, 302)
    }
    if (error instanceof AuthorizationError) return problem((error as { description?: string }).description ?? 'This sign-in link is not valid.')
    if (error instanceof CimdFetchError) return problem("This app couldn't be verified.")
    throw error
  }
}
