# Roadmap and honest assessment

Last reviewed: 24 November 2026.

## Where it stands

| Piece | Status |
|---|---|
| Broker code on GitHub (`main`) | Done. 53 tests pass, 4 live-provider checks skipped. |
| Worker live at `volunteer.apishelf.dev` | Live, but still the Cursor build from 07:51. The fixes below deploy once `CLOUDFLARE_API_TOKEN` is set as a GitHub secret. |
| D1 database `volunteer-broker` | Live. Migrations 0001–0003 applied. harbor-pantry registered with 5 tasks. 3 test donors. |
| Test project `volunteer-compute-test` | Seed PR #1 open, CI green, now includes `volunteer-apply.yml`. |
| Live MCP test from a real AI app | **Not done yet.** Nothing has been claimed, submitted and accepted. |

## Fixed in this review

1. **Unreviewed work was public.** `/public.json` and `/public/tasks/<id>/patch` showed a volunteer's PR link and diff before anyone accepted it, so a volunteer could put any link or content on the public page. Now only accepted work is shown.
2. **Claims could race.** The Durable Object comment said requests run one at a time, but D1 calls are outside I/O, so two requests could interleave. Requests are now queued.
3. **10-minute claims were too short for chat-speed volunteers.** Work submitted after the lease ran out was refused. Volunteer claims now last 45, 90 or 180 minutes by task size, and the new `keep_working` tool extends them.
4. **Volunteer PRs would never run CI.** GitHub does not start `pull_request` workflows for PRs opened with `GITHUB_TOKEN`. The apply workflow now runs the project's tests before opening the PR, refuses any patch that touches `.github/`, and dispatches the test workflow on the branch.
5. **Maintainers had no way to read submissions** once they were hidden from the public page. `GET /admin/tasks` now includes summary, link and diff.
6. **The API-key route is marked local-only** (see "What is allowed").
7. Added `.github/workflows/deploy.yml`: every push to `main` is tested, then deployed to Cloudflare.

## What is allowed

- **Volunteer uses their own AI app over MCP: fine.** That is normal personal use of their own plan, and no credentials change hands. This is the route to build on.
- **Donor hands an API key to the broker: not fine.** OpenAI's business terms forbid buying, selling or transferring API keys with a third party; OpenAI staff have said bring-your-own-key sharing is not permitted. Anthropic's terms say you may not share your API key with anyone. The hosted broker is MCP-only; keep it that way unless a provider gives written permission.
- **Automated loops on a consumer plan:** Anthropic's consumer terms forbid automated access except through an API key or where explicitly permitted. A volunteer running Claude Code by hand is fine; a script that drives a chat subscription unattended is not. Say this in the volunteer guide.
- **GitHub:** maintainers can now cap open PRs from users without write access, and agent-opened PRs count toward the cap. Our design (the project's own Action opens the PR, after a maintainer accepted the diff) stays inside that, and only opted-in projects get PRs.
- Still to check before launch: Google (Gemini) and xAI (Grok) terms, and GDPR for donor emails.

## Honest view of the competition

This is not an empty field. Similar projects started in 2026:

| Project | What it does | How we differ |
|---|---|---|
| [ComputeForGood](https://github.com/kiselas/compute_for_good) | MCP server for any coding agent, project applications, maintainer workspace, independent review tied to the commit, MIT. A limited pilot with one real merged contribution. | Closest match. Ours adds budget-sized matching, dependency order, a public impact record and no GitHub account for volunteers. Their review model is stronger than ours. |
| [Good First Token](https://goodfirsttoken.org/) | Agents claim issues maintainers tagged for outside help, follow the project's rules, optional review before a PR opens. Open source. | Uses GitHub issues directly; no vetting of nonprofits. |
| gitranks Contribute | Own agent over MCP, or their managed Claude agent on your API key with caps. | Commercial angle; no nonprofit focus. |
| Open Task Relay | Public repository of small public-good tasks for agents. | Task list, not a coordinator. |
| [Tokens for Good](https://tokensforgood.ai/) | Agents research nonprofits through a remote MCP. Most traction in the earlier scan. | Research, not code. |
| [GitHub nonprofit Project Pods](https://docs.github.com/en/nonprofit/project-pods/frequently-asked-questions), For Good First Issue | Human volunteer teams and a curated list of digital public goods. | Human-only; a good source of vetted projects. |

**Where we can stand out:** the volunteer-organization layer. Vetted nonprofits, a strict task standard, a coordinator that sizes and orders the work, one public impact record, and donors who need no GitHub account and no coding skills.

**The real risks:**
- Supply of good tasks and maintainers who review quickly, not technology. Several look-alikes look dormant.
- Chat-only volunteers (claude.ai, the Gemini app) cannot clone a repo or run tests. They write diffs blind. Either give them non-code tasks (docs, research, triage, translations) or route code tasks only to volunteers with a coding agent.
- A coding agent that runs a project's tests runs that project's code on the volunteer's computer. Vetting projects protects volunteers too. Tell them, and recommend a sandbox.
- One person (the broker admin) accepts all work today. That does not scale and makes us the bottleneck.

Recommendation: talk to ComputeForGood and Good First Token before building much more. Cooperating (shared task format, shared project vetting) may get further than competing.

## Next steps

### Now: finish the test
1. Add `CLOUDFLARE_API_TOKEN` as a GitHub Actions secret in `volunteer-compute-broker` (environment `production`), then re-run "Test and deploy". Use the token you already made, or a new one from the "Edit Cloudflare Workers" template plus D1 Edit.
2. Merge PR #1 in `volunteer-compute-test`, then tick Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests".
3. Make `volunteer-compute-test` public, or volunteers' agents cannot read the code. It is a fictional food bank.
4. Connect Claude Code with the `VBK_CLAUDE` token and do one small task end to end: claim, submit a diff, accept with the admin API, run "Open a volunteer pull request", see CI, merge, see it on the public page.
5. Repeat with Gemini CLI, then Grok. Note where each app struggles.
6. Create a second test project from `templates/project-starter` and check work is never assigned twice across both.

### Before inviting a real organization
- ~~Let maintainers accept work themselves~~ Done: the GitHub App opens a PR per submission; merge = accept, close = back to the pool.
- Self-serve volunteer sign-up (email or passkey), token revocation, per-token rate limits.
- Volunteer guide with the safety and terms points above, and "chat apps: non-code tasks only".
- Show the join and connect guides on the public site, and remove the `example.org` placeholder.
- Fix the remaining known gaps: real cost tracking, master-key rotation, D1 backups (Time Travel export), error monitoring.

### Before public launch
- Own domain, privacy policy and terms (the organization is responsible for the work it asks for).
- Project application with proof of repo ownership and nonprofit or public-good status, then human review.
- Check Google and xAI terms; get a written answer from the AI companies before any "share my compute" toggle.
- Money donations: Open Collective, or an amuta (two founders) to avoid the host fee.
- OAuth sign-in for claude.ai and other browser apps.
