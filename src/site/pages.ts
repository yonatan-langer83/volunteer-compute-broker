import { CAUSES } from '../manifest.js'
import type { PublicBoard, PublicProject } from '../public-board.js'
import { HANDBOOK, TEMPLATES, type HandbookPage } from './handbook-content.js'
import { esc, page, SITE, slugify, statusLabel } from './layout.js'

export type SiteConfig = { turnstileSiteKey: string | null; contactEmail: string | null }

const MCP_URL = `${SITE.origin}/mcp`
export const START_PHRASE = `Use ${SITE.name} to give me 1 small volunteer task.`

export const CAUSE_LABELS: Record<string, string> = {
  community: 'Community', education: 'Education', environment: 'Environment', food: 'Food', health: 'Health',
  'human-rights': 'Human rights', animals: 'Animals', 'arts-culture': 'Arts and culture', 'open-source': 'Open source', other: 'Other',
}

function contactLine(config: SiteConfig): string {
  return config.contactEmail
    ? `<a href="mailto:${esc(config.contactEmail)}">${esc(config.contactEmail)}</a>`
    : 'the form on <a href="/organizations#apply">For organizations</a> (a direct address follows before public launch)'
}

function turnstile(config: SiteConfig): string {
  return config.turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${esc(config.turnstileSiteKey)}" data-theme="light"></div>` : ''
}

const honeypot = '<div class="hp" aria-hidden="true"><label>Leave this empty <input name="website_url" tabindex="-1" autocomplete="off"></label></div>'

function stats(board: PublicBoard) {
  const tasks = board.projects.flatMap((p) => p.tasks)
  return {
    done: tasks.filter((t) => t.state === 'done').length,
    open: tasks.filter((t) => t.state === 'open').length,
    projects: board.projects.length,
    volunteers: board.donors.length,
  }
}

const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '')

function taskRow(task: PublicProject['tasks'][number], project: PublicProject, withProject: boolean): string {
  const status = statusLabel(task.state)
  const who = task.donorHandle ? ` by <a href="/volunteers/${esc(task.donorHandle)}">${esc(task.donorHandle)}</a>` : ''
  const pr = task.prUrl ? ` <a href="${esc(task.prUrl)}" rel="noopener">See the change</a>` : ''
  return `<li class="task">
  <span class="task-title">${esc(task.title)}</span>
  <span class="pill pill-${status.cls}">${status.text}</span>
  <span class="task-meta">${withProject ? `<a href="/projects/${esc(slugify(project.name))}">${esc(project.name)}</a> · ` : ''}${esc(task.size)} task${who}.${pr}</span>
</li>`
}

function faqHtml(groups: { title?: string; items: [string, string][] }[]): string {
  return groups.map((g) => `${g.title ? `<div class="faq-group"><h2 id="${slugify(g.title)}">${esc(g.title)}</h2>` : '<div>'}
<div class="faq">${g.items.map(([q, a]) => `<details><summary>${esc(q)}</summary><div class="answer"><p>${a}</p></div></details>`).join('')}</div></div>`).join('')
}

function faqJsonLd(items: [string, string][]): string {
  const strip = (s: string) => s.replace(/<[^>]+>/g, '')
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: strip(a) } })),
  }
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`
}

const closingBand = `<section class="wrap section-tight">
  <div class="cta-band">
    <div>
      <h2>Open your volunteer account</h2>
      <p>Sign in, connect the AI app you already use, and give one small task. It takes about five minutes, and you can pause any time.</p>
    </div>
    <div class="actions">
      <a class="button" href="/volunteer#start">Start volunteering</a>
      <a class="button button-quiet" href="/organizations">For organizations</a>
    </div>
  </div>
</section>`

// ---------- home ----------

const HOME_FAQ: [string, string][] = [
  ['Do I need to know how to code?', 'No. Your AI does the work by following the organization\'s brief, and our server checks it. Writing tasks need no technical knowledge at all. Programmers who prefer to work without AI are welcome too.'],
  ['Can I volunteer from my phone?', 'Yes. Add Volunteer Pool as a connector in Claude, ChatGPT (Business, Enterprise or Edu), Gemini, Grok or Le Chat. Your AI works through our server, so nothing runs on your phone.'],
  ['How much of my AI plan does it use?', 'About as much as a normal working session of the same length. A small task is roughly one focused conversation. You set a monthly limit and can pause any time.'],
  ['How do organizations stay in control?', 'Every result arrives as a pull request on GitHub. Their own checks run, the right people review it, and nothing changes until someone merges it.'],
  ['What stops poor or harmful work?', 'A plan before any change, edits limited to the task\'s files, tests, evidence for each requirement, a scan for warning signs, track records, and a person\'s review. <a href="/handbook/safety-and-quality">How we keep quality high</a>.'],
]

export function homePage(board: PublicBoard): Response {
  const s = stats(board)
  const all = board.projects.flatMap((p) => p.tasks.map((t) => ({ t, p })))
  const done = all.filter(({ t }) => t.state === 'done').sort((a, b) => (b.t.doneAt ?? '').localeCompare(a.t.doneAt ?? ''))
  const waiting = all.filter(({ t }) => t.state === 'open')
  const entries = [...done.slice(0, 4), ...waiting.slice(0, Math.max(0, 5 - Math.min(done.length, 4)))]
  const row = ({ t, p }: (typeof all)[number]) => {
    const status = statusLabel(t.state)
    const what = t.state === 'done'
      ? `${esc(p.name)}${t.donorHandle ? ` · by <a href="/volunteers/${esc(t.donorHandle)}">${esc(t.donorHandle)}</a>` : ''}`
      : `${esc(p.name)} · waiting for a volunteer`
    return `<li><span class="when">${t.state === 'done' ? esc(shortDate(t.doneAt)) : 'Open'}</span>
<span class="what"><strong>${esc(t.title)}</strong><span>${what}</span></span>
<span class="pill pill-${status.cls}">${status.text}</span></li>`
  }
  return page(
    { title: `${SITE.name}: a volunteer bank for digital work`, description: SITE.description, path: '/' },
    `<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <h1>A volunteer bank for digital work.</h1>
      <p class="lead">Give your AI's spare capacity, or your own skills, to nonprofits. They post small, clearly described tasks. We check every organization, keep every change inside its limits, and keep a public record of everything done.</p>
      <div class="actions">
        <a class="button" href="/volunteer#start">Start volunteering</a>
        <a class="button button-quiet" href="/organizations">Get help for your organization</a>
      </div>
      <p class="hero-note">Free. Works from the AI app on your phone. Pause any time.</p>
    </div>
    <section class="statement" aria-labelledby="statement-title">
      <div class="statement-head">
        <h2 id="statement-title">Public statement</h2>
        <p>Every task, who did it, and the change it made.</p>
      </div>
      ${entries.length ? `<ol>${entries.map(row).join('')}</ol>` : '<p class="wrap">No tasks yet.</p>'}
      <div class="statement-foot"><span class="num"><strong>${s.done}</strong> finished · <strong>${s.open}</strong> open</span><a href="/projects">All projects and tasks</a></div>
    </section>
  </div>
</section>

<section class="wrap section">
  <div class="section-head">
    <h2>How the bank works</h2>
    <p>Like a time bank: people give hours, the community gets help. Here the hours can be your AI's, and every withdrawal is a small, reviewed task.</p>
  </div>
  <div class="parties">
    <div class="party">
      <h3>Volunteers deposit</h3>
      <p class="role">Your AI's help, or your own skills.</p>
      <ul>
        <li>Connect the AI app you already use. Nothing to install.</li>
        <li>Choose how many tasks a month. Pause any time.</li>
        <li>Your finished work is credited to the name you choose.</li>
      </ul>
      <p><a href="/volunteer">How to start</a></p>
    </div>
    <div class="party">
      <h3>Organizations draw</h3>
      <p class="role">Small pieces of digital work, done and reviewed.</p>
      <ul>
        <li>Describe tasks with a clear goal, files and checks.</li>
        <li>Review each result as a pull request on GitHub.</li>
        <li>Merge what's right. Nothing changes without you.</li>
      </ul>
      <p><a href="/organizations">How it works for you</a></p>
    </div>
    <div class="party party-us">
      <h3>The bank keeps it safe</h3>
      <p class="role">That's us: Volunteer Pool.</p>
      <ul>
        <li>We vet organizations and check every brief.</li>
        <li>We make each AI plan first, stay in scope and prove its work.</li>
        <li>We keep the public statement and the house rules.</li>
      </ul>
      <p><a href="/handbook">Read the handbook</a></p>
    </div>
  </div>
</section>

<section class="wrap section-tight">
  <div class="principles">
    <p class="principle"><strong>Digital volunteering is volunteering.</strong> Less physical doesn't mean less giving: a fixed sign-up form helps as surely as an afternoon at the food bank.</p>
    <p class="principle"><strong>AI changes who does the work, not who owns the result.</strong> Every change is a contribution a person reviews, judged by evidence, not by confidence.</p>
  </div>
</section>

<section class="band">
  <div class="wrap section-tight">
    <dl class="balance" aria-label="The balance so far">
      <div><dt>tasks finished</dt><dd>${s.done}</dd></div>
      <div><dt>tasks open now</dt><dd>${s.open}</dd></div>
      <div><dt>${s.projects === 1 ? 'organization' : 'organizations'}</dt><dd>${s.projects}</dd></div>
      <div><dt>volunteers with finished work</dt><dd>${s.volunteers}</dd></div>
    </dl>
  </div>
</section>

<section class="wrap section">
  <div class="section-head">
    <h2>One task, start to finish</h2>
    <p>The same loop for every task and every AI app. Our server enforces it, so it's more than advice.</p>
  </div>
  <ol class="steps steps-cols">
    <li><div><h3>The organization packages it</h3><p>One outcome, the exact files, the steps, how to check it, and what not to touch. Vague tasks are refused.</p></div></li>
    <li><div><h3>Your AI claims it and plans</h3><p>One task at a time. Before changing anything it says what it understood, which files, how it will check, and its fallback.</p></div></li>
    <li><div><h3>It changes only what's allowed</h3><p>Edits outside the plan or the task's files are refused. For code, the project's own tests run on our test machine.</p></div></li>
    <li><div><h3>It hands in with evidence</h3><p>Each requirement, and how it's met. We scan for warning signs and open a pull request with the whole record.</p></div></li>
    <li><div><h3>A person decides</h3><p>The organization merges it, or asks for changes and closes it. Their feedback goes to the next attempt.</p></div></li>
    <li><div><h3>It goes on the public statement</h3><p>Merged work is listed with your name and a link to the change.</p></div></li>
  </ol>
  <p class="actions"><a class="button button-quiet" href="/handbook/what-happens-when">What happens when something goes wrong</a></p>
</section>

<section class="band">
  <div class="wrap section">
    <div class="section-head"><h2>Ways to give</h2></div>
    <div class="ways">
      <div class="way"><span class="tag">Available now</span><h3>With an AI chat app</h3><p>Claude, ChatGPT, Gemini, Grok or Le Chat, on your phone or in a browser. Best for writing, documentation and small fixes.</p><p><a href="/volunteer#apps">Connect your app</a></p></div>
      <div class="way"><span class="tag">Available now</span><h3>With a coding tool</h3><p>Claude Code, Codex, Gemini CLI, Cursor or GitHub Copilot on your computer. Takes every kind of task, including ones that need a computer.</p><p><a href="/volunteer#coding">Set it up</a></p></div>
      <div class="way"><span class="tag tag-soon">Coming soon</span><h3>With your own skills</h3><p>Programmers who'd rather code without AI: the same tasks, briefs and review, taken straight from the website.</p><p><a href="/handbook/volunteers#prefer-to-code-it-yourself">Read more</a></p></div>
      <div class="way"><span class="tag tag-soon">Coming soon</span><h3>With money</h3><p>A monthly gift that pays for AI work on tasks no volunteer has picked up. We need a legal home for donations first.</p><p><a href="/volunteer#money">Join the list</a></p></div>
    </div>
  </div>
</section>

<section class="wrap section narrow">
  <h2>Questions</h2>
  ${faqHtml([{ items: HOME_FAQ }])}
  <p class="actions"><a href="/faq">All questions</a></p>
</section>
${closingBand}
${faqJsonLd(HOME_FAQ)}`,
  )
}

// ---------- volunteer ----------

type AppGuide = { id: string; name: string; where: string; tested: boolean; steps: string[] }

const CHAT_APPS: AppGuide[] = [
  {
    id: 'claude', name: 'Claude', where: 'web, desktop and phone, including the free plan', tested: true,
    steps: [
      'On claude.ai (web or desktop): <strong>Settings → Connectors → Add custom connector</strong>.',
      `Name it <strong>Volunteer Pool</strong> and paste <code>${MCP_URL}</code>. Choose <strong>Add</strong>, then <strong>Connect</strong>.`,
      'Sign in here when the window opens, choose your public name and monthly limit, and allow it.',
      'On your phone, the connector appears in the Claude app by itself.',
    ],
  },
  {
    id: 'chatgpt', name: 'ChatGPT', where: 'Business, Enterprise and Edu', tested: false,
    steps: [
      'Your workspace admin may need to allow custom apps (developer mode) first.',
      `<strong>Settings → Apps and connectors → Create</strong>. Name it <strong>Volunteer Pool</strong>, paste <code>${MCP_URL}</code>, and choose OAuth sign-in.`,
      'Sign in here when asked, choose your name and limit, and allow it.',
      'On Plus and Pro, connectors may be read-only. We haven\'t tested those yet.',
    ],
  },
  {
    id: 'gemini', name: 'Gemini', where: 'Gemini app, where custom connectors are available', tested: false,
    steps: [
      `Add a custom connector (MCP server) in the Gemini app's settings, with the address <code>${MCP_URL}</code>.`,
      'Sign in here when asked, choose your name and limit, and allow it.',
    ],
  },
  {
    id: 'grok', name: 'Grok', where: 'paid plans', tested: false,
    steps: [
      `<strong>Settings → Connectors → Add custom connector</strong>, with the address <code>${MCP_URL}</code>.`,
      'Sign in here when asked, choose your name and limit, and allow it.',
    ],
  },
  {
    id: 'lechat', name: 'Le Chat', where: 'Mistral', tested: false,
    steps: [
      `<strong>Connectors → Add connector → Custom MCP connector</strong>, with the address <code>${MCP_URL}</code>.`,
      'Sign in here when asked, choose your name and limit, and allow it.',
    ],
  },
]

function appDetails(app: AppGuide, open = false): string {
  return `<details class="app" id="app-${app.id}"${open ? ' open' : ''}>
  <summary>${esc(app.name)} <small>${esc(app.where)}</small> <span class="${app.tested ? 'tested' : 'untested'}">${app.tested ? 'Tested' : 'Not tested yet'}</span></summary>
  <div class="app-body"><ol>${app.steps.map((s) => `<li>${s}</li>`).join('')}</ol></div>
</details>`
}

export function volunteerPage(config: SiteConfig): Response {
  const faq: [string, string][] = [
    ['Can I change how many tasks I give?', 'Yes, any time: on your account page, or tell your AI "change my Volunteer Pool limit to 3". 0 pauses volunteering.'],
    ['How much of my AI plan does a task use?', 'About as much as a normal working session of the same length. A small task is roughly one focused conversation of 10 to 30 minutes.'],
    ['Do I need a GitHub account?', 'No. You can sign in with GitHub, and soon with an emailed link. Our GitHub App delivers your work to the organization, credited to your public name.'],
    ['Is it safe for my device?', 'From a chat app, nothing runs on your device: your AI reads and edits through our server, and tests run on our test machine. From a coding tool, the project\'s code runs on your computer to test it, so work in a separate folder.'],
    ['What if my AI isn\'t sure what to do?', 'It hands the task back with the reason. That helps the organization improve the brief, and never counts against you.'],
  ]
  return page(
    {
      title: `Volunteer with your AI | ${SITE.name}`,
      description: 'Open a volunteer account, connect the AI app you already use (Claude, ChatGPT, Gemini, Grok, Le Chat or a coding tool), and do small, reviewed tasks for nonprofits.',
      path: '/volunteer',
      section: 'volunteer',
      turnstile: !!config.turnstileSiteKey,
    },
    `<div class="wrap page-head">
  <h1>Volunteer with the AI you already have</h1>
  <p class="lead">Open a volunteer account, connect your AI app, and give one small task at a time. Your AI follows the organization's brief, our server keeps it inside the limits, and a person at the organization reviews the result.</p>
</div>

<section class="wrap section-tight" id="start">
  <ol class="steps">
    <li><div><h3>Open your account</h3><p>Sign in with GitHub. Choose a public name (not your email) and how many tasks a month you want to give. If you start in your AI app, it asks you to sign in at this step.</p>
      <p class="actions"><a class="button button-dark" href="/signin?return=%2Faccount">Sign in with GitHub</a></p></div></li>
    <li><div><h3>Connect your AI app</h3><p>Add Volunteer Pool as a connector once. Pick your app below.</p></div></li>
    <li><div><h3>Start a shift</h3><p>Choose <strong>Start a volunteer shift</strong> from your AI app's menu, under the Volunteer Pool connector, or say:</p>
      <div class="say"><q>${START_PHRASE}</q><button class="copy" type="button" data-copy="${START_PHRASE}">Copy</button></div>
      <p class="muted">Naming Volunteer Pool tells your AI which connection to use. It tells you what it's doing at each step.</p></div></li>
  </ol>
</section>

<section class="band" id="apps">
  <div class="wrap section narrow">
    <h2>Connect your AI app</h2>
    <p>One time only. The connector address is <code>${MCP_URL}</code>. Your app opens our sign-in, so you never copy a password or key.</p>
    <div class="apps">${CHAT_APPS.map((a, i) => appDetails(a, i === 0)).join('')}</div>

    <h3 id="coding">Coding tools on your computer</h3>
    <p>Claude Code, Codex, Gemini CLI, Cursor and GitHub Copilot (in VS Code or the Copilot CLI) use a key instead of a sign-in window. Make one key per tool on <a href="/account">your account page</a>. The page shows the exact command to paste, and you can switch each key off on its own. Coding tools can also take tasks marked as needing a computer.</p>
  </div>
</section>

<section class="wrap section">
  <div class="two">
    <div>
      <h2>What your AI does</h2>
      <ol class="plain">
        <li>Asks the pool for a task that fits.</li>
        <li>Reads the brief and the project's files.</li>
        <li>States its plan before changing anything.</li>
        <li>Changes only the files the task allows.</li>
        <li>Runs the project's checks, for code tasks.</li>
        <li>Hands in with evidence for each requirement.</li>
      </ol>
      <p>A small task usually takes 10 to 30 minutes. Stay around in case it asks you something.</p>
    </div>
    <div>
      <h2>Your rules, in short</h2>
      <ul class="plain">
        <li>Use your own AI and plan, within its terms.</li>
        <li>One task at a time, and only that task.</li>
        <li>Don't guess: unclear briefs go back with the reason.</li>
        <li>Hand in only work that passes its checks.</li>
        <li>No secrets, tracking or surprises.</li>
      </ul>
      <p><a href="/handbook/volunteers">The volunteer handbook</a> has the details, and what happens to your work.</p>
    </div>
  </div>
</section>

<section class="wrap section-tight narrow">
  <h2>Questions volunteers ask</h2>
  ${faqHtml([{ items: faq }])}
</section>

<section class="band" id="money">
  <div class="wrap section narrow">
    <h2>Rather give money?</h2>
    <p>Soon, a monthly gift will pay for AI work on tasks no volunteer has picked up. We need a legal home for donations first. Leave your email and we'll write once when it opens. Nothing else.</p>
    <form method="post" action="/waitlist" class="form">
      <input type="hidden" name="kind" value="money">
      <label for="wl-email">Email</label>
      <input id="wl-email" name="email" type="email" required autocomplete="email">
      ${honeypot}
      ${turnstile(config)}
      <button class="button button-quiet" type="submit">Tell me when it opens</button>
    </form>
  </div>
</section>
${faqJsonLd(faq)}`,
  )
}

export function thanksPage(title: string, message: string): Response {
  return page(
    { title: `${title} | ${SITE.name}`, description: message, path: '/thanks', noindex: true },
    `<div class="wrap page-head narrow"><h1>${esc(title)}</h1><p class="lead">${esc(message)}</p><p><a href="/">Back to the home page</a></p></div>`,
  )
}

// ---------- organizations ----------

export function organizationsPage(config: SiteConfig, error?: string, values: Record<string, string> = {}): Response {
  const radio = (name: string, value: string, label: string) =>
    `<label class="check"><input type="radio" name="${name}" value="${value}"${values[name] === value ? ' checked' : ''} required><span>${label}</span></label>`
  const faq: [string, string][] = [
    ['What does it cost?', 'Nothing. Volunteers use their own AI plans or their own time, and the platform is free.'],
    ['Who owns the work?', 'You do. Volunteers contribute under your project\'s license, like any open-source contribution.'],
    ['Can a volunteer\'s AI break something?', 'Only through a pull request you review. It can change only the files a task allows, never your automation, and your checks run first. Nothing changes until you merge.'],
    ['Do we need a developer?', 'For writing tasks, no. For code, someone who can read a change and judge it. If you have nobody, say so when you apply and we\'ll look at it together.'],
    ['What if we get too much to review?', 'While five changes wait on your project, no new work starts there. We remind you after 7 days. You can pause any time.'],
    ['We\'re not on GitHub. Is that a problem?', 'No. We help you set it up in about an hour. <a href="/handbook/what-is-github">What GitHub is, in plain words</a>.'],
  ]
  return page(
    {
      title: `Get digital work done by volunteers | ${SITE.name}`,
      description: 'Free volunteer help with small digital tasks for nonprofits: fixes, docs, translations, accessibility. You stay in charge: every result is a pull request you merge or close.',
      path: '/organizations',
      section: 'organizations',
      turnstile: !!config.turnstileSiteKey,
    },
    `<div class="wrap page-head">
  <h1>Get digital work done by volunteers</h1>
  <p class="lead">You describe small, clear tasks. Volunteers and their AI tools do them, one at a time, inside the limits you set. Each result reaches you as a proposed change on GitHub: you review it, and merge it or close it. It's free, and nothing changes in your project without your approval.</p>
  <p class="actions"><a class="button" href="#apply">Apply for your organization</a><a class="button button-quiet" href="/handbook/organizations">Read the organization handbook</a></p>
</div>

<section class="wrap section-tight">
  <div class="two">
    <div>
      <h2>Good tasks</h2>
      <ul class="checklist">
        <li class="ok">Fixing a bug on your website or app</li>
        <li class="ok">Documentation, guides and volunteer handbooks</li>
        <li class="ok">Translations and accessibility fixes</li>
        <li class="ok">Small features and data clean-up scripts</li>
        <li class="ok">Research notes and summaries</li>
      </ul>
    </div>
    <div>
      <h2>Not a fit</h2>
      <ul class="plain">
        <li>Anything that needs private data, passwords, payments or access to live systems.</li>
        <li>Big redesigns that can't be split into small steps.</li>
      </ul>
      <h3>Who can apply</h3>
      <p>Registered nonprofits and charities in any country, and open-source projects that serve the public good.</p>
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap section">
    <div class="section-head"><h2>How it works for you</h2><p>About an hour to set up, with our help. Then minutes per task to review.</p></div>
    <ol class="steps steps-cols">
      <li><div><h3>Apply</h3><p>Tell us who you are and what you need. About five minutes.</p></div></li>
      <li><div><h3>Get onto GitHub</h3><p>A free, shared home for your project's files. We help if you're new to it: <a href="/handbook/what-is-github">what GitHub is</a>.</p></div></li>
      <li><div><h3>Secure your repository</h3><p>Five settings that make your review an enforced gate. <a href="/handbook/secure-your-repository">The 5-minute guide</a>.</p></div></li>
      <li><div><h3>Write your first tasks</h3><p>Two files: the task list and the rules for volunteers' AIs. We write the first three tasks with you. <a href="/handbook/work-packages">The checklist</a>.</p></div></li>
      <li><div><h3>Review the results</h3><p>Each arrives with the plan, the evidence, the test results, warning signs and a review checklist.</p></div></li>
      <li><div><h3>Merge or close</h3><p>Merged work is done and credited. Closed work goes back with your feedback for the next attempt.</p></div></li>
    </ol>
  </div>
</section>

<section class="wrap section">
  <div class="two">
    <div>
      <h2>What we do for you</h2>
      <ul class="plain">
        <li>Check every brief, and refuse vague or unsafe ones.</li>
        <li>Make every volunteer's AI plan first, stay inside your files, and prove its work.</li>
        <li>Refuse changes with hidden text or secrets, and flag other warning signs.</li>
        <li>Run your checks before the pull request opens.</li>
        <li>Pause tasks that keep failing, and slow down volunteers whose work is often turned down.</li>
        <li>Show your projects, reviews and safety settings on your account page.</li>
      </ul>
    </div>
    <div>
      <h2>What stays yours</h2>
      <ul class="plain">
        <li>Your project, your code and every decision.</li>
        <li>What gets merged: our GitHub App can only propose changes, never merge or change settings.</li>
        <li>The right to pause, change or leave at any time.</li>
      </ul>
      <p><a href="/handbook/safety-and-quality">Safety and quality, in detail</a></p>
    </div>
  </div>
</section>

<section class="band" id="apply">
  <div class="wrap section narrow">
    <h2>Apply for your organization</h2>
    <p>We reply within a week. Your contact details are used only to reply to you. Already on GitHub? <a href="/signin?return=%2Faccount">Sign in with GitHub</a> to see your projects once you're set up.</p>
    ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    <form method="post" action="/organizations/apply" class="form">
      <label for="org">Organization or project name</label>
      <input id="org" name="org_name" required maxlength="120" value="${esc(values.org_name)}">
      <label for="site">Website <span class="optional">(optional)</span></label>
      <input id="site" name="org_site" type="url" maxlength="200" placeholder="https://" value="${esc(values.org_site)}">
      <label for="contact">Your name</label>
      <input id="contact" name="contact_name" required maxlength="120" autocomplete="name" value="${esc(values.contact_name)}">
      <label for="email">Your email</label>
      <input id="email" name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(values.email)}">
      <label for="country">Country</label>
      <input id="country" name="country" maxlength="80" autocomplete="country-name" value="${esc(values.country)}">
      <fieldset>
        <legend>What kind of organization are you?</legend>
        ${radio('status_kind', 'nonprofit', 'Registered nonprofit or charity')}
        ${radio('status_kind', 'public-good', 'Open-source or public-good project')}
        ${radio('status_kind', 'other', 'Something else (tell us below)')}
      </fieldset>
      <fieldset>
        <legend>Are you on GitHub?</legend>
        ${radio('github', 'yes', 'Yes, we have a repository')}
        ${radio('github', 'help', "No, we'd like help getting started")}
      </fieldset>
      <label for="repo">Repository link <span class="optional">(if you have one)</span></label>
      <input id="repo" name="repo_url" type="url" maxlength="200" placeholder="https://github.com/..." value="${esc(values.repo_url)}">
      <label for="needs">What do you need help with?</label>
      <textarea id="needs" name="needs" required maxlength="4000" rows="6" aria-describedby="needs-help">${esc(values.needs)}</textarea>
      <p class="help" id="needs-help">A few sentences are enough. For example: our volunteer sign-up page breaks on phones, and our guide for new volunteers is out of date.</p>
      <label class="check"><input type="checkbox" name="agree" value="yes" required><span>I've read the <a href="/terms#organizations">terms for organizations</a> and the <a href="/privacy">privacy notice</a>.</span></label>
      ${honeypot}
      ${turnstile(config)}
      <button class="button" type="submit">Send application</button>
    </form>
  </div>
</section>

<section class="wrap section narrow">
  <h2>Questions organizations ask</h2>
  ${faqHtml([{ items: faq }])}
</section>
${faqJsonLd(faq)}`,
  )
}

// ---------- how the bank works ----------

export function howPage(): Response {
  return page(
    {
      title: `How the volunteer bank works | ${SITE.name}`,
      description: 'Who does what in Volunteer Pool: volunteers deposit their AI\'s help or their skills, organizations draw small reviewed tasks, and we keep it safe and public.',
      path: '/how-it-works',
    },
    `<div class="wrap page-head">
  <h1>How the volunteer bank works</h1>
  <p class="lead">A time bank lets people give hours and lets the community draw on them. Volunteer Pool does the same for digital work. The hours can be your AI's or your own, the withdrawals are small, clearly described tasks, and every transaction is on a public statement.</p>
</div>
<section class="wrap section-tight">
  <div class="three">
    <div class="panel"><h2>Deposits</h2><p>Volunteers connect the AI app they already use, or work themselves, and set how many tasks a month they give. Nothing is pooled or shared: each volunteer's AI works on their own plan.</p></div>
    <div class="panel"><h2>Withdrawals</h2><p>Organizations post work packages: one outcome, the exact files, the checks, the limits. Each finished one arrives as a pull request they review.</p></div>
    <div class="panel"><h2>The statement</h2><p>Every task, its status, who finished it and the change it made is public. So is every supported organization.</p></div>
  </div>
</section>
<section class="wrap section narrow prose">
  <h2>What the bank does</h2>
  <ul>
    <li><strong>Vets</strong> every organization before its work goes live.</li>
    <li><strong>Checks</strong> every brief, and refuses vague or unsafe ones.</li>
    <li><strong>Enforces the loop</strong>: plan first, only allowed files, checks, evidence, review.</li>
    <li><strong>Scans</strong> every change for warning signs before a person sees it.</li>
    <li><strong>Runs the house rules</strong>: review reminders, review queues, pausing tasks that keep failing, track records.</li>
    <li><strong>Keeps the record</strong>: the brief, the plan, the evidence and the decision, for every change.</li>
  </ul>
  <p>The full agreement, including who decides what and what happens when things go wrong, is in <a href="/handbook">the handbook</a>.</p>
</section>
${closingBand}`,
  )
}

// ---------- projects ----------

export function projectsPage(board: PublicBoard, query = '', cause = ''): Response {
  const q = query.trim().toLowerCase().slice(0, 80)
  const selected = (CAUSES as readonly string[]).includes(cause) ? cause : ''
  const matches = board.projects.filter((p) => {
    if (selected && p.cause !== selected) return false
    if (!q) return true
    const hay = [p.name, p.summary ?? '', CAUSE_LABELS[p.cause ?? ''] ?? '', ...p.tasks.map((t) => t.title)].join(' ').toLowerCase()
    return q.split(/\s+/).every((word) => hay.includes(word))
  })
  const present = new Set(board.projects.map((p) => p.cause ?? 'other'))
  const chipHref = (c: string) => `/projects${c || q ? `?${new URLSearchParams({ ...(q ? { q } : {}), ...(c ? { cause: c } : {}) })}` : ''}`
  const chips = [['', 'All causes'], ...CAUSES.filter((c) => present.has(c)).map((c) => [c, CAUSE_LABELS[c]!])]
    .map(([c, label]) => `<li><a href="${esc(chipHref(c!))}"${c === selected ? ' aria-current="true"' : ''}>${esc(label)}</a></li>`).join('')
  const cards = matches.map((p) => {
    const done = p.tasks.filter((t) => t.state === 'done').length
    const open = p.tasks.filter((t) => t.state === 'open').length
    return `<li class="project">
  <h2><a href="/projects/${esc(slugify(p.name))}">${esc(p.name)}</a></h2>
  <span class="cause">${esc(CAUSE_LABELS[p.cause ?? ''] ?? (p.nonprofit ? 'Nonprofit' : 'Public good'))}</span>
  ${p.summary ? `<p>${esc(p.summary)}</p>` : ''}
  <div class="counts"><span class="pill pill-open">${open} open</span><span class="pill pill-done">${done} done</span></div>
</li>`
  }).join('')
  return page(
    { title: `Supported projects | ${SITE.name}`, description: 'Every organization in the volunteer pool, by cause, with its open and finished tasks.', path: '/projects', section: 'projects' },
    `<div class="wrap page-head"><h1>Supported projects</h1><p class="lead">Every organization taking part, with every task and its status. Finished tasks link to the change that was merged.</p></div>
<section class="wrap section-tight">
  <form class="filters" method="get" action="/projects" role="search">
    <div><label for="q">Search projects and tasks</label><input id="q" name="q" type="search" value="${esc(query)}" placeholder="For example: translation, food bank, accessibility"></div>
    ${selected ? `<input type="hidden" name="cause" value="${esc(selected)}">` : ''}
    <button class="button button-quiet" type="submit">Search</button>
  </form>
  <ul class="chips" aria-label="Filter by cause">${chips}</ul>
  ${cards ? `<ul class="projects">${cards}</ul>` : `<div class="empty"><p>No projects match${q ? ` "${esc(query)}"` : ''}${selected ? ` in ${esc(CAUSE_LABELS[selected])}` : ''}.</p><p><a href="/projects">Show all projects</a> or <a href="/organizations">bring your organization's work</a>.</p></div>`}
</section>`,
  )
}

export function projectPage(project: PublicProject): Response {
  const groups: [string, string[]][] = [
    ['Open', ['open']],
    ['In progress', ['claimed', 'running', 'review']],
    ['Waiting', ['blocked', 'too-big', 'safety review']],
    ['Done', ['done']],
  ]
  const sections = groups
    .map(([label, states]) => {
      const tasks = project.tasks.filter((t) => states.includes(t.state))
      return tasks.length ? `<h2>${label}</h2><ul class="tasks">${tasks.map((t) => taskRow(t, project, false)).join('')}</ul>` : ''
    })
    .join('')
  const links = [
    project.github ? `<a href="${esc(project.github)}" rel="noopener">Repository on GitHub</a>` : '',
    project.orgUrl && !project.orgUrl.includes('example.org') ? `<a href="${esc(project.orgUrl)}" rel="noopener">Organization website</a>` : '',
  ].filter(Boolean)
  return page(
    {
      title: `${project.name} | ${SITE.name}`,
      description: project.summary ?? `Volunteer tasks for ${project.name}: what's open, in progress and done.`,
      path: `/projects/${slugify(project.name)}`,
      section: 'projects',
    },
    `<div class="wrap page-head"><p class="crumb"><a href="/projects">Projects</a>${project.cause ? ` · <a href="/projects?cause=${esc(project.cause)}">${esc(CAUSE_LABELS[project.cause] ?? project.cause)}</a>` : ''}</p><h1>${esc(project.name)}</h1>
<p class="lead">${project.summary ? `${esc(project.summary)} ` : ''}${project.nonprofit ? 'A nonprofit project.' : 'A public-good project.'}</p>
<p>${links.join(' · ')}</p></div>
<section class="wrap section-tight narrow">${sections || '<p>No tasks yet.</p>'}
<p class="actions"><a class="button" href="/volunteer#start">Volunteer for tasks like these</a></p></section>`,
  )
}

export function volunteersPage(board: PublicBoard): Response {
  const rows = [...board.donors]
    .sort((a, b) => b.tasksCompleted - a.tasksCompleted)
    .map((d) => `<li><span><a href="/volunteers/${esc(d.handle)}"><strong>${esc(d.handle)}</strong></a> <span class="muted">for ${d.projectsHelped.map(esc).join(', ')}</span></span><span class="num">${d.tasksCompleted} ${d.tasksCompleted === 1 ? 'task' : 'tasks'}</span></li>`)
    .join('')
  return page(
    { title: `Volunteers | ${SITE.name}`, description: 'Everyone who has finished a task, by the name they chose.', path: '/volunteers' },
    `<div class="wrap page-head"><h1>Volunteers</h1><p class="lead">Everyone with merged work, by the name they chose.</p></div>
<section class="wrap section-tight narrow">${rows ? `<ul class="rows">${rows}</ul>` : '<div class="empty"><p>No finished tasks yet.</p></div>'}<p class="actions"><a class="button" href="/volunteer#start">Become one</a></p></section>`,
  )
}

export function volunteerImpactPage(board: PublicBoard, handle: string, registered = false): Response | null {
  const done = board.projects.flatMap((p) => p.tasks.filter((t) => t.donorHandle === handle).map((t) => ({ t, p })))
  const donor = board.donors.find((d) => d.handle === handle)
  if (!donor && done.length === 0) {
    if (!registered) return null
    return page(
      { title: `${handle}, volunteer | ${SITE.name}`, description: `${handle} volunteers with Volunteer Pool.`, path: `/volunteers/${handle}`, noindex: true },
      `<div class="wrap page-head narrow"><p class="crumb"><a href="/volunteers">Volunteers</a></p><h1>${esc(handle)}</h1>
<p class="lead">No finished tasks yet. Tasks appear here once the organization merges the work.</p>
<div class="say"><q>${START_PHRASE}</q><button class="copy" type="button" data-copy="${START_PHRASE}">Copy</button></div></div>`,
    )
  }
  const orgs = [...new Set(done.map((d) => d.p.name))]
  return page(
    { title: `${handle}, volunteer | ${SITE.name}`, description: `${handle} has finished ${done.length} volunteer tasks.`, path: `/volunteers/${handle}` },
    `<div class="wrap page-head"><p class="crumb"><a href="/volunteers">Volunteers</a></p><h1>${esc(handle)}</h1>
<p class="lead">${done.length} ${done.length === 1 ? 'task' : 'tasks'} finished for ${orgs.length} ${orgs.length === 1 ? 'organization' : 'organizations'}: ${orgs.map((o) => `<a href="/projects/${esc(slugify(o))}">${esc(o)}</a>`).join(', ')}.</p></div>
<section class="wrap section-tight narrow"><h2>Finished tasks</h2><ul class="tasks">${done.map(({ t, p }) => taskRow(t, p, true)).join('')}</ul></section>`,
  )
}

// ---------- handbook ----------

function handbookShell(current: string, title: string, description: string, path: string, content: string): Response {
  const items = [...HANDBOOK.map((p) => ({ href: p.slug ? `/handbook/${p.slug}` : '/handbook', label: p.slug ? p.title.replace(/^Handbook for /, 'For ') : 'Overview', key: p.slug })), { href: '/handbook/templates', label: 'Templates', key: 'templates' }]
  const list = items.map((i) => `<li><a href="${i.href}"${i.key === current ? ' aria-current="page"' : ''}>${esc(i.label)}</a></li>`).join('')
  return page(
    { title: `${title} | ${SITE.name}`, description, path, section: 'handbook' },
    `<div class="wrap handbook">
  <nav class="handbook-nav" aria-label="Handbook"><h2>Handbook</h2><ul>${list}</ul></nav>
  <details class="handbook-mobile-nav"><summary>Handbook pages</summary><ul>${list}</ul></details>
  <article class="prose">${content}</article>
</div>`,
  )
}

export function handbookPage(slug: string): Response | null {
  const entry: HandbookPage | undefined = HANDBOOK.find((p) => p.slug === slug)
  if (!entry) return null
  const toc = entry.toc.length >= 4
    ? `<nav class="toc" aria-label="On this page"><h2>On this page</h2><ul>${entry.toc.map((t) => `<li><a href="#${esc(t.id)}">${esc(t.text)}</a></li>`).join('')}</ul></nav>`
    : ''
  const html = entry.html.replace(/(<\/h1>\n)/, `$1${toc}`)
  return handbookShell(
    slug,
    entry.title,
    entry.description,
    slug ? `/handbook/${slug}` : '/handbook',
    `${html}<p class="page-source">This page is kept in the project's repository as <a href="https://github.com/yonatan-langer83/volunteer-compute-broker/blob/main/${esc(entry.source)}" rel="noopener">${esc(entry.source)}</a>. Volunteers' AIs read the same rules.</p>`,
  )
}

export function templatesPage(): Response {
  const blocks = TEMPLATES.map((t) => `<h2 id="${slugify(t.file)}"><code>${esc(t.file)}</code></h2>
<p>${esc(t.note)}</p>
<pre><code>${esc(t.content)}</code></pre>
<button class="copy" type="button" data-copy="${esc(t.content)}">Copy file</button>`).join('\n')
  return handbookShell(
    'templates',
    'Templates for your repository',
    'Ready-made files for organizations: task list, rules for volunteers\' AIs, CODEOWNERS, a test workflow without secrets and a pull request template.',
    '/handbook/templates',
    `<h1>Templates for your repository</h1>
<p>Copy these into your repository and replace the placeholders. The first two are required. The others make review safer. See <a href="/handbook/secure-your-repository">Secure your repository</a> and <a href="/handbook/work-packages">Writing a good work package</a>.</p>
${blocks}`,
  )
}

// ---------- about, faq, legal ----------

export function aboutPage(config: SiteConfig): Response {
  return page(
    { title: `Who runs this | ${SITE.name}`, description: 'Why Volunteer Pool exists, who runs it, and what we promise organizations and volunteers.', path: '/about' },
    `<div class="wrap page-head"><h1>Who runs this, and why</h1>
<p class="lead">Volunteer Pool was started by someone who spent fifteen years in a nonprofit, organizing volunteers every day. In the real world a volunteer isn't blamed for not knowing what to do: the organization gives clear tasks, clear limits and support. This project brings that model to digital work, where many people now have powerful AI tools and many nonprofits have work they can't afford.</p></div>
<section class="wrap section-tight narrow prose">
  <h2>What we promise</h2>
  <ul>
    <li><strong>Free.</strong> No fees for organizations or volunteers.</li>
    <li><strong>Public.</strong> Every supported project and every finished task is listed, with links to the change.</li>
    <li><strong>Careful.</strong> We check every organization and every brief, and enforce the rules in <a href="/handbook">the handbook</a>.</li>
    <li><strong>Honest about status.</strong> This is a test phase. We say what works and what doesn't yet.</li>
  </ul>
  <h2>How it's run</h2>
  <p>The platform runs on Cloudflare. Projects live on GitHub. Its code is open on <a href="https://github.com/yonatan-langer83/volunteer-compute-broker" rel="noopener">GitHub</a>. Decisions about money, and a legal home for donations, will be made openly before any money is accepted.</p>
  <h2>Contact</h2>
  <p>Write to us through ${contactLine(config)}.</p>
</section>`,
  )
}

const FAQ_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Volunteering',
    items: [
      ['Do I need to know how to code?', 'No. Your AI does the work by following the organization\'s brief, and writing tasks need no technical knowledge. You need to be able to add a connector to your AI app, which takes a minute.'],
      ['Can I volunteer from my phone?', 'Yes. Add the connector in Claude, ChatGPT (Business, Enterprise or Edu), Gemini, Grok or Le Chat. Your AI works through our server, so nothing runs on your phone. Tasks that truly need a computer aren\'t offered to chat apps.'],
      ['How much of my AI plan does it use?', 'About as much as a normal working session of the same length. A small task is roughly one focused conversation. You set a monthly limit and can pause any time.'],
      ['Can I change how many tasks I give?', 'Yes, on your account page, or tell your AI "change my Volunteer Pool limit to 3". 0 pauses volunteering.'],
      ['Is sharing my AI plan allowed?', 'You don\'t share it. Your own AI app does the work on your own account, the normal way you use it. You never give anyone a password or key. Follow your AI provider\'s terms, as you always would.'],
      ['Do I need a GitHub account?', 'Sign-in currently uses GitHub. Email sign-in follows soon, and you can connect GitHub later. Your work reaches the organization through our GitHub App, credited to your public name.'],
      ['How does my AI know what volunteering means?', 'When you add the connector, our server tells your AI at the start of every chat what Volunteer Pool is, how a task works, and its limits. Each task then brings its own brief, the project\'s rules and our safety rules. <a href="/handbook/volunteers#how-your-ai-knows-what-to-do">More</a>.'],
      ['Does my AI store the work package?', 'No. The brief and files are read from our server during the task, and your AI\'s changes stay on our server. Nothing is saved on your device or in your AI\'s memory, and the next task starts fresh.'],
      ['How do I start a shift?', `Choose "Start a volunteer shift" from your AI app's menu under the Volunteer Pool connector, or say: "${START_PHRASE}"`],
      ['Where can I see what I did?', 'On your account page, and on your public page once the organization merges your work.'],
    ],
  },
  {
    title: 'Organizations',
    items: [
      ['Who can get help?', 'Registered nonprofits and charities in any country, and open-source projects that serve the public good. We help organizations that aren\'t on GitHub yet.'],
      ['What kind of work fits?', 'Small, checkable pieces: bug fixes, documentation, translations, accessibility, small features, data clean-up, research notes. Not work that needs private data, passwords or live systems.'],
      ['How do we stay in control?', 'Every result is a pull request in your repository. Your checks run, the right people review, and nothing changes until you merge. Our app can\'t merge or change settings.'],
      ['How much work is reviewing?', 'Minutes per task, if tasks are small. Each pull request has the plan, evidence and a checklist. While five wait for review, no new work starts on your project.'],
    ],
  },
  {
    title: 'Safety and quality',
    items: [
      ['How do you make sure the work is good?', 'Several layers: checked briefs, a plan before any change, edits limited to the task\'s files, tests, evidence for each requirement, a warning-sign scan, track records, and a person\'s review. <a href="/handbook/safety-and-quality">The details</a>.'],
      ['How do you keep organizations from getting spam?', 'One task at a time per volunteer, monthly limits, failing work refused before it reaches GitHub, review queues capped at five, and volunteers whose work is often turned down are slowed down or paused.'],
      ['Do all AI models do good enough work?', 'Not equally, so we don\'t trust any of them blindly. Every app faces the same gates, and the track record catches weak results. If a tool consistently fails, we\'ll say so and can restrict it.'],
      ['How do you know the AI followed the brief?', 'It has to show it. The exact brief and its fingerprint, the AI\'s plan, the change built by our server, and the evidence all appear side by side in the pull request.'],
      ['What about hidden malicious code?', 'Changes can only touch the task\'s files and never your automation. Hidden text and secrets are blocked, risky patterns are flagged, your tests and GitHub\'s scanners run, and a person reviews. Everything can be reverted in one click.'],
      ['Can programmers help without AI?', 'Yes. The same tasks, briefs and review apply. Taking a task straight from the website is coming soon.'],
    ],
  },
  {
    title: 'About the project',
    items: [
      ['Can I give money instead?', 'Soon. We need a legal home for donations first. <a href="/volunteer#money">Join the list</a> and we\'ll tell you when it opens.'],
      ['Who runs Volunteer Pool?', 'Someone with fifteen years of nonprofit volunteer management. <a href="/about">More about us</a>.'],
      ['Is it free?', 'Yes, for volunteers and organizations.'],
    ],
  },
]

export function faqPage(): Response {
  return page(
    { title: `Questions | ${SITE.name}`, description: 'Answers to common questions from volunteers and organizations about Volunteer Pool, safety and quality.', path: '/faq', section: 'faq' },
    `<div class="wrap page-head narrow"><h1>Questions</h1><p class="lead">Short answers. The <a href="/handbook">handbook</a> has the full version.</p></div>
<section class="wrap section-tight narrow">${faqHtml(FAQ_GROUPS)}</section>
${closingBand}
${faqJsonLd(FAQ_GROUPS.flatMap((g) => g.items))}`,
  )
}

export function privacyPage(config: SiteConfig): Response {
  return page(
    { title: `Privacy | ${SITE.name}`, description: 'What we collect, why, where it is stored and how long we keep it.', path: '/privacy' },
    `<div class="wrap page-head narrow"><h1>Privacy</h1><p>Last updated 24 November 2026.</p></div>
<section class="wrap section-tight narrow prose">
<h2>What we collect</h2>
<ul>
<li><strong>Your account:</strong> your GitHub user name and ID, or your email address if you sign in by email, and when you last signed in. Used only to sign you in.</li>
<li><strong>Volunteers:</strong> the public name you choose (public by design), your monthly limit, the AI apps you connected, and the record of your tasks. We store only a scrambled form of your keys, never the keys themselves.</li>
<li><strong>Volunteer work:</strong> your AI's plan, summary, evidence and change. Kept private until the organization reviews it in its own GitHub repository; merged work is public.</li>
<li><strong>Organizations that apply:</strong> organization name, website, your name, email, country and what you need. Used only to review your application and reply.</li>
<li><strong>The waiting list:</strong> your email. Used once, to tell you giving money opened.</li>
<li><strong>Abuse protection:</strong> forms use Cloudflare Turnstile, and we keep a scrambled form of your network address for one day to limit repeated attempts.</li>
</ul>
<p>We never see your conversations with your AI app.</p>
<h2>Cookies</h2>
<p>One cookie keeps you signed in (30 days), and a short-lived one protects the GitHub sign-in. No advertising or tracking cookies.</p>
<h2>Where it's stored</h2>
<p>In a Cloudflare D1 database and Cloudflare KV operated for this project. Pull requests are stored on GitHub by the organization that owns the repository.</p>
<h2>How long we keep it</h2>
<p>Accounts: until you ask us to delete them. Applications: until two years after we last worked with you. Waiting list: until we've written to you. The record of finished work: as long as the public record exists. Merged contributions stay in the organization's history under your public name.</p>
<h2>Your rights</h2>
<p>You can ask to see, correct or delete what we hold about you. Write to ${contactLine(config)}. We answer within 30 days.</p>
</section>`,
  )
}

export function termsPage(): Response {
  return page(
    { title: `Terms and rules | ${SITE.name}`, description: 'The rules for volunteers and organizations in Volunteer Pool.', path: '/terms' },
    `<div class="wrap page-head narrow"><h1>Terms and rules</h1><p>Last updated 24 November 2026. This is a free test service, provided as is. The <a href="/handbook">handbook</a> explains these rules in more detail.</p></div>
<section class="wrap section-tight narrow prose">
<h2 id="volunteers">For volunteers</h2>
<ul>
<li>Use your own AI app and plan, within your AI provider's terms. Don't share accounts, passwords or keys, and don't run automated scripts against a consumer chat plan.</li>
<li>Keep your keys private. Anything done with your account or keys counts as yours.</li>
<li>Do only the task you claimed, within its limits. Your AI states a plan first and hands in evidence. Hand back unclear tasks instead of guessing.</li>
<li>Never add secrets, tracking, hidden content or anything the task didn't ask for.</li>
<li>Your contribution is offered under the license of the project you work on.</li>
<li>From a coding tool, the project's code runs on your computer. Work in a separate folder. We check organizations, but can't guarantee any project's code.</li>
<li>We may slow down, pause or remove a volunteer whose work is often turned down or who breaks these rules.</li>
</ul>
<h2 id="organizations">For organizations</h2>
<ul>
<li>You're responsible for the tasks you post and for everything you merge, as with any volunteer.</li>
<li>Tasks must be clear, safe and free of private data, passwords and access to live systems.</li>
<li>Our GitHub App only opens pull requests. Review each one before merging, and keep your tests free of secrets.</li>
<li>Please review within a week. While five changes wait, no new work starts on your project.</li>
<li>You agree that your project, tasks and finished work are listed publicly.</li>
<li>We may pause a project whose tasks are unsafe or which stops reviewing work.</li>
</ul>
</section>`,
  )
}

export function accessibilityPage(config: SiteConfig): Response {
  return page(
    { title: `Accessibility | ${SITE.name}`, description: 'How this site is built to be accessible, and how to report a problem.', path: '/accessibility' },
    `<div class="wrap page-head narrow"><h1>Accessibility</h1><p>Last updated 24 November 2026.</p></div>
<section class="wrap section-tight narrow prose">
<p>We aim for WCAG 2.2 level AA. The site uses Atkinson Hyperlegible, a typeface designed for readability. It is plain HTML that works without JavaScript, with visible keyboard focus, labelled form fields, text colours that meet AA contrast, and almost no motion (none if your device asks for reduced motion). Pages work at 360 pixels wide and when zoomed to 200%.</p>
<p>Volunteering needs no terminal: chat apps connect with a sign-in window. Known limits: the anti-spam check on forms is provided by Cloudflare, and coding tools need a terminal.</p>
<p>Found a problem? Tell us through ${contactLine(config)} and we'll fix it.</p>
</section>`,
  )
}

export function notFoundPage(): Response {
  return page(
    { title: `Page not found | ${SITE.name}`, description: 'This page does not exist.', path: '/404', noindex: true },
    `<div class="wrap page-head narrow"><h1>There's no page here.</h1><p class="lead">It may have moved. Try the <a href="/">home page</a>, <a href="/volunteer">volunteering</a>, <a href="/projects">projects</a> or <a href="/handbook">the handbook</a>.</p></div>`,
    404,
  )
}
