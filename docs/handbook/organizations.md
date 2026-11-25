---
title: Handbook for organizations
description: How to prepare your organization, write work volunteers can do, review results, and stay in charge.
---

# Handbook for organizations

Volunteer Pool brings you volunteers' AI help, and increasingly programmers' own time, for small digital tasks. It works the way your best volunteer program does: clear tasks, clear limits, someone who checks the work. You stay in charge. Nothing changes in your project until a person on your side merges it.

## Before you start: is this a fit?

**Good fits:** fixing a bug on your website or app, documentation and guides, translations, accessibility fixes, small features, scripts that clean up data, research notes.

**Not a fit:** anything that needs private data, passwords, access to live systems or payments, and big redesigns that can't be split into small steps.

**You need someone who can look at a change and judge it.** It doesn't have to be a developer for writing tasks. For code, someone who can read it, or a trusted volunteer developer. If you have nobody, tell us when you apply; we help at the start.

## Getting set up (about an hour, done with you)

You don't have to do this alone. Once we've vetted you, an **onboarding volunteer** takes you through every step on a call, following our [onboarding playbook](/handbook/onboarding-playbook).

1. **Apply** on the [organizations page](/organizations). We check you're a nonprofit or a public-good open-source project.
2. **Get onto GitHub**, if you aren't yet. Read [What is GitHub?](/handbook/what-is-github). Verified nonprofits can get GitHub's paid plan free.
3. **Secure your repository**: [five settings, five minutes](/handbook/secure-your-repository). We check them with you; your account page shows which are on.
4. **Add two files** to your repository: `volunteer-compute.yaml` (project settings, and tasks if you like) and `AGENTS.md` (the rules for volunteers' AIs). Add the **volunteer task issue form** too, so staff can write tasks on GitHub without touching YAML. Start from our [templates](/handbook/templates).
5. **Install our GitHub App** on that repository. It reads the files and opens pull requests. It can't merge, and it refuses any change to your automation settings.
6. **Write your first three tasks** with us. Pick from the [task menu](/handbook/task-menu), or follow the [work package checklist](/handbook/work-packages).

## Two ways to post work

- **As GitHub issues (easiest).** Open a new issue with the **Volunteer task** form: goal, files, steps, acceptance criteria. When it's ready, a maintainer adds the label `volunteer-ready`. Only that label, added by someone who can merge, publishes it, so issues from strangers never reach volunteers. Closing the issue, or removing the label, takes the task off the board. Merging the volunteer's pull request closes the issue.
- **In `volunteer-compute.yaml`.** The same fields as a list in a file, useful for many tasks at once.

Both appear within 15 minutes. If an issue is missing something, your account page says what.

## Writing work: the short version

Each task is one small, checkable change. It names the goal, the exact files, the steps, how you'll know it's right (acceptance criteria), the command that checks it, and what not to touch. Our server refuses tasks that are vague, contradict themselves or name no files. The full checklist is in [Writing a good work package](/handbook/work-packages).

Changes to your task list take effect within 15 minutes. Tasks in progress keep the brief the volunteer started with, and the pull request shows which one, with its fingerprint.

## Reviewing: your part of the deal

Every result arrives as a pull request with the same sections: goal, the volunteer's plan, the files changed against the files allowed, evidence per acceptance criterion, check results, warning signs, the review checklist, and the exact brief.

For each one:

1. **Read the plan, then the change.** Does the change do what the plan says, and only that?
2. **Look at the evidence and your checks.** Your required checks must pass. Passing tests alone aren't proof; read the diff.
3. **Look at the warning signs.** Anything listed (new network calls, code that runs commands, install scripts, long encoded strings) needs a careful look.
4. **Decide:**
   - **Merge** if it's right. The task is done and credited.
   - **Request changes** with what's missing. The same volunteer gets three days to revise the **same pull request**; after that, any volunteer can continue it. You get a comment when the revision arrives.
   - **Close** if the approach is wrong. The task goes back to the pool, and the next volunteer sees your feedback.
   - **Label it `spam` or `invalid` and close** for junk. It counts heavily against the volunteer: one means small tasks only, two means paused.

Only reviews from people with write access to your repository count as decisions.

**Please review within a week.** We remind you on the pull request after 7 days and again after 21. While five or more changes wait for your review, no new work starts on your project. That protects volunteers' time.

## See the change before you merge

For websites, the best review is to look at the changed page. Many hosts make a **preview link for every branch or pull request** for free: Cloudflare Pages, Netlify and others. Turn it on, then add the pattern to your task list, and every volunteer pull request carries a "See it running" link:

```yaml
project:
  preview: https://{branch}.your-site.pages.dev          # Cloudflare Pages
  # preview: https://deploy-preview-{pr}--your-site.netlify.app   # Netlify
```

Previews build from the pull request's code, so keep secrets out of preview builds (see [Secure your repository](/handbook/secure-your-repository)).

## No developer? Get a volunteer reviewer

Experienced developers volunteer as reviewers. They read volunteer pull requests and leave a review with advice. You still decide and merge. To welcome them, add this to your task list:

```yaml
project:
  volunteerReviewers: true
```

Their advice shows on your account page and in the pull request. It never merges or changes anything by itself.

## What we do for you

- Check every brief before volunteers see it, and scan it for instructions that try to misuse an AI.
- Make every volunteer's AI state a plan first, stay inside the allowed files and hand in with evidence.
- Refuse changes with hidden text or secrets, and flag other warning signs.
- Run your checks on our test machine before the pull request opens, where the task has them.
- Pause a task that's handed back three times, so you can improve the brief.
- Slow down volunteers whose work is often turned down.
- Keep the public record, and your dashboard with the safety settings, signals and reviews for each project.

## What stays yours

Your project, your code, your decisions. You own the results under your license. You can pause, change or remove any task, or leave, at any time. Write to us and we stop listing you.
