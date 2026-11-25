---
title: Working with GitHub and AI, our best practice
description: The rules we follow, and ask every organization and volunteer to follow, for AI-assisted work on GitHub. Based on GitHub's own documentation and Microsoft Learn's agentic AI and responsible AI courses.
---

# Working with GitHub and AI: our best practice

This is the standard we hold ourselves to, in Volunteer Pool's own code and in the open-source projects we contribute to, and it's what we ask of every organization and volunteer. It follows [GitHub's documentation](https://docs.github.com/en) and Microsoft Learn's courses on [agentic AI with GitHub](https://learn.microsoft.com/en-us/training/modules/foundations-agentic-ai) and [responsible AI with GitHub Copilot](https://learn.microsoft.com/en-us/training/modules/responsible-ai-with-github-copilot).

## Seven sentences to remember

1. **AI changes who does the work, not who owns the result.**
2. **Treat AI work as a contribution:** no extra suspicion because an AI wrote it, no extra trust because automation produced it.
3. **The pull request is where work is judged.** Every change, by a person or an AI, arrives as one.
4. **Evidence beats confidence.** Checks, tests and review decide; how sure anyone sounds doesn't.
5. **A rule that isn't switched on is a wish.** GitHub enforces what you configure, and nothing else.
6. **Small tasks make good work.** A clear goal, the files, and how to check it.
7. **Work isn't done until it passes.** If checks fail or requirements aren't met, the loop continues: revise, retry, or hand it to a person.

## Digital volunteering is volunteering

Volunteering has always meant giving time and skill to something bigger than yourself. Today much of a nonprofit's work is digital: its website, its forms, its data, its guides. Helping there is less physical, but it's no less volunteering. Open source has always worked this way: strangers improving shared tools, reviewed by the people responsible.

GitHub is already where this happens, but on its own it lacks what volunteering needs: a handbook with clear rules, work broken into small pieces, coordination so people don't collide, a way for people without GitHub to contribute, and help for organizations to get started. Volunteer Pool adds those layers, and lets GitHub do what it does best: keep the record and enforce the rules.

## What a good contribution looks like

Microsoft Learn's [contributor model](https://learn.microsoft.com/en-us/training/modules/foundations-agentic-ai/6-apply-contributor-model-agent-generated-work) names five qualities. This isn't a special standard for AI. It's the standard of healthy teamwork, applied to everyone.

| Quality | What it means | How we deliver it |
|---|---|---|
| **Understandable** | A clear goal and a visible plan | The brief states the goal; the volunteer's AI must state its plan before any change, and the plan is in the pull request. |
| **Bounded** | A scoped change and least privilege | Only the task's files can change, never `.github/`; the AI never gets access to your GitHub; our app can only open pull requests. |
| **Reviewable** | The right people involved, evidence present | Evidence for each acceptance criterion, check results, warning signs and a review checklist; your code owners are asked automatically. |
| **Policy-compliant** | Your rules respected | Your rulesets, required checks and environments apply to every volunteer pull request. |
| **Reconstructable** | A trail you can follow afterwards | The exact brief and its fingerprint, the plan, one commit, the checks, the review and the outcome, all on GitHub. |

## The loop: plan, act, evaluate

Microsoft Learn describes [agent work as a loop](https://learn.microsoft.com/en-us/training/modules/foundations-agentic-ai/3-explain-agent-lifecycle-plan-act-evaluate). We enforce each step:

- **Plan.** Scope (what will change), success criteria (how we'll know), and a fallback (what if it doesn't work). Plans are reviewable, not hidden.
- **Act.** On a branch, through a pull request, never directly on your main branch.
- **Evaluate.** With system signals: workflow runs and required checks, review verdicts, and security signals such as secret scanning, code scanning and Dependabot alerts.
- **Loop.** Failing checks or unmet criteria mean revise the plan, adjust the change, or hand it to a person. Never "ship it anyway".

## Must-haves for every repository

Switch these on before volunteer work starts. Each links to GitHub's guide. [Secure your repository](/handbook/secure-your-repository) walks through them in five minutes.

- [ ] **A ruleset on your main branch** ([about rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)): require a pull request, at least one approval, and passing status checks; block force pushes.
- [ ] **Required status checks** that actually test the work ([available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)). Give each check job a unique name.
- [ ] **CODEOWNERS** for sensitive paths, with "require review from code owners" on ([managing pull requests](https://docs.github.com/en/pull-requests/reference/managing-and-standardizing-pull-requests)).
- [ ] **Pull-request workflows without secrets**, with `permissions: contents: read`. Never run pull-request code under `pull_request_target` ([securely using pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target), [secure use](https://docs.github.com/en/actions/reference/security/secure-use)).
- [ ] **Environments with required reviewers** for anything that deploys or uses a secret. A job can't read environment secrets until a reviewer approves ([deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)).
- [ ] **Secret scanning and push protection.** Push protection isn't on by default, even for public repositories ([security settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-security-and-analysis-settings-for-your-repository), [push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection)).
- [ ] **Dependabot alerts and code scanning** (free for public repositories) ([GitHub security features](https://docs.github.com/en/code-security/getting-started/github-security-features)).
- [ ] **Two-factor sign-in** for everyone with write access.
- [ ] **`AGENTS.md` and `volunteer-compute.yaml`** from our [templates](/handbook/templates).

**Private repository?** Rulesets and protected branches on private repositories need a paid GitHub plan, and verified nonprofits get [GitHub Team free](https://docs.github.com/en/nonprofit/nonprofit-teams-plan/getting-started-with-the-github-team-plan-for-nonprofits). Public repositories get these features free.

## Good practice for a welcoming project

- A **README** that says what the project is for, and a **CONTRIBUTING.md** with setup, style and how to open a good pull request ([setting guidelines for contributors](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors)).
- A **code of conduct** you're willing to enforce ([adding a code of conduct](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/adding-a-code-of-conduct-to-your-project)).
- A **license**, so contributors know how their work is shared.
- A **pull request template** with the same record we use ([template](/handbook/templates)).
- **`good first issue`** labels for work new people can start with ([labels](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/encouraging-helpful-contributions-to-your-project-with-labels)).

## Writing tasks AI does well

GitHub's own advice for its coding agent is the same as ours: [clear, well-scoped tasks](https://docs.github.com/en/copilot/responsible-use-of-github-copilot-features/responsible-use-of-copilot-coding-agent-on-githubcom) get better results. Every task needs:

- a clear description of the problem or the work;
- complete acceptance criteria (should there be tests?);
- pointers to the files that need to change.

When pull requests are hard to review, GitHub suggests [splitting the task smaller](https://docs.github.com/en/copilot/tutorials/reduce-technical-debt). Our [work package checklist](/handbook/work-packages) builds on this.

## The same guardrails as GitHub's own agent

GitHub's coding agent [comes with built-in protections](https://learn.microsoft.com/en-us/training/modules/github-copilot-code-agent/2-security-risks-limitations-copilot-code-agent). Volunteer Pool follows the same pattern:

| GitHub Copilot cloud agent | Volunteer Pool |
|---|---|
| Pushes only to its own `copilot/` branches | Our app pushes only to its own `volunteer/` branches |
| Can't merge; your approval rules stay intact | Can't merge; your rules apply to every pull request |
| Hidden characters are filtered from its input | Briefs are scanned for injection; hidden characters in changes are blocked |
| Internet access is firewalled by default | The volunteer's AI reaches your project only through our server, read-only |
| No access to your Actions secrets | No access to your GitHub, your secrets or your settings |
| Workflows on its pull requests wait for "Approve and run workflows" | Workflows run as for your own branches, **so pull-request workflows must not use secrets** (must-have above) |

## Responsible AI, in practice

Microsoft and GitHub name [six principles of responsible AI](https://learn.microsoft.com/en-us/training/modules/responsible-ai-with-github-copilot/3-six-principles-of-responsible-ai). Here's how each shows up in our work:

- **Fairness:** every volunteer and every AI tool faces the same rules and gates; organizations are vetted by the same criteria.
- **Reliability and safety:** tests, required checks and a person's review before anything counts; failing work never reaches a merge.
- **Privacy and security:** no private data in tasks, no secrets in reach of volunteer work, scanning for leaks, least privilege everywhere.
- **Inclusiveness:** volunteering from a phone, with no coding knowledge, in plain language, on an accessible website.
- **Transparency:** the brief, the plan, the evidence and the decision are visible in every pull request, and finished work is public.
- **Accountability:** people stay accountable: organizations for what they merge, volunteers for how they use their AI, and us for the rules we enforce.

## GitHub Copilot and Volunteer Pool

- **Volunteers with GitHub Copilot** can use it as their coding tool. Add Volunteer Pool as an MCP server in Copilot in VS Code ([MCP in Copilot Chat](https://docs.github.com/copilot/customizing-copilot/using-model-context-protocol/extending-copilot-chat-with-mcp)) or the [Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers), with a key from your account page. Not tested by us yet.
- **Organizations with Copilot** can assign our work packages to their own Copilot cloud agent too. A good work package is exactly the well-scoped issue GitHub recommends. Review it the same way: as a contribution.

## How we work on our own projects

Volunteer Pool's own code, and our contributions to open-source projects such as ArtCraft, follow the same rules:

1. One goal per pull request, linked to its issue or task.
2. A plan in the description: scope, success criteria, fallback.
3. A bounded change on a branch, never directly on `main`.
4. Evidence: the exact commands run, their results, and what wasn't tested.
5. The maintainers decide. We don't merge our own work into anyone else's project, and we answer review feedback with revisions.

## Further reading

- [GitHub Docs](https://docs.github.com/en)
- [Microsoft Learn: Foundations of agentic AI with GitHub](https://learn.microsoft.com/en-us/training/modules/foundations-agentic-ai)
- [Microsoft Learn: Responsible AI with GitHub Copilot](https://learn.microsoft.com/en-us/training/modules/responsible-ai-with-github-copilot)
- [Microsoft Learn: GitHub Copilot learning path](https://learn.microsoft.com/en-us/training/paths/gh-copilot-2/)
- [GitHub for Nonprofits](https://docs.github.com/en/nonprofit)
- [Contributing to open source](https://docs.github.com/en/get-started/exploring-projects-on-github/contributing-to-open-source)
