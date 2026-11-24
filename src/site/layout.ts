// Shared page shell for the public website: header, footer, security headers.
// Pages are plain server-rendered HTML; the only script is /site.js (copy
// buttons) and Cloudflare Turnstile on the forms.

export const SITE = {
  name: 'Volunteer Pool',
  origin: 'https://volunteer.apishelf.dev',
  description:
    'Nonprofits post small, clearly described tasks on GitHub. Volunteers connect the AI tool they already have and finish one task at a time. Every finished task is public.',
}

export type PageMeta = {
  title: string
  description: string
  path: string
  section?: 'volunteer' | 'organizations' | 'how' | 'projects' | 'about' | null
  noindex?: boolean
  turnstile?: boolean
}

export const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const NAV: { href: string; label: string; key: NonNullable<PageMeta['section']> }[] = [
  { href: '/volunteer', label: 'Volunteer', key: 'volunteer' },
  { href: '/organizations', label: 'For organizations', key: 'organizations' },
  { href: '/how-it-works', label: 'How it works', key: 'how' },
  { href: '/projects', label: 'Projects', key: 'projects' },
  { href: '/about', label: 'About', key: 'about' },
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
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE.origin}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/atkinson-next-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site.css">
<script src="/site.js" defer></script>
${meta.turnstile ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="logo" href="/" aria-label="${SITE.name}, home"><span class="logo-mark" aria-hidden="true"></span>${SITE.name}</a>
    <nav class="nav-desktop" aria-label="Main"><ul>${nav}</ul></nav>
    <a class="button button-small header-cta" href="/volunteer#start">Start volunteering</a>
    <details class="nav-mobile">
      <summary aria-label="Menu"><span aria-hidden="true">Menu</span></summary>
      <div class="menu">
        <a class="button" href="/volunteer#start">Start volunteering</a>
        <ul>${nav}</ul>
      </div>
    </details>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <h2>Volunteer</h2>
      <ul>
        <li><a href="/volunteer">Start volunteering</a></li>
        <li><a href="/volunteer#tools">Connect your AI tool</a></li>
        <li><a href="/volunteer#coming">Chat apps and donations</a></li>
        <li><a href="/volunteers">Volunteers</a></li>
      </ul>
    </div>
    <div>
      <h2>Organizations</h2>
      <ul>
        <li><a href="/organizations">How it works for you</a></li>
        <li><a href="/organizations#apply">Apply</a></li>
        <li><a href="/organizations#github">Getting onto GitHub</a></li>
        <li><a href="/projects">Supported projects</a></li>
      </ul>
    </div>
    <div>
      <h2>About</h2>
      <ul>
        <li><a href="/how-it-works">How it works</a></li>
        <li><a href="/about">Who runs this</a></li>
        <li><a href="/faq">Questions</a></li>
      </ul>
    </div>
    <div>
      <h2>Legal</h2>
      <ul>
        <li><a href="/privacy">Privacy</a></li>
        <li><a href="/terms">Terms and volunteer rules</a></li>
        <li><a href="/accessibility">Accessibility</a></li>
      </ul>
    </div>
  </div>
  <div class="wrap footer-note">
    <p>${SITE.name} is a free, open project in its test phase. Claude, Gemini, Codex, ChatGPT and GitHub are trademarks of their owners, who are not affiliated with this project.</p>
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
