---
title: What is GitHub?
description: GitHub in plain words for nonprofits, and how volunteers' AI work is proposed, checked and approved there.
---

# What is GitHub?

**GitHub is a shared home for your digital projects.** Your website, your app, your documents and guides all live there as files, with their full history. Other people can propose improvements, and nothing changes until someone you trust approves it. Once approved, the change can go straight into use, for example onto your live website.

Millions of projects use it, including most open-source software. It's free for public projects, and verified nonprofits can get the paid plan free through [GitHub for Nonprofits](https://nonprofits.github.com).

## The words you'll meet

| Word | What it means |
|---|---|
| **Repository** ("repo") | One project's folder: all its files and their history. |
| **Commit** | One saved change, with who made it and why. |
| **Branch** | A separate copy to work on without touching the real thing. |
| **Pull request** ("PR") | A proposed change, from a branch, that you can read line by line, discuss, and then **merge** (accept) or **close** (decline). |
| **Review** | Your verdict on a pull request: approve, or request changes with comments. |
| **Checks** | Automatic tests that run on every pull request and show green (pass) or red (fail). |
| **Issue** | A note about a problem or an idea: your to-do list. |

## Why we use it

Volunteer work needs a place where everything is visible and nothing happens behind your back. GitHub plays two roles for us.

**1. The record.** Everything about a piece of work is kept and can be looked up later:

- the task (in your task list) and its exact brief;
- the volunteer's plan and summary (in the pull request);
- the change itself, line by line (commits);
- the test results (checks and workflow runs);
- your decision and comments (reviews and the merge or close).

So you can always answer "who changed this, why, how was it checked, and who approved it?"

**2. The rulebook.** GitHub also enforces the rules you switch on, so they aren't just good intentions:

- changes must come as a pull request, never straight into your project;
- your checks must pass before anything can be merged;
- a person must approve, and the right person, for sensitive files;
- secrets and live deployments wait for a human approval.

We add our own rules before anything reaches you: a plan first, only the allowed files, evidence for each criterion, and a scan for warning signs. GitHub's rules then apply on your side. [Secure your repository](/handbook/secure-your-repository) shows the five settings.

## How a volunteer's AI works on GitHub

The volunteer's AI never gets access to your GitHub. It works through our server, and our GitHub App does the GitHub part:

1. The AI reads your project's files through our server (read-only).
2. It states a plan, then changes only the files the task allows, in a private workspace on our server.
3. Our test machine runs your checks on the change, where your task has them.
4. Our app creates a **new branch** in your repository and opens a **pull request** with the change and the full record. It never touches your main branch, never merges, and refuses any change to `.github/` (your automation).
5. GitHub then does its part. It shows the change, asks the right reviewers (CODEOWNERS), runs your required checks, blocks merging until your rules are met, and keeps secrets locked until someone approves.
6. **You decide.** Merge, and the change is in your project (and on your website, if you publish from GitHub). Close, and the task goes back to the pool with your feedback.

A real example: a volunteer's AI fixes a bug on your sign-up page. GitHub shows you the eight changed lines. Your tests run and turn green. Your web person, the code owner for `site/`, is asked to review. Merging is blocked until they approve. They approve and merge, and your website updates.

## Getting started

1. Create a free account at [github.com](https://github.com) for a person, then a free **organization** for your nonprofit. Use a shared admin email, not one person's.
2. Turn on two-factor sign-in for everyone with access.
3. Create a repository for the project, or we help you move an existing website or document collection in.
4. [Secure it](/handbook/secure-your-repository), add the [two files](/handbook/templates), and install our app.

We do this with you on a call when you join. It takes about an hour.
