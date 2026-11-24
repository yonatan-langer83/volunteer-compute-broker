// The page an AI app opens when a volunteer adds the pool as a connector.
// The volunteer signs in to their account (GitHub or an emailed link), picks a
// public name the first time, and allows the app to work for them. No key is
// shown: coding tools get their own keys from the account page.

import { AuthorizationError, CimdFetchError, type ConsentDescription, type OAuthHelpers } from '@cloudflare/workers-oauth-provider'

import type { SqliteStore } from '../sqlite-store.js'
import { currentAccount, type CreateLinkedVolunteer } from './account.js'
import { esc, page, SITE } from './layout.js'

// What volunteers say to their AI app. Naming the pool makes the app pick this connector.
export const START_PHRASE = `Use ${SITE.name} to give me 1 small volunteer task.`

export type AuthorizeDeps = {
  oauth: OAuthHelpers
  store: SqliteStore
  createVolunteer: CreateLinkedVolunteer
  now?: () => number
}

const SCOPE = ['volunteer']

const authorizeHeaders: Record<string, string> = {
  // The approval redirects to the AI app's own address, so form-action must allow https.
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "frame-src 'none'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "form-action 'self' https:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; '),
  'cache-control': 'no-store',
}

function withHeaders(response: Response, headers: Headers | Record<string, string>): Response {
  const merged = new Headers(response.headers)
  new Headers(headers).forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') merged.append(key, value)
    else merged.set(key, value)
  })
  return new Response(response.body, { status: response.status, headers: merged })
}

function consentPage(details: ConsentDescription, handle: string, volunteer: string | null, error?: string, values: Record<string, string> = {}): Response {
  const app = esc(details.clientName)
  const who = details.clientDomain
    ? `It's published by <strong>${esc(details.clientDomain)}</strong>.`
    : "The app named itself, so we can't confirm the name."
  const newVolunteer = volunteer
    ? `<p>You volunteer as <strong>${esc(volunteer)}</strong>.</p>`
    : `<label for="nickname">Public name</label>
    <input id="nickname" name="nickname" maxlength="32" pattern="[A-Za-z][A-Za-z0-9-]{1,31}" required value="${esc(values.nickname)}" aria-describedby="nick-help">
    <p class="help" id="nick-help">Shown next to the tasks you finish. 2 to 32 letters, numbers or dashes. Not your email.</p>
    <label for="monthly">Tasks per month, at most</label>
    <input id="monthly" name="monthly" type="number" min="1" max="50" value="${esc(values.monthly || '5')}">
    <p class="help">You can change this or pause any time, from your AI or your account page.</p>
    <label class="check"><input type="checkbox" name="agree" value="yes"> <span>I've read the <a href="/terms#volunteers">volunteer rules</a>. My AI works on my own plan, within its terms.</span></label>`
  const response = page(
    { title: `Connect ${details.clientName} | ${SITE.name}`, description: 'Let your AI app volunteer for nonprofits.', path: '/authorize', noindex: true },
    `<div class="wrap page-head narrow">
  <h1>Let ${app} volunteer for nonprofits</h1>
  <p class="lead">${app} will ask for tasks, read the project's files, make changes and hand in work in your name. It can't see anything else about you. ${who}</p>
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
    ${newVolunteer}
    <div class="actions">
      <button class="button" type="submit" name="decision" value="approve">Allow ${app} to volunteer</button>
      <button class="button button-quiet" type="submit" name="decision" value="deny">Cancel</button>
    </div>
  </form>
</section>`,
  )
  return withHeaders(response, authorizeHeaders)
}

function problem(message: string, status = 400): Response {
  return withHeaders(
    page(
      { title: `Connection problem | ${SITE.name}`, description: message, path: '/authorize', noindex: true },
      `<div class="wrap page-head narrow"><h1>That didn't work</h1><p class="lead">${esc(message)}</p><p>Go back to your AI app and add the connector again.</p></div>`,
      status,
    ),
    authorizeHeaders,
  )
}

export function connectedPage(appName: string, redirectTo: string): Response {
  const app = esc(appName)
  return withHeaders(page(
    { title: `Connected | ${SITE.name}`, description: 'Your AI app can now volunteer.', path: '/authorize', noindex: true },
    `<div class="wrap page-head narrow">
  <h1>${app} is connected</h1>
  <p class="lead">Go back to ${app} and start a volunteer shift. Name ${SITE.name} so it uses this connection:</p>
  <div class="say"><q>${START_PHRASE}</q><button class="copy" type="button" data-copy="${START_PHRASE}">Copy</button></div>
  <p class="help">In Claude you can also choose <strong>Start a volunteer shift</strong> from the + menu, under the connector.</p>
  <p class="actions"><a class="button" href="${esc(redirectTo)}">Back to ${app}</a> <a class="button button-quiet" href="/account">Your account</a></p>
</div>`,
  ), authorizeHeaders)
}

export async function handleAuthorize(request: Request, deps: AuthorizeDeps): Promise<Response> {
  const now = deps.now?.() ?? Date.now()
  try {
    if (request.method === 'GET') {
      const authRequest = await deps.oauth.parseAuthRequest(request)
      const details = await deps.oauth.describeConsent(authRequest)
      const account = await currentAccount(deps.store, request, now)
      if (!account) {
        const url = new URL(request.url)
        return Response.redirect(`${url.origin}/signin?return=${encodeURIComponent(url.pathname + url.search)}&for=${encodeURIComponent(details.clientName)}`, 303)
      }
      const donorId = await deps.store.donorForAccount(account.id)
      const donor = donorId ? await deps.store.getDonor(donorId) : null
      const consent = await deps.oauth.beginConsent(authRequest)
      return withHeaders(consentPage(details, consent.handle, donor?.handle ?? null), consent.headers)
    }
    if (request.method !== 'POST') return problem('Unsupported request.', 405)
    if (request.headers.get('origin') !== new URL(request.url).origin) return problem('Please use the button on the connect page.')

    const body = await request.formData()
    const handle = String(body.get('handle') ?? '')
    if (body.get('decision') !== 'approve') {
      const denied = await deps.oauth.denyConsent(request, handle)
      return new Response(null, { status: 302, headers: denied.headers })
    }
    const account = await currentAccount(deps.store, request, now)
    if (!account) return problem('Your sign-in expired.')
    const values = { nickname: String(body.get('nickname') ?? '').trim(), monthly: String(body.get('monthly') ?? '5').trim() }
    // Redraw with an error. These fields only describe the app for display;
    // the approval itself uses the request stored server-side.
    const shown = {
      clientId: '',
      clientName: String(body.get('client_name') ?? 'Your AI app').slice(0, 120),
      ...(String(body.get('client_domain') ?? '') ? { clientDomain: String(body.get('client_domain')).slice(0, 120) } : {}),
      redirectUri: '',
      redirectHost: String(body.get('redirect_host') ?? '').slice(0, 200),
      redirectIsLoopback: body.get('loopback') === '1',
      scope: SCOPE,
    } as unknown as ConsentDescription
    let donorId = await deps.store.donorForAccount(account.id)
    const again = (message: string) => consentPage(shown, handle, null, message, values)
    if (!donorId) {
      const nickname = values.nickname.toLowerCase()
      const monthly = Number(values.monthly)
      if (!/^[a-z][a-z0-9-]{1,31}$/.test(nickname)) return again('Choose a name of 2 to 32 letters, numbers or dashes, starting with a letter.')
      if (!Number.isInteger(monthly) || monthly < 1 || monthly > 50) return again('Choose between 1 and 50 tasks per month.')
      if (body.get('agree') !== 'yes') return again('Please confirm the volunteer rules.')
      if (await deps.store.handleTaken(nickname)) return again(`The name ${nickname} is taken. Please choose another.`)
    }

    // Approve first, so a failed approval never leaves an unused volunteer behind.
    const approved = await deps.oauth.approveConsent(request, handle, { scope: SCOPE })
    if (!donorId) {
      const created = await deps.createVolunteer({ nickname: values.nickname.toLowerCase(), monthly: Number(values.monthly), accountId: account.id })
      if (!created.ok) return problem(`${created.error} Please start connecting again from your AI app.`)
      donorId = created.donorId
    }
    const { redirectTo } = await deps.oauth.completeAuthorization({
      request: approved.request,
      userId: donorId,
      metadata: {},
      scope: approved.request.scope,
      props: { donorId },
    })
    return withHeaders(connectedPage(shown.clientName, redirectTo), approved.headers)
  } catch (error) {
    if (error instanceof AuthorizationError && (error as { redirectTo?: string }).redirectTo) {
      return Response.redirect((error as { redirectTo: string }).redirectTo, 302)
    }
    if (error instanceof AuthorizationError) return problem((error as { description?: string }).description ?? 'This sign-in link is not valid.')
    if (error instanceof CimdFetchError) return problem("This app couldn't be verified.")
    throw error
  }
}
