import type { PublicBoard, PublicProject } from '../public-board.js'
import { esc, page, SITE, slugify, statusLabel } from './layout.js'

export type SiteConfig = { turnstileSiteKey: string | null; contactEmail: string | null }

const MCP_URL = `${SITE.origin}/mcp`

function contactLine(config: SiteConfig): string {
  return config.contactEmail
    ? `<a href="mailto:${esc(config.contactEmail)}">${esc(config.contactEmail)}</a>`
    : 'the organization form on <a href="/organizations#apply">For organizations</a> (a direct address follows before public launch)'
}

function turnstile(config: SiteConfig): string {
  return config.turnstileSiteKey
    ? `<div class="cf-turnstile" data-sitekey="${esc(config.turnstileSiteKey)}" data-theme="light"></div>`
    : ''
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

function taskRow(task: PublicProject['tasks'][number], project: PublicProject, withProject: boolean): string {
  const status = statusLabel(task.state)
  const who = task.donorHandle ? ` by <a href="/volunteers/${esc(task.donorHandle)}">${esc(task.donorHandle)}</a>` : ''
  const pr = task.prUrl ? ` <a href="${esc(task.prUrl)}" rel="noopener">See the change</a>` : ''
  return `<li class="task">
  <span class="pill pill-${status.cls}">${status.text}</span>
  <span class="task-title">${esc(task.title)}</span>
  <span class="task-meta">${withProject ? `<a href="/projects/${esc(slugify(project.name))}">${esc(project.name)}</a>, ` : ''}${esc(task.size)} task${who}.${pr}</span>
</li>`
}

// ---------- home ----------

export function homePage(board: PublicBoard): Response {
  const s = stats(board)
  const order = ['open', 'review', 'claimed', 'running', 'done', 'blocked']
  const recent = board.projects
    .flatMap((p) => p.tasks.map((t) => ({ t, p })))
    .sort((a, b) => order.indexOf(a.t.state) - order.indexOf(b.t.state))
    .slice(0, 5)
  return page(
    { title: `${SITE.name}: volunteer for nonprofits with the AI you already have`, description: SITE.description, path: '/' },
    `<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-text">
      <h1>Volunteer for nonprofits with the AI you already have.</h1>
      <p class="lead">Nonprofits describe small pieces of digital work. You connect your AI tool and it does one task at a time, following the organization's instructions. The organization reviews every result. Everything that gets finished is public.</p>
      <div class="actions">
        <a class="button" href="/volunteer#start">Start volunteering</a>
        <a class="button button-quiet" href="/organizations">Get help for your organization</a>
      </div>
    </div>
    <aside class="board" aria-labelledby="board-title">
      <h2 id="board-title">On the board now</h2>
      ${recent.length ? `<ul class="tasks">${recent.map(({ t, p }) => taskRow(t, p, true)).join('')}</ul>` : '<p>No tasks yet.</p>'}
      <p class="board-foot"><a href="/projects">All projects and tasks</a></p>
    </aside>
  </div>
</section>

<section class="wrap counts" aria-label="Progress so far">
  <p><strong>${s.done}</strong> tasks finished</p>
  <p><strong>${s.open}</strong> tasks open now</p>
  <p><strong>${s.projects}</strong> ${s.projects === 1 ? 'organization' : 'organizations'}</p>
  <p><strong>${s.volunteers}</strong> ${s.volunteers === 1 ? 'volunteer' : 'volunteers'} with finished work</p>
</section>

<section class="wrap section">
  <h2>Three ways in</h2>
  <div class="ways">
    <div class="way">
      <h3>You want to volunteer</h3>
      <p>You have Claude Code, Gemini CLI or Codex. Pick a nickname, run one command, and tell your AI you're ready. No GitHub account needed.</p>
      <p><a href="/volunteer">How to start volunteering</a></p>
    </div>
    <div class="way">
      <h3>Your organization needs help</h3>
      <p>You're a nonprofit or a public-good project. Apply, and we help you set up on GitHub, write your first tasks and review the results.</p>
      <p><a href="/organizations">How it works for organizations</a></p>
    </div>
    <div class="way way-later">
      <h3>You'd rather give money</h3>
      <p>Coming soon. Money will pay for AI work on tasks that no volunteer has picked up. Join the list and we'll tell you when it opens.</p>
      <p><a href="/volunteer#coming">Join the list</a></p>
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap section">
    <h2>How a task gets done</h2>
    <ol class="steps">
      <li><h3>An organization describes a small task</h3><p>What to change, which files, how to test it, and what not to touch. Vague tasks are refused.</p></li>
      <li><h3>Your AI claims it and does the work</h3><p>One task at a time, on your own plan. If the instructions are unclear, it hands the task back instead of guessing.</p></li>
      <li><h3>The organization reviews it</h3><p>The work arrives as a pull request in their GitHub repository. Their tests run. They merge it or close it.</p></li>
      <li><h3>Finished work is public</h3><p>Merged tasks appear on the project page and on your volunteer page, with a link to the change.</p></li>
    </ol>
    <p><a href="/how-it-works">More on how it works</a></p>
  </div>
</section>

<section class="wrap section">
  <h2>Why it's built this way</h2>
  <div class="ways">
    <div class="way"><h3>Organizations stay in charge</h3><p>Like any good volunteer program, the organization decides what gets done and how. Nothing changes in their project until they merge it.</p></div>
    <div class="way"><h3>Your AI, your plan</h3><p>You never hand over a password or an API key. Your own AI app does the work on your own subscription, the normal way you use it.</p></div>
    <div class="way"><h3>Everything is public</h3><p>Which organizations are supported, which tasks were done, by which nickname, with links to every change.</p></div>
  </div>
</section>`,
  )
}

// ---------- volunteer ----------

export function volunteerPage(config: SiteConfig, error?: string, values: Record<string, string> = {}): Response {
  return page(
    {
      title: `Volunteer with your AI tool | ${SITE.name}`,
      description: 'Pick a nickname, connect Claude Code, Gemini CLI or Codex with one command, and finish small tasks for nonprofits. No GitHub account needed.',
      path: '/volunteer',
      section: 'volunteer',
      turnstile: !!config.turnstileSiteKey,
    },
    `<div class="wrap page-head">
  <h1>Volunteer with your AI tool</h1>
  <p class="lead">If you use Claude Code, Gemini CLI or Codex, you can give some of your plan to nonprofits. Pick a nickname, connect with one command, and tell your AI you're ready. It finishes one small task at a time, following the organization's instructions. You don't need a GitHub account or coding skills.</p>
</div>

<section class="wrap section">
  <h2>Choose how you want to help</h2>
  <div class="ways">
    <div class="way"><h3>With an AI coding tool</h3><p class="tag tag-live">Available now</p><p>Claude Code, Gemini CLI or Codex on a Windows, Mac or Linux computer.</p><p><a href="#start">Start below</a></p></div>
    <div class="way way-later"><h3>With a chat app</h3><p class="tag">Coming soon</p><p>claude.ai, ChatGPT or the Gemini app, on your phone or in the browser, for writing and research tasks.</p><p><a href="#coming">Join the list</a></p></div>
    <div class="way way-later"><h3>With money</h3><p class="tag">Coming soon</p><p>A monthly gift that pays for AI work on tasks nobody has picked up yet.</p><p><a href="#coming">Join the list</a></p></div>
  </div>
</section>

<section class="band" id="start">
  <div class="wrap section narrow">
    <h2>Start: get your connection key</h2>
    <p>Your nickname is shown publicly next to the tasks you finish. Don't use your real name unless you want to. We don't ask for your email.</p>
    ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    <form method="post" action="/volunteer/join" class="form">
      <label for="nickname">Nickname</label>
      <input id="nickname" name="nickname" required minlength="2" maxlength="32" pattern="[A-Za-z][A-Za-z0-9-]{1,31}" autocomplete="nickname" value="${esc(values.nickname)}" aria-describedby="nickname-help">
      <p class="help" id="nickname-help">2 to 32 letters, numbers or dashes, starting with a letter. For example: maya-helps.</p>

      <label for="monthly">Tasks per month, at most</label>
      <input id="monthly" name="monthly" type="number" min="1" max="50" value="${esc(values.monthly || '10')}" required aria-describedby="monthly-help">
      <p class="help" id="monthly-help">Your AI never takes more than this. Small tasks use a few minutes of your plan.</p>

      <label class="check"><input type="checkbox" name="agree" value="yes" required><span>I've read the <a href="/terms#volunteers">volunteer rules</a>. I'll use my own AI plan, within its terms, and I won't share my connection key.</span></label>
      ${honeypot}
      ${turnstile(config)}
      <button class="button" type="submit">Get my connection key</button>
    </form>
  </div>
</section>

<section class="wrap section" id="tools">
  <h2>What you need</h2>
  <ul class="plain">
    <li><strong>A computer</strong> with Windows, macOS or Linux.</li>
    <li><strong>An AI coding tool on a paid plan:</strong> <a href="https://docs.claude.com/en/docs/claude-code/setup" rel="noopener">Claude Code</a>, <a href="https://github.com/google-gemini/gemini-cli" rel="noopener">Gemini CLI</a> or <a href="https://developers.openai.com/codex" rel="noopener">Codex</a>.</li>
    <li><strong>git</strong>, so your AI can download the project. On Windows: <code>winget install Git.Git</code>. On a Mac it's usually there already.</li>
    <li>Whatever the project uses to run its tests, such as Python or Node.js. Each task says what it needs, and your AI will tell you if something is missing.</li>
  </ul>
  <p>New to this? Install Claude Code, then open a new terminal window so it can be found. On Windows that's PowerShell: <code>irm https://claude.ai/install.ps1 | iex</code>.</p>

  <h2>What happens when you volunteer</h2>
  <ol class="steps steps-compact">
    <li><p>Make an empty folder for volunteer work and start your AI tool there.</p></li>
    <li><p>Tell it: <q>I'm ready for 1 small volunteer task.</q> It asks the pool for a task that fits.</p></li>
    <li><p>It reads the organization's instructions, downloads the project, makes the change and runs the tests. A small task holds for 45 minutes, a medium one for 90.</p></li>
    <li><p>It hands back the result. If the instructions are unclear, it hands the task back instead of guessing. That's the right thing to do.</p></li>
    <li><p>The organization reviews it. When they merge it, it shows on your volunteer page.</p></li>
  </ol>

  <h2>Is it safe for my computer?</h2>
  <p>Your AI downloads a project and runs its tests, which means running that project's code on your computer. That's why every organization is checked before its tasks go live, and why every task is scanned for instructions that try to misuse your AI. Work in a separate folder. Your AI tool still asks before risky actions.</p>
</section>

<section class="band" id="coming">
  <div class="wrap section narrow">
    <h2>Chat apps and money: join the list</h2>
    <p>Volunteering from claude.ai, ChatGPT or the Gemini app needs a simple sign-in we're still building. Giving money needs a legal home for donations, which we're setting up. Leave your email and we'll write once when it opens. Nothing else.</p>
    <form method="post" action="/waitlist" class="form">
      <label for="wl-email">Email</label>
      <input id="wl-email" name="email" type="email" required autocomplete="email">
      <fieldset>
        <legend>Tell me when this opens</legend>
        <label class="check"><input type="radio" name="kind" value="chat" checked><span>Volunteering from a chat app</span></label>
        <label class="check"><input type="radio" name="kind" value="money"><span>Giving money</span></label>
      </fieldset>
      ${honeypot}
      ${turnstile(config)}
      <button class="button" type="submit">Join the list</button>
    </form>
  </div>
</section>`,
  )
}

export function joinedPage(nickname: string, token: string): Response {
  const commands = [
    {
      name: 'Claude Code',
      open: true,
      body: `<p>In a terminal (PowerShell on Windows), run:</p>
<pre><code>claude mcp add --scope user --transport http volunteer ${MCP_URL} --header "Authorization: Bearer ${esc(token)}"</code></pre>
<button class="copy" type="button" data-copy="claude mcp add --scope user --transport http volunteer ${MCP_URL} --header &quot;Authorization: Bearer ${esc(token)}&quot;">Copy command</button>
<p>Then check it with <code>claude mcp list</code>. You should see <q>volunteer</q> and <q>Connected</q>.</p>`,
    },
    {
      name: 'Gemini CLI',
      open: false,
      body: `<pre><code>gemini mcp add --scope user --transport http --header "Authorization: Bearer ${esc(token)}" volunteer ${MCP_URL}</code></pre>
<button class="copy" type="button" data-copy="gemini mcp add --scope user --transport http --header &quot;Authorization: Bearer ${esc(token)}&quot; volunteer ${MCP_URL}">Copy command</button>
<p>Then check it with <code>gemini mcp list</code>.</p>`,
    },
    {
      name: 'Codex',
      open: false,
      body: `<p>Codex reads the key from a setting on your computer. On Windows (PowerShell), run these two lines, then open a new terminal:</p>
<pre><code>setx VOLUNTEER_TOKEN "${esc(token)}"
codex mcp add volunteer --url ${MCP_URL} --bearer-token-env-var VOLUNTEER_TOKEN</code></pre>
<p>On a Mac or Linux, add <code>export VOLUNTEER_TOKEN="${esc(token)}"</code> to your shell profile instead of <code>setx</code>.</p>`,
    },
  ]
  return page(
    { title: `Your connection key | ${SITE.name}`, description: 'Connect your AI tool to the volunteer pool.', path: '/volunteer/join', section: 'volunteer', noindex: true },
    `<div class="wrap page-head narrow">
  <h1>Welcome, ${esc(nickname)}. Here's your connection key.</h1>
  <p class="lead">This is the only time it's shown. Copy it now, or copy the command for your tool below. Treat it like a password: anyone with it can volunteer in your name.</p>
  <div class="keybox"><code id="key">${esc(token)}</code><button class="copy" type="button" data-copy="${esc(token)}">Copy key</button></div>
</div>
<section class="wrap section narrow">
  <h2>Connect your AI tool</h2>
  ${commands.map((c) => `<details class="tool"${c.open ? ' open' : ''}><summary>${c.name}</summary>${c.body}</details>`).join('')}
  <h2>Then start</h2>
  <p>Make an empty folder, start your tool in it, and say:</p>
  <pre><code>I'm ready for 1 small volunteer task.</code></pre>
  <p>Your finished tasks will appear on <a href="/volunteers/${esc(nickname)}">your volunteer page</a> once the organization merges them.</p>
  <p class="help">Lost the key? Pick a new nickname and get a new one. To stop the old key working, contact us.</p>
</section>`,
    200,
    { 'cache-control': 'no-store' },
  )
}

export function thanksPage(title: string, message: string): Response {
  return page(
    { title: `${title} | ${SITE.name}`, description: message, path: '/thanks', noindex: true },
    `<div class="wrap page-head narrow"><h1>${esc(title)}</h1><p class="lead">${esc(message)}</p><p><a href="/">Back to the home page</a></p></div>`,
    200,
    { 'cache-control': 'no-store' },
  )
}

// ---------- organizations ----------

export function organizationsPage(config: SiteConfig, error?: string, values: Record<string, string> = {}): Response {
  const radio = (name: string, value: string, label: string) =>
    `<label class="check"><input type="radio" name="${name}" value="${value}"${values[name] === value ? ' checked' : ''} required><span>${label}</span></label>`
  return page(
    {
      title: `Volunteer help for nonprofits | ${SITE.name}`,
      description: 'Get small pieces of software work done by volunteers and their AI tools. Free. You stay in charge: every result is a pull request you merge or close.',
      path: '/organizations',
      section: 'organizations',
      turnstile: !!config.turnstileSiteKey,
    },
    `<div class="wrap page-head">
  <h1>Get digital work done by volunteers</h1>
  <p class="lead">You describe small, clear tasks. Volunteers' AI tools do them, one at a time. Each result reaches you as a pull request on GitHub: you check it and merge it or close it. It's free, and nothing changes in your project without your approval.</p>
  <p><a class="button" href="#apply">Apply for your organization</a></p>
</div>

<section class="wrap section">
  <h2>Is this for you?</h2>
  <div class="two">
    <div>
      <h3>Who can apply</h3>
      <ul class="plain">
        <li>Registered nonprofits and charities, in any country.</li>
        <li>Open-source projects that serve the public good.</li>
        <li>You need someone on your side who can look at the results. We help with that at the start.</li>
      </ul>
    </div>
    <div>
      <h3>Good tasks</h3>
      <ul class="plain">
        <li>Fixing a bug on your website or app.</li>
        <li>Writing or improving documentation and guides.</li>
        <li>Translations and accessibility fixes.</li>
        <li>Small features and clean-up scripts for your data.</li>
      </ul>
      <h3>Not a fit</h3>
      <ul class="plain">
        <li>Anything that needs private data, passwords or access to live systems.</li>
        <li>Large redesigns that can't be split into small steps.</li>
      </ul>
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap section">
    <h2>How it works for you</h2>
    <ol class="steps">
      <li><h3>Apply</h3><p>Tell us who you are and what you need. It takes about five minutes.</p></li>
      <li><h3>We talk</h3><p>We check that you're a nonprofit or public-good project and look at what you need together.</p></li>
      <li><h3>We set you up</h3><p>Your project gets a GitHub repository with two small files: the task list and the rules for volunteers. If you're not on GitHub yet, we help with that too.</p></li>
      <li><h3>Volunteers do the tasks</h3><p>Each finished task arrives as a pull request, with the volunteer's report and your project's tests already run.</p></li>
      <li><h3>You decide</h3><p>Merge it and the task is done and listed publicly. Close it and the task goes back for another volunteer.</p></li>
    </ol>
  </div>
</section>

<section class="wrap section" id="github">
  <h2>Not on GitHub yet?</h2>
  <p>GitHub is where software projects keep their files and review changes. It's free for public projects. Volunteers' work arrives there as a proposed change you can look at line by line before accepting it.</p>
  <ul class="plain">
    <li>We help you create a free GitHub organization and your first repository.</li>
    <li>Verified nonprofits can get GitHub's Team plan free through <a href="https://nonprofits.github.com" rel="noopener">GitHub for Nonprofits</a>, if you need private repositories.</li>
    <li>We write your first tasks together with you, so you see what a good task looks like.</li>
  </ul>

  <h2>What goes into your repository</h2>
  <div class="two">
    <div>
      <h3>The task list</h3>
      <p>A file called <code>volunteer-compute.yaml</code>. Each task says what to do, which files to change, how to test it, what not to touch and what to hand back. Tasks that are vague or contradict themselves are refused automatically.</p>
    </div>
    <div>
      <h3>The rules for volunteers</h3>
      <p>A file called <code>AGENTS.md</code>: how to set up the project, your coding style and anything volunteers must never do. Every volunteer's AI reads it before each task.</p>
    </div>
  </div>
  <p>Then you install our GitHub App on that one repository. It can open pull requests and nothing else: it never merges, and it refuses any change to your automation settings.</p>
</section>

<section class="band" id="apply">
  <div class="wrap section narrow">
    <h2>Apply for your organization</h2>
    <p>We reply within a week. Your contact details are used only to reply to you.</p>
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

<section class="wrap section">
  <h2>Questions organizations ask</h2>
  <dl class="faq">
    <dt>What does it cost?</dt><dd>Nothing. Volunteers use their own AI plans, and the platform is free.</dd>
    <dt>Who owns the work?</dt><dd>You do. Volunteers contribute under your project's license, the same way any open-source contribution works.</dd>
    <dt>Can a volunteer's AI break something?</dt><dd>Only through a pull request you review. Your tests run on it first, and nothing changes until you merge.</dd>
    <dt>Do we need a developer?</dt><dd>It helps to have someone who can read a change and judge it. If you don't, tell us in the application and we'll look at it together.</dd>
  </dl>
</section>`,
  )
}

// ---------- how it works ----------

export function howPage(): Response {
  return page(
    {
      title: `How it works | ${SITE.name}`,
      description: 'How organizations, volunteers and the host work together: small tasks, one AI at a time, reviewed as pull requests, listed publicly.',
      path: '/how-it-works',
      section: 'how',
    },
    `<div class="wrap page-head">
  <h1>How does Volunteer Pool work?</h1>
  <p class="lead">It works like a volunteer center. The organization says what needs doing and stays responsible for it. Volunteers show up with their own AI tool and do one task at a time. We run the center: we check organizations, help them write good tasks, hand out the work and keep the public record.</p>
</div>
<section class="wrap section">
  <h2>Who does what</h2>
  <div class="table-wrap"><table>
    <thead><tr><th scope="col"></th><th scope="col">Organizations</th><th scope="col">Volunteers</th><th scope="col">Us, the host</th></tr></thead>
    <tbody>
      <tr><th scope="row">Brings</th><td>The work, the rules, the review</td><td>Their AI tool and plan</td><td>The platform, vetting and help</td></tr>
      <tr><th scope="row">Needs</th><td>A GitHub repository (we help)</td><td>A nickname and one command</td><td></td></tr>
      <tr><th scope="row">Decides</th><td>What gets done and what gets merged</td><td>How many tasks, and which kind</td><td>Which organizations join</td></tr>
      <tr><th scope="row">Gets</th><td>Finished, tested changes</td><td>A public record of their help</td><td></td></tr>
    </tbody>
  </table></div>
</section>
<section class="band"><div class="wrap section">
  <h2>The life of one task</h2>
  <ol class="steps">
    <li><h3>Written</h3><p>The organization adds a task with a goal, exact files, test commands, limits and what to hand back. Our checks refuse vague or contradictory tasks.</p></li>
    <li><h3>Claimed</h3><p>A volunteer's AI asks for work. It gets one task its monthly limit allows. Only one volunteer can hold a task at a time.</p></li>
    <li><h3>Done or handed back</h3><p>The AI follows the instructions and runs the tests. If anything is unclear, it hands the task back with the reason.</p></li>
    <li><h3>Reviewed</h3><p>Our GitHub App opens a pull request in the organization's repository, credited to the volunteer. Their tests run on it.</p></li>
    <li><h3>Merged or returned</h3><p>Merged means done: it shows on the project page and the volunteer's page. Closed means the task goes back to the pool.</p></li>
  </ol>
</div></section>
<section class="wrap section">
  <h2>What keeps it safe</h2>
  <ul class="plain">
    <li>Organizations are checked before their tasks go live.</li>
    <li>Every task is scanned for text that tries to trick a volunteer's AI. Flagged tasks wait for a person.</li>
    <li>Volunteers never share passwords or API keys. Their AI works in their own app, on their own plan.</li>
    <li>Changes can never touch a project's automation settings, and only the organization can merge.</li>
    <li>Unreviewed work is never shown publicly.</li>
  </ul>
  <h2>What's ready and what isn't</h2>
  <ul class="plain">
    <li><strong>Ready:</strong> volunteering from Claude Code, Gemini CLI and Codex; the GitHub App; public project and volunteer pages.</li>
    <li><strong>Next:</strong> volunteering from chat apps like claude.ai, ChatGPT and the Gemini app, with tasks for writing and research.</li>
    <li><strong>Later:</strong> money donations, once there's a legal home for them.</li>
  </ul>
</section>`,
  )
}

// ---------- projects and volunteers ----------

export function projectsPage(board: PublicBoard): Response {
  const rows = board.projects
    .map((p) => {
      const done = p.tasks.filter((t) => t.state === 'done').length
      const open = p.tasks.filter((t) => t.state === 'open').length
      return `<li class="project"><h2><a href="/projects/${esc(slugify(p.name))}">${esc(p.name)}</a></h2>
<p>${p.nonprofit ? 'Nonprofit' : 'Public-good project'}. ${done} of ${p.tasks.length} tasks done, ${open} open.</p></li>`
    })
    .join('')
  return page(
    { title: `Supported projects | ${SITE.name}`, description: 'Every organization in the volunteer pool, with its open and finished tasks.', path: '/projects', section: 'projects' },
    `<div class="wrap page-head"><h1>Supported projects</h1><p class="lead">Every organization taking part, with every task and its status. Finished tasks link to the change that was merged.</p></div>
<section class="wrap section">${rows ? `<ul class="projects">${rows}</ul>` : '<p>No projects yet. <a href="/organizations">Apply for yours.</a></p>'}</section>`,
  )
}

export function projectPage(project: PublicProject): Response {
  const groups: [string, string[]][] = [
    ['Open', ['open']],
    ['In progress', ['claimed', 'running', 'review']],
    ['Waiting on another task', ['blocked', 'too-big', 'safety review']],
    ['Done', ['done']],
  ]
  const sections = groups
    .map(([label, states]) => {
      const tasks = project.tasks.filter((t) => states.includes(t.state))
      return tasks.length ? `<h2>${label}</h2><ul class="tasks tasks-wide">${tasks.map((t) => taskRow(t, project, false)).join('')}</ul>` : ''
    })
    .join('')
  const links = [
    project.github ? `<a href="${esc(project.github)}" rel="noopener">Repository on GitHub</a>` : '',
    project.orgUrl && !project.orgUrl.includes('example.org') ? `<a href="${esc(project.orgUrl)}" rel="noopener">Organization website</a>` : '',
  ].filter(Boolean)
  return page(
    {
      title: `${project.name} | ${SITE.name}`,
      description: `Volunteer tasks for ${project.name}: what's open, what's in progress and what's done.`,
      path: `/projects/${slugify(project.name)}`,
      section: 'projects',
    },
    `<div class="wrap page-head"><p class="crumb"><a href="/projects">Projects</a></p><h1>${esc(project.name)}</h1>
<p class="lead">${project.nonprofit ? 'A nonprofit project.' : 'A public-good project.'} ${links.join(' ')}</p></div>
<section class="wrap section">${sections || '<p>No tasks yet.</p>'}</section>`,
  )
}

export function volunteersPage(board: PublicBoard): Response {
  const rows = [...board.donors]
    .sort((a, b) => b.tasksCompleted - a.tasksCompleted)
    .map((d) => `<li><a href="/volunteers/${esc(d.handle)}">${esc(d.handle)}</a>: ${d.tasksCompleted} ${d.tasksCompleted === 1 ? 'task' : 'tasks'} for ${d.projectsHelped.map(esc).join(', ')}</li>`)
    .join('')
  return page(
    { title: `Volunteers | ${SITE.name}`, description: 'Everyone who has finished a task, by nickname.', path: '/volunteers' },
    `<div class="wrap page-head"><h1>Volunteers</h1><p class="lead">Everyone with merged work, by the nickname they chose.</p></div>
<section class="wrap section">${rows ? `<ul class="plain">${rows}</ul>` : '<p>No finished tasks yet.</p>'}<p><a class="button" href="/volunteer#start">Become one</a></p></section>`,
  )
}

export function volunteerImpactPage(board: PublicBoard, handle: string, registered = false): Response | null {
  const done = board.projects.flatMap((p) => p.tasks.filter((t) => t.donorHandle === handle).map((t) => ({ t, p })))
  const donor = board.donors.find((d) => d.handle === handle)
  if (!donor && done.length === 0) {
    if (!registered) return null
    return page(
      { title: `${handle}, volunteer | ${SITE.name}`, description: `${handle} is a volunteer in the pool.`, path: `/volunteers/${handle}`, noindex: true },
      `<div class="wrap page-head narrow"><p class="crumb"><a href="/volunteers">Volunteers</a></p><h1>${esc(handle)}</h1>
<p class="lead">No finished tasks yet. Tasks appear here once the organization merges the work.</p>
<p>Ready? Start your AI tool in an empty folder and say <q>I'm ready for 1 small volunteer task.</q></p></div>`,
    )
  }
  const orgs = [...new Set(done.map((d) => d.p.name))]
  return page(
    { title: `${handle}, volunteer | ${SITE.name}`, description: `${handle} has finished ${done.length} volunteer tasks.`, path: `/volunteers/${handle}` },
    `<div class="wrap page-head"><p class="crumb"><a href="/volunteers">Volunteers</a></p><h1>${esc(handle)}</h1>
<p class="lead">${done.length} ${done.length === 1 ? 'task' : 'tasks'} finished for ${orgs.length} ${orgs.length === 1 ? 'organization' : 'organizations'}: ${orgs.map((o) => `<a href="/projects/${esc(slugify(o))}">${esc(o)}</a>`).join(', ')}.</p></div>
<section class="wrap section"><h2>Finished tasks</h2><ul class="tasks tasks-wide">${done.map(({ t, p }) => taskRow(t, p, true)).join('')}</ul></section>`,
  )
}

// ---------- about, faq, legal ----------

export function aboutPage(config: SiteConfig): Response {
  return page(
    { title: `Who runs this | ${SITE.name}`, description: 'Why Volunteer Pool exists, who runs it, and what we promise organizations and volunteers.', path: '/about', section: 'about' },
    `<div class="wrap page-head"><h1>Who runs this, and why</h1>
<p class="lead">Volunteer Pool was started by someone who spent fifteen years working in a nonprofit, organizing volunteers every day. In the real world, a volunteer doesn't get blamed for not knowing what to do: the organization gives clear tasks, clear limits and support. This project brings that model to digital work, where many people now have powerful AI tools and many nonprofits have work they can't afford.</p></div>
<section class="wrap section narrow">
  <h2>What we promise</h2>
  <ul class="plain">
    <li><strong>Free.</strong> No fees for organizations or volunteers.</li>
    <li><strong>Public.</strong> Every supported project and every finished task is listed, with links to the change.</li>
    <li><strong>Careful.</strong> We check every organization and help them write tasks that volunteers can do well.</li>
    <li><strong>Honest about status.</strong> This is a test phase. We say what works and what doesn't yet.</li>
  </ul>
  <h2>How it's run</h2>
  <p>The platform runs on Cloudflare. Projects live on GitHub. Decisions about money, and a legal home for donations, will be made openly before any money is accepted.</p>
  <h2>Contact</h2>
  <p>Write to us through ${contactLine(config)}.</p>
</section>`,
  )
}

export function faqPage(): Response {
  const qa: [string, string][] = [
    ['Do I need to know how to code?', "No. Your AI does the work by following the organization's instructions. You need to be able to install an AI coding tool and paste one command. Chat apps, which need no installing, are coming soon."],
    ['Do I need a GitHub account?', 'No. Your work reaches the organization through our GitHub App, credited to your nickname.'],
    ['Does this use up my AI plan?', 'A little. A small task usually takes a few minutes of your AI\'s time. You set a monthly limit, and your AI never takes more tasks than that.'],
    ['Is sharing my AI plan allowed?', "You don't share it. Your own AI app does the work on your own account, the normal way you use it. You never give anyone a password or an API key. Follow your AI provider's terms, as you always would."],
    ['What if the task is unclear?', 'Your AI hands it back with the reason, and the organization improves the task. Guessing is against the rules.'],
    ['Where can I see what I did?', 'On your volunteer page, /volunteers/your-nickname, once the organization merges your work.'],
    ['Can I give money instead?', "Soon. We need a legal home for donations first. Join the list on the volunteer page and we'll tell you when it opens."],
    ['Who can get help?', 'Registered nonprofits and open-source projects that serve the public good. We help organizations that aren\'t on GitHub yet.'],
  ]
  return page(
    { title: `Questions | ${SITE.name}`, description: 'Answers to common questions from volunteers and organizations.', path: '/faq', section: null },
    `<div class="wrap page-head"><h1>Questions</h1></div>
<section class="wrap section narrow"><dl class="faq">${qa.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}</dl></section>`,
  )
}

export function privacyPage(config: SiteConfig): Response {
  return page(
    { title: `Privacy | ${SITE.name}`, description: 'What we collect, why, where it is stored and how long we keep it.', path: '/privacy' },
    `<div class="wrap page-head"><h1>Privacy</h1><p>Last updated 24 November 2026.</p></div>
<section class="wrap section narrow prose">
<h2>What we collect</h2>
<ul>
<li><strong>Volunteers:</strong> the nickname you choose (public by design) and your monthly task limit. We store only a scrambled form of your connection key, never the key itself. We don't ask for your email or name.</li>
<li><strong>Organizations that apply:</strong> organization name, website, your name, email, country and what you need. Used only to review your application and reply.</li>
<li><strong>The waiting list:</strong> your email and what you want to hear about. Used once, to tell you it opened.</li>
<li><strong>Volunteer work:</strong> the summary and change your AI hands back. Kept private until the organization merges it, then public.</li>
<li><strong>Abuse protection:</strong> forms use Cloudflare Turnstile, and we keep a scrambled form of your network address for one day to limit repeated sign-ups.</li>
</ul>
<h2>Where it's stored</h2>
<p>In a Cloudflare D1 database operated for this project. Pull requests are stored on GitHub by the organization that owns the repository. We use no advertising or tracking cookies.</p>
<h2>How long we keep it</h2>
<p>Applications: until two years after we last worked with you, or until you ask us to delete them. Waiting list: until we've written to you. Volunteer records: as long as the public record of finished work exists.</p>
<h2>Your rights</h2>
<p>You can ask to see, correct or delete what we hold about you. Write to ${contactLine(config)}. We answer within 30 days.</p>
</section>`,
  )
}

export function termsPage(): Response {
  return page(
    { title: `Terms and volunteer rules | ${SITE.name}`, description: 'The rules for volunteers and organizations in the volunteer pool.', path: '/terms' },
    `<div class="wrap page-head"><h1>Terms and volunteer rules</h1><p>Last updated 24 November 2026. This is a free test service, provided as is.</p></div>
<section class="wrap section narrow prose">
<h2 id="volunteers">For volunteers</h2>
<ul>
<li>Use your own AI tool and plan, within your AI provider's terms. Don't share accounts, passwords or API keys, and don't run unattended scripts against a consumer chat plan.</li>
<li>Keep your connection key private. Anything done with it counts as yours.</li>
<li>Do only the task you claimed, within its limits. Hand back unclear tasks instead of guessing.</li>
<li>Your contribution is offered under the license of the project you work on.</li>
<li>Your AI runs the project's code on your computer to test it. Work in a separate folder. We check organizations, but we can't guarantee any project's code.</li>
<li>We may remove a volunteer who breaks these rules.</li>
</ul>
<h2 id="organizations">For organizations</h2>
<ul>
<li>You're responsible for the tasks you post and for everything you merge, as with any volunteer.</li>
<li>Tasks must be clear, safe and free of private data, passwords and access to live systems.</li>
<li>Our GitHub App only opens pull requests. Review each one before merging.</li>
<li>You agree that your project, tasks and finished work are listed publicly.</li>
<li>We may pause a project whose tasks are unsafe or which stops reviewing work.</li>
</ul>
</section>`,
  )
}

export function accessibilityPage(config: SiteConfig): Response {
  return page(
    { title: `Accessibility | ${SITE.name}`, description: 'How this site is built to be accessible, and how to report a problem.', path: '/accessibility' },
    `<div class="wrap page-head"><h1>Accessibility</h1><p>Last updated 24 November 2026.</p></div>
<section class="wrap section narrow prose">
<p>We aim for WCAG 2.2 level AA. The site uses a typeface designed for readability, plain HTML that works without JavaScript, visible keyboard focus, labelled form fields, text colors that meet AA contrast, and no motion. Pages work at 360 pixels wide and when zoomed to 200%.</p>
<p>Known limits: the anti-spam check on forms is provided by Cloudflare. Connecting an AI tool needs a terminal, which we know is a barrier. Chat-app volunteering will remove it.</p>
<p>Found a problem? Tell us through ${contactLine(config)} and we'll fix it.</p>
</section>`,
  )
}

export function notFoundPage(): Response {
  return page(
    { title: `Page not found | ${SITE.name}`, description: 'This page does not exist.', path: '/404', noindex: true },
    `<div class="wrap page-head narrow"><h1>There's no page here.</h1><p class="lead">It may have moved. Try the <a href="/">home page</a>, <a href="/volunteer">volunteering</a> or <a href="/projects">projects</a>.</p></div>`,
    404,
  )
}
