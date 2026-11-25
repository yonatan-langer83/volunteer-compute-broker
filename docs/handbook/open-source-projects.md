---
title: For open-source maintainers
description: How public-good open-source projects can get structured volunteer help, including AI-assisted work, without being flooded, and what we ask in return.
---

# For open-source maintainers

**Not more AI pull requests. Fewer, better ones, only on the issues you approved.**

Maintainers are tired, and with reason: cheap, unasked-for AI pull requests take more time to review than they save. Volunteer Pool works the other way round. You decide what work exists, every change comes with a plan and evidence, and the number of open pull requests is capped. You review and merge as you always do.

## Who can join

- **Digital public goods (fast track).** Projects on the [Digital Public Goods Registry](https://www.digitalpublicgoods.net/registry) or GitHub's [For Good First Issue](https://forgoodfirstissue.github.com/) are already vetted against a public standard. Apply with your listing link and we skip most checks.
- **Other public-good open source.** Projects that serve nonprofits, communities or the public, with an open-source license and active maintainers who review pull requests. We look at your repository, recent activity and conduct.
- **Your project's rules come first.** If your contribution policy bans AI-generated code, we only offer your writing tasks, such as docs and translations, or volunteers who code by hand. If you need a contributor agreement (CLA or DCO), tell us before you join.

We never list a project without its maintainers' consent. Joining means applying and installing our app on the repositories you choose.

## How it answers the usual worries

| Worry | How Volunteer Pool handles it |
|---|---|
| Unasked-for pull requests | Volunteers work only on issues you label `volunteer-ready` or tasks in your task list. Nothing else. |
| Huge, unfocused changes | Each task names its files; edits elsewhere are refused; at most 30 files. |
| Descriptions that restate the diff | Every pull request has the goal, a plan written before the change, evidence for each acceptance criterion, check results and warning signs. |
| Nobody accountable | Every change is tied to a volunteer with a track record; repeated poor work slows them down or pauses them; `spam` labels count heavily. |
| Review overload | No new work while 5 changes wait on your project; reminders, not pressure; volunteer reviewers can advise. |
| Back-and-forth | Request changes and the same volunteer revises the same pull request. |
| Credit and community | Volunteers who use GitHub are co-authors on their commits; their work shows on their GitHub profile and a public impact page. |
| Security | Our app can only open pull requests on branches named `volunteer/…`, never merges, never touches `.github/`. See [what our app can do](/handbook/our-github-app). |

## Less duplicate work

On a busy project, three people translate the same file, two of them conflict with `main`, and the third misses strings. Volunteer Pool coordinates the work it brings you, without a coordinator:

- **You decide what comes to us.** Only issues you label `volunteer-ready` (added by someone who may merge) or tasks in your task list. Everything else stays yours.
- **One open change per file.** While a volunteer is working on a file, or their change waits for your review, no other volunteer is given a task that touches that file. The next one starts after you merge or close, from the current `main`.
- **Changes stay current.** When a volunteer pull request falls behind `main`, our app brings it up to date for you. If there's a real conflict, it says so once, and you either resolve it on GitHub or close it and the task goes back to the pool.
- **Translations stay complete.** Write "every key in `en.json` exists in `he.json`" as an acceptance criterion and a check, and the AI must show evidence for it.

What we can't do: coordinate people who work outside Volunteer Pool. GitHub's own tools help there: assign the issue, link the pull request to it (`Closes #12`), and use a check that fails on missing translation keys.

## Getting started

1. [Apply](/organizations#apply) with your repository and, if you have one, your public-good listing.
2. Install [our GitHub App](/handbook/our-github-app) on the repositories you choose.
3. Add the volunteer task issue form from the [templates](/handbook/templates), or a `volunteer-compute.yaml`.
4. Label three to five well-scoped issues `volunteer-ready`. Translation, documentation and test-coverage issues are good first choices.
5. Review the first pull requests, and tell us honestly what worked.

Start small: one repository, a handful of issues, a few weeks. If it doesn't save you time, uninstall the app and we stop.
