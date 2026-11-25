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

## Getting set up (about an hour, with our help)

1. **Apply** on the [organizations page](/organizations). We check you're a nonprofit or a public-good open-source project.
2. **Get onto GitHub**, if you aren't yet. Read [What is GitHub?](/handbook/what-is-github). Verified nonprofits can get GitHub's paid plan free.
3. **Secure your repository**: [five settings, five minutes](/handbook/secure-your-repository). We check them with you; your account page shows which are on.
4. **Add two files** to your repository: `volunteer-compute.yaml` (the task list) and `AGENTS.md` (the rules for volunteers' AIs). Start from our [templates](/handbook/templates).
5. **Install our GitHub App** on that repository. It reads the files and opens pull requests. It can't merge, and it refuses any change to your automation settings.
6. **Write your first three tasks** with us, using the [work package checklist](/handbook/work-packages).

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
   - **Request changes and close**, with a sentence on what's missing. The task goes back to the pool and the next volunteer sees your feedback.
   - **Close without a word** only for obvious junk. Feedback improves the next attempt.

**Please review within a week.** We remind you on the pull request after 7 days and again after 21. While five or more changes wait for your review, no new work starts on your project. That protects volunteers' time.

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
