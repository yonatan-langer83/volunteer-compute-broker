# Project brief: Volunteer Pool

Working name until a real name and domain are chosen. Live at `https://volunteer.apishelf.dev`.

## What it is

A volunteer center for digital work. Nonprofits post small, clearly described tasks in a GitHub repository. Volunteers connect the AI tool they already pay for and do one task at a time. The organization reviews each result as a pull request and merges it or closes it. Every finished task is listed publicly, with the volunteer's chosen nickname.

Positioning: for nonprofits that need software work done but cannot pay developers, Volunteer Pool is a volunteer center where people donate the AI they already have, unlike bounty sites or token-donation pools, because the organization stays in charge of what gets done and every result is reviewed and public.

## The three sides

### 1. The host (us)
- Runs the platform: the MCP server, the GitHub App, the public website. Free for organizations and volunteers.
- Vets organizations: reads each application, checks it is a nonprofit or public-good project, talks to them.
- Helps organizations start: sets up a GitHub organization and repository if they have none, writes the first tasks together with them, installs the app.
- Keeps everyone safe: task briefs are scanned for prompt injection, volunteer diffs may never touch `.github/`, only the organization can merge.
- Publishes everything: which projects are supported, which tasks were done, by whom (nickname), with links to the pull requests.

Owner to-dos: choose a name and domain, a contact address, a legal home (amuta or fiscal host) before money is accepted.

### 2. Organizations
Two ways in, one form:
- **Already on GitHub:** apply, get approved, add two files (`volunteer-compute.yaml`, `AGENTS.md`), install the GitHub App. Then merge or close pull requests as they arrive.
- **Not on GitHub yet:** apply and tick "we need help getting started". The host helps create a free GitHub organization (verified nonprofits can also get GitHub Team free through GitHub for Nonprofits), sets up a repository and writes the first tasks with them.

Good fits: website fixes, documentation, translations, small features, data clean-up scripts, accessibility fixes. Not a fit: anything needing private data, production access, passwords, or large redesigns.

### 3. Volunteers
| Way to help | Status | What they need |
|---|---|---|
| AI coding tool (Claude Code, Gemini CLI, Codex) | **Live** | A nickname on the website, then one command. No GitHub account. |
| Chat app (claude.ai, ChatGPT, Gemini app) | Coming soon, waitlist | Needs sign-in (OAuth) for MCP connectors and non-code tasks. |
| Donate money | Coming soon, waitlist | Needs a legal home for donations first. |

Every volunteer gets a public impact page (`/volunteers/<nickname>`): tasks finished, organizations helped, links to the merged pull requests.

## Decisions and tradeoffs
- **Sign-up is a nickname, not an account.** The connection key is shown once on screen and never stored in plain text. Lose it and you sign up again. Tradeoff: no recovery, no email needed. Turnstile plus a per-network daily limit stop bulk sign-ups; every result is still reviewed by the organization before it counts.
- **Nicknames are unique and public.** Emails never appear publicly.
- **Organization applications store contact details** (name, email) in Cloudflare D1. Used only to reply. Deleted on request.
- **No payments yet.** Collecting money needs a legal entity, receipts and tax checks. The money waitlist only records interest.
- **Chat apps later.** claude.ai and similar apps need OAuth on the MCP server; that is the next big build.
- **One language (English) for now.** Hebrew and others later, with prefixed URLs.

## Stack and data
- One Cloudflare Worker (`volunteer-compute-broker`) with one Durable Object for the broker and one D1 database (`volunteer-broker`). Static files from `public/` through Workers assets.
- Personal data: organization contact name and email, waitlist emails. Nicknames are public by design. Donor keys: hashed only.
- Secrets: `BROKER_MASTER_KEY`, `ADMIN_TOKEN`, `TURNSTILE_SECRET` in Cloudflare; GitHub App keys sealed in D1.
- Deploys: push to `main` → tests → D1 migrations → deploy (`.github/workflows/deploy.yml`). No staging yet (tradeoff accepted during the test phase; needed before real organizations onboard).
- Users at launch: a handful of test volunteers and one test project. At 12 months: tens of organizations, hundreds of volunteers. Far below D1 limits.
