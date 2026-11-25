---
title: Onboarding playbook
description: How onboarding volunteers set a nonprofit up with Volunteer Pool, step by step, so the organization needs no IT staff.
---

# Onboarding playbook

Most nonprofits have work they want done and nobody to set it up. **You are that person.** As an onboarding volunteer you guide one organization from "we have an idea" to "our first volunteer change is live". It takes about three hours, spread over two to four weeks.

You're vetted by us, you speak for Volunteer Pool, and you never need the organization's passwords.

## Your promises

- **The organization stays the owner.** Everything is created in their name, with at least two of their people as owners. You get only the access you need, and you give it back when you're done.
- **You never ask for passwords.** They sign in themselves; you guide them on a call or share your screen.
- **Contact details stay private.** Use them only for this organization.
- **You don't promise what we can't do.** Small tasks, reviewed by them, no live systems, no personal data.
- **You hand over.** By the end, someone at the organization can review and merge on their own, or has a volunteer reviewer.

## The steps

### 1. Take an organization (5 minutes)
On your [account page](/account), under "Help organizations get started", choose an organization we've already vetted. Their contact details appear once you take it.

### 2. First call (30 minutes)
Use plain words and no jargon. Cover:
- **What they want changed.** Find two or three small things: a page that breaks on phones, an outdated guide, a translation. Use the [task menu](/handbook/task-menu) as a conversation starter.
- **Who will say yes or no** to changes, and who can spare 15 minutes a week to look at them.
- **How it works:** volunteers' AI or volunteers themselves make the change; they see it, and nothing changes until they say yes. Share [Safety and quality](/handbook/safety-and-quality) if they want details.
- **Where their files live today:** a website builder, WordPress, Google Docs, nothing yet.

If it isn't a fit (private data, live systems, no one to review), say so kindly and choose "Not a fit" with a note.

### 3. GitHub (45 minutes, together)
Follow [What is GitHub?](/handbook/what-is-github), steps 1 to 6, on a call:
- they create the organization account and are its owners; you're invited as a member only if needed;
- apply for GitHub for Nonprofits (free Team plan);
- create the repository and move the files in with them (website files, guides as Markdown);
- turn on two-factor sign-in.

### 4. Safety settings (15 minutes)
Walk through [Secure your repository](/handbook/secure-your-repository). At least: the branch ruleset, CODEOWNERS with their reviewer, secret scanning and push protection. Their account page then shows the checklist ticked.

### 5. Install our app and add the files (15 minutes)
- Show them [what our GitHub App can and can't do](/handbook/our-github-app) before installing. They install it on **this repository only**.
- Add `volunteer-compute.yaml`, `AGENTS.md` and the volunteer task issue form from the [templates](/handbook/templates). Fill in `AGENTS.md` with them: how the project works, what never to touch.
- If they publish a website from the repository, turn on preview links and add `preview`.

### 6. First three tasks (30 minutes)
Write them **in their words**, as GitHub issues with the volunteer task form. Check each against the [work package checklist](/handbook/work-packages). They add the `volunteer-ready` label themselves, so they know how publishing works.

### 7. First reviews (two to four weeks)
When the first pull requests arrive, review them **with** them, using the checklist in each description. Show them three things: merging, requesting changes, and closing with feedback. If they have no one who reads code, set `volunteerReviewers: true` and tell them advice will come.

### 8. Hand over
When they've merged a change on their own, choose "They're live" on your account page. Leave them:
- the link to their account page;
- the [organization handbook](/handbook/organizations);
- how to reach us.

Remove any access you were given.

## When things go wrong

- **They go quiet.** Two friendly reminders a week apart, then hand back with a note.
- **They want something we can't do** (private data, payments, a big rebuild): explain the limits, and suggest splitting it or another route.
- **You can't continue.** Choose "Hand back" with a note. Someone else will pick it up.
- **Anything feels unsafe:** stop and write to us.
