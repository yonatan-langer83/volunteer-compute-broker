// Shared page shell for the public website: header, footer, security headers.
// Pages are plain server-rendered HTML; the only script is /site.js (copy
// buttons) and Cloudflare Turnstile on the forms.

export const SITE = {
  name: 'Volunteer Pool',
  origin: 'https://volunteer.apishelf.dev',
  description:
    'A volunteer bank for digital work. Volunteers give their AI\'s help or their own skills, nonprofits get small, reviewed tasks done, and every finished task is public.',
}

export type PageMeta = {
  title: string
  description: string
  path: string
  section?: 'volunteer' | 'organizations' | 'projects' | 'handbook' | 'faq' | null
  noindex?: boolean
  turnstile?: boolean
}

export const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const NAV: { href: string; label: string; key: NonNullable<PageMeta['section']> }[] = [
  { href: '/volunteer', label: 'Volunteer', key: 'volunteer' },
  { href: '/organizations', label: 'Organizations', key: 'organizations' },
  { href: '/projects', label: 'Projects', key: 'projects' },
  { href: '/handbook', label: 'Handbook', key: 'handbook' },
  { href: '/faq', label: 'Questions', key: 'faq' },
]

export function securityHeaders(turnstile = false): Record<string, string> {
  const ts = turnstile ? ' https://challenges.cloudflare.com' : ''
  return {
    'content-security-policy': [
      "default-src 'self'",
      `script-src 'self'${ts}`,
      `frame-src${turnstile ? ts : " 'none'"}`,
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; '),
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  }
}

export function page(meta: PageMeta, body: string, status = 200, extraHeaders: Record<string, string> = {}): Response {
  const url = `${SITE.origin}${meta.path === '/' ? '/' : meta.path}`
  const nav = NAV.map(
    (item) => `<li><a href="${item.href}"${meta.section === item.key ? ' aria-current="page"' : ''}>${item.label}</a></li>`,
  ).join('')
  const html = `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
<link rel="canonical" href="${esc(url)}">
${meta.noindex ? '<meta name="robots" content="noindex">' : ''}
<meta name="theme-color" content="#14213d">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE.origin}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/atkinson-next-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site.css">
<script src="/site.js" defer></script>
${meta.turnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="logo" href="/"><img src="/favicon.svg" alt="" width="32" height="32">${SITE.name}</a>
    <nav class="nav-desktop" aria-label="Main"><ul>${nav}</ul></nav>
    <div class="header-actions">
      <a class="signin" href="/account">Sign in</a>
      <a class="button button-small" href="/volunteer#start">Start volunteering</a>
    </div>
    <details class="nav-mobile">
      <summary>Menu</summary>
      <nav class="menu" aria-label="Main">
        <a class="button" href="/volunteer#start">Start volunteering</a>
        <ul>${nav}<li><a href="/account">Sign in / your account</a></li></ul>
      </nav>
    </details>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div class="footer-about">
      <a class="logo" href="/"><img src="/favicon.svg" alt="" width="32" height="32">${SITE.name}</a>
      <p>A volunteer bank for digital work. Volunteers give their AI's help or their own skills; nonprofits get small, reviewed pieces of work done.</p>
    </div>
    <div>
      <h2>Volunteers</h2>
      <ul>
        <li><a href="/volunteer">Start volunteering</a></li>
        <li><a href="/volunteer#apps">Connect your AI app</a></li>
        <li><a href="/handbook/volunteers">Volunteer handbook</a></li>
        <li><a href="/volunteers">Volunteers</a></li>
        <li><a href="/account">Your account</a></li>
      </ul>
    </div>
    <div>
      <h2>Organizations</h2>
      <ul>
        <li><a href="/organizations">How it works for you</a></li>
        <li><a href="/organizations#apply">Apply</a></li>
        <li><a href="/handbook/what-is-github">What is GitHub?</a></li>
        <li><a href="/handbook/work-packages">Writing work packages</a></li>
        <li><a href="/projects">Supported projects</a></li>
      </ul>
    </div>
    <div>
      <h2>Handbook</h2>
      <ul>
        <li><a href="/handbook">Overview</a></li>
        <li><a href="/handbook/safety-and-quality">Safety and quality</a></li>
        <li><a href="/handbook/what-happens-when">What happens when…</a></li>
        <li><a href="/handbook/github-best-practice">GitHub best practice</a></li>
        <li><a href="/handbook/secure-your-repository">Secure your repository</a></li>
        <li><a href="/handbook/templates">Templates</a></li>
      </ul>
    </div>
    <div>
      <h2>About</h2>
      <ul>
        <li><a href="/how-it-works">How the bank works</a></li>
        <li><a href="/about">Who runs this</a></li>
        <li><a href="/faq">Questions</a></li>
        <li><a href="/privacy">Privacy</a></li>
        <li><a href="/terms">Terms and rules</a></li>
        <li><a href="/accessibility">Accessibility</a></li>
      </ul>
    </div>
  </div>
  <div class="wrap footer-note">
    <p>${SITE.name} is free and in its test phase. Claude, ChatGPT, Gemini, Grok, Le Chat, Codex, Cursor and GitHub are trademarks of their owners, who are not affiliated with this project.</p>
  </div>
</footer>
</body>
</html>`
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': meta.noindex ? 'no-store' : 'public, max-age=60',
      ...securityHeaders(meta.turnstile),
      ...extraHeaders,
    },
  })
}

export function statusLabel(state: string): { text: string; cls: string } {
  switch (state) {
    case 'done':
      return { text: 'Done', cls: 'done' }
    case 'open':
      return { text: 'Open', cls: 'open' }
    case 'blocked':
      return { text: 'Waiting on another task', cls: 'waiting' }
    case 'claimed':
    case 'running':
      return { text: 'Being worked on', cls: 'busy' }
    case 'review':
      return { text: 'In review', cls: 'busy' }
    case 'too-big':
      return { text: 'Needs splitting', cls: 'waiting' }
    default:
      return { text: state.charAt(0).toUpperCase() + state.slice(1), cls: 'waiting' }
  }
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
