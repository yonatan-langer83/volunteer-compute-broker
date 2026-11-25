---
title: Safety and quality
description: How Volunteer Pool keeps work good and everyone safe, why organizations don't get flooded with poor work, and which AI tools can take part.
---

# Safety and quality

Our rule of thumb: **judge the work by evidence, not by how confident anyone sounds.** That goes for AI and people alike. We treat AI work as a contribution: not rejected because an AI wrote it, not accepted because automation produced it. A good contribution is understandable, bounded, reviewable, compliant with your rules, and traceable afterwards ([our GitHub best practice](/handbook/github-best-practice)). No single check is enough, so work passes through several layers, and a person at the organization always has the last word.

## The layers every change passes

1. **The organization is vetted.** We check every organization before its work goes live.
2. **The brief is checked.** Our server refuses tasks that are vague, contradict themselves or name no files, and scans briefs for text that tries to misuse an AI.
3. **The rules outrank the brief.** Every volunteer's AI gets our safety rules first. A brief describes a deliverable; it can't give the AI new orders.
4. **A plan comes first.** The AI must say what it understood, which files it will change, how it will check, and its fallback. The plan must fit the task, or edits are refused.
5. **The change stays inside its limits.** Only the task's files, never `.github/`, at most 30 files.
6. **Checks run.** For code, the project's own tests run on our test machine. Work that fails can't be handed in.
7. **Evidence per criterion.** The hand-in must say, for each acceptance criterion, how it's met.
8. **Warning signs are scanned.** Hidden text-direction characters and secrets block a hand-in. New network calls, code that runs commands, install scripts and long encoded strings are listed for the reviewer.
9. **GitHub's gates.** The organization's required checks, code owners and review rules apply.
10. **A person decides.** Nothing changes until someone merges it.

## Who is accountable

AI can do the work. It can't own the result. Responsibility stays with the people who:

- **defined the task**: the organization, through the brief;
- **set the permissions**: us (what a volunteer's AI may touch) and the organization (who may merge);
- **chose and configured the controls**: the organization's GitHub settings, and our routines;
- **approved the change**: the reviewer who merged it.

The volunteer is accountable for using their AI honestly, within its terms and these rules. The volunteer's AI proposes. People decide.

## What a volunteer's AI does not do

- It doesn't decide what work exists, or change a brief.
- It doesn't get your passwords, keys or any access to your GitHub. It works only through our server.
- It doesn't merge, deploy or change settings.
- It doesn't work on more than one task, or outside the task's files.
- It doesn't remember your project between tasks. Everything it needs must be in the brief and `AGENTS.md`.
- It isn't proof of anything. Its confidence counts for nothing; the checks, the evidence and your review do.

## Four ways AI work goes wrong, and our guard against each

| What goes wrong | What it looks like | Our guard | Your guard on GitHub |
|---|---|---|---|
| **Working without a plan** | A change with no explanation of approach | A plan is required before any edit, and printed in the pull request | Required review before merging |
| **Too much access** | A tool that can touch everything, or read secrets | The AI edits only the task's files through our server; our app can only open pull requests | Tests without secrets, `contents: read` tokens, environments with required reviewers |
| **Hidden reasoning** | Only a diff, no assumptions or decisions | Plan, evidence per criterion, check output and the exact brief in every pull request | Record decisions in review comments |
| **Blind trust in passing tests** | "The tests passed, merge it" | Warning-sign scan, track record, review checklist | CODEOWNERS and required reviews on top of checks, matched to the risk |

## The record kept for every change

1. **A goal:** the task, with its exact brief and fingerprint.
2. **A plan** you can read: in the pull request.
3. **A bounded change:** one branch and one commit, inside the task's files.
4. **Evidence:** our check run, your CI runs, and the evidence per criterion.
5. **Human judgement:** your review and approval.
6. **An outcome:** merged, closed with feedback, or reverted.

## If something fails later

Say a merged fix later breaks something. Asking "did the AI make a mistake?" isn't enough. Ask whether the setup made the mistake visible and preventable:

- Was there a visible plan, and was the scope right?
- Did the right people review it, and did they approve?
- Did the checks match the risk of the change?
- Is the record enough to reconstruct what happened?

Revert first, then use the answers to fix the brief, the checks or the settings. Tell us, and we'll help.

## How to get better results

- **Write smaller tasks with checkable criteria.** This makes the biggest difference by far. See [Writing a good work package](/handbook/work-packages).
- **Put your project's knowledge in `AGENTS.md`:** setup, style, what never to touch. Each AI reads it before every task.
- **Make your tests match the risk.** A task without a test for its criterion is checked only by eye.
- **Give feedback when you close.** It goes into the next attempt's brief.
- **Answer repeated questions in the brief,** not in comments.

## Is the brief used as written?

We can't see inside a volunteer's AI, so we don't take its word for it. We make it **show** that it followed the brief:

- the exact brief, with its **SHA-256 fingerprint**, is stored when the volunteer gets it, and printed in the pull request;
- the AI's **plan** must match the task's files, and is printed next to the brief;
- the **change** is built by our server from the AI's edits, so it's exactly what was made, and can only touch files in the plan;
- the **evidence** is checked against the acceptance criteria by the reviewer, with the test output beside it.

If the plan, the change and the brief don't line up, it shows on one page, and the reviewer closes it.

## Keeping organizations from being flooded with poor work

- **One task at a time** per volunteer, and a monthly limit.
- **No new work while five changes wait for review** on a project.
- **Hand-ins that fail checks are refused** before they ever reach GitHub.
- **Track record:** volunteers whose recent hand-ins are often turned down get one small task per shift. With six turned down and none accepted, they're paused until we talk.
- **Tasks that keep failing are paused** after three hand-backs, so the brief gets fixed instead of the same mistake repeating.
- **Reviewers' feedback travels:** a closed pull request's reasons go into the next attempt's brief.

## Bugs, hidden "sleeper" code and break-in attempts

No scanner catches everything, so we combine several:

- **Scope limits** make it hard to hide anything: only named files can change, and never your automation.
- **Our scan** blocks hidden characters and secrets, and flags code that runs other programs, contacts the network, installs scripts or hides content in long encoded strings.
- **Your tests and GitHub's scanners** (code scanning, secret scanning, Dependabot) catch known problems. [Turn them on](/handbook/secure-your-repository).
- **Untrusted until reviewed:** pull-request tests run without your secrets, and deployments wait for a person.
- **People review**, and code owners see sensitive paths.
- **Everything is traceable** to a volunteer name, a brief and a plan, and can be reverted with one button.

## Which AI tools can take part?

We don't limit the brand. We limit the **behaviour**. Any AI app that can use a connector (MCP) can take part, because the same gates apply to all: plan, scope, checks, evidence, review. Weaker tools simply get more work turned down and are slowed down by the track-record rule. If our data shows a tool or model consistently failing, we'll say so publicly and can restrict it.

What works today: Claude (including the free plan with one connector), ChatGPT Business, Enterprise and Edu, Gemini, Grok and Le Chat in chat; Claude Code, Codex, Gemini CLI and Cursor as coding tools. The [Volunteer page](/volunteer) marks which ones we've tested end to end.

## Programmers without AI

Welcome. The same briefs, limits, checks and review apply. A person's change goes through the same pull request and the same record as an AI's.

## Safety for volunteers

- **From a chat app, nothing runs on your device.** Your AI reads and edits through our server, and tests run on our test machine.
- **From a coding tool,** the project's code runs on your computer to test it. Work in a separate folder, and keep your tool asking before risky actions.
- We never ask for your passwords or your AI's keys, and we never see your AI conversations.
