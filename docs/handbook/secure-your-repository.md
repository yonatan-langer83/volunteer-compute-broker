---
title: Secure your repository in 5 minutes
description: The GitHub settings that turn review into an enforced gate before volunteer work can change your project.
---

# Secure your repository in 5 minutes

Volunteers' changes only ever arrive as pull requests, and our server checks them before you see them. These GitHub settings make your own review an **enforced gate**, not a good intention. They protect you from mistakes by anyone: volunteers, staff, or a tool gone wrong. Your account page shows which of the first three are on.

## The controls, and what each one does

| GitHub setting | What it enforces | Why it matters with volunteers' AI |
|---|---|---|
| **Pull requests required** | Every change is proposed first, never written straight into your project. | You see every change before it counts. |
| **Required reviews** | A person must approve before merging. | Someone on your side is always accountable. |
| **Required status checks** | Your tests must pass before merging. | Evidence becomes a rule, not a hope. |
| **CODEOWNERS** | Changes to chosen folders automatically ask chosen people to review. | The right expert sees high-risk changes, such as your website's payment page. |
| **Rulesets / branch protection** | One place that holds these rules for your main branch. | Nobody can skip them by accident, including admins. |
| **Environments** | Deployments and secrets wait for a named person's approval. | Code from a pull request can't reach your passwords or publish live without a human. |
| **Secret scanning and push protection** | Passwords and keys are detected, and blocked before they're saved. | A pasted key never reaches your history. |
| **Code scanning and Dependabot alerts** | Known security problems in code and libraries are flagged. | Risky changes get a second, automatic look. |

## Do these five (about five minutes)

### 1. Protect your main branch

*Settings → Rules → Rulesets → New branch ruleset.* Target your default branch (usually `main`) and turn on:

- **Require a pull request before merging**, with **1 required approval**;
- **Require status checks to pass**, and choose your test check (run it once first so it appears);
- **Block force pushes**, and **Restrict deletions**.

Leave the bypass list empty.

### 2. Add a CODEOWNERS file

Create `.github/CODEOWNERS` from our [template](/handbook/templates). At minimum, make yourself the owner of `.github/` (your automation) and of anything that publishes or handles money or personal data. Then turn on **Require review from Code Owners** in the ruleset.

### 3. Keep secrets away from pull requests

Pull requests run your tests with the volunteer's code, so treat that code as untrusted until reviewed.

- Your test workflow should need **no secrets** and set `permissions: contents: read` ([template](/handbook/templates)).
- Put deployments and anything with a secret in an **environment** with **required reviewers** (*Settings → Environments*), and only for the main branch.
- Never use `pull_request_target` to run pull-request code.

### 4. Turn on security alerts

*Settings → Code security*: turn on **Dependabot alerts**, **Secret scanning** and **Push protection**, and for code projects **Code scanning (default setup)**. These are free for public repositories.

### 5. Two-factor sign-in for everyone

*Organization settings → Authentication security → Require two-factor authentication.*

## What our side adds

Before a pull request reaches you, our server has already:

- made the volunteer's AI state a plan, and kept its edits to the files in your task;
- refused changes with hidden text or secrets, and listed other warning signs (new network calls, code that runs commands, install scripts, long encoded strings);
- run your checks on our test machine, where your task has them;
- written the review checklist into the pull request.

Our GitHub App can only create branches and open pull requests. It can't merge, can't change settings, and refuses changes to `.github/`.

## If something gets through

Close the pull request. If it was already merged, use GitHub's **Revert** button on the pull request, then tell us. We pause the task and look at the volunteer's record. See [What happens when…](/handbook/what-happens-when).
