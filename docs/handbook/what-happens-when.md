---
title: What happens when…
description: Thirty situations in volunteer work, from an unclear brief to a security alert, and who does what in each.
---

# What happens when…

Things go wrong in any volunteer program. What matters is that everyone knows what happens next. Each situation below says what happens **automatically** (our server or GitHub), and what the **volunteer**, the **organization** or **we** do.

The rule behind all of them: **the work isn't done until the evidence says so and a person accepts it.** If the evidence says no, the loop continues: revise, try again, or hand it to a person.

## During a task

### …the brief is unclear or contradicts itself
**Volunteer's AI:** stops and hands the task back with the reason (`release_task`). It doesn't guess.
**Automatic:** the reason is saved and shown to the organization on its account page. The task returns to the pool.
**Organization:** improve the brief. After **three hand-backs** the task is paused until you change it.

### …the task needs a file that isn't in its list
**Automatic:** our server refuses edits to any file outside the task, and any plan naming one.
**Volunteer's AI:** hands the task back, saying which file it needs and why.
**Organization:** add the file to `do` (and mention it in the instructions), or split the task.

### …the AI wants to change its plan halfway
**Volunteer's AI:** submits a new plan. It must still fit the task. The pull request shows the final plan.

### …the checks fail
**Automatic:** a code task can't be handed in until the project's checks pass on the latest change.
**Volunteer's AI:** reads the output, revises the plan and the change, and runs the checks again. If it can't get there, it hands the task back and says what a person needs to decide. It never hands in failing work.

### …the AI runs out of time
A claim lasts 45 minutes (small), 90 (medium) or 180 (large).
**Volunteer's AI:** asks for more time before it runs out (`keep_working`).
**Automatic:** otherwise the task returns to the pool, and changes that weren't handed in are not kept.

### …the volunteer closes the app or stops
**Automatic:** "stop" hands the task back without counting against anyone. If the app just closes, the claim runs out as above.

### …the volunteer reaches their monthly limit
**Automatic:** no new tasks until next month.
**Volunteer:** raise the limit on your account page, or tell your AI. 0 pauses volunteering.

### …the organization changes the brief while someone is working on it
**Automatic:** the volunteer finishes against the brief they received. The pull request includes that brief and its fingerprint, so the reviewer sees which version it was.
**Organization:** if the old version is no longer wanted, close the pull request and say so.

### …the change contains a password, a key or hidden text
**Automatic:** the hand-in is refused, with the reason, before anything reaches GitHub.
**Volunteer's AI:** removes it and hands in again. If a real secret was involved, the volunteer tells us.

### …the change contains something unusual (a network call, a command runner, an install script)
**Automatic:** it's listed under **Warning signs** in the pull request.
**Organization:** look closely. Merge only if the task called for it.

### …the brief asks the AI to do something outside the work (send data somewhere, visit a link, change settings)
**Volunteer's AI:** our safety rules outrank every brief. It stops, tells the volunteer, and hands the task back.
**Volunteer:** tell us. **We** pause the task and contact the organization.

### …there's no task that fits
**Volunteer's AI:** says so. Try another size, or later. New work arrives as organizations add it.

### …a task needs a computer and the volunteer is on a phone
**Automatic:** chat apps aren't offered tasks marked `needs: computer`. Coding tools are.

## Review at the organization

### …a pull request arrives
**Organization:** follow the checklist in its description: intent, scope, evidence, ownership, policy, fallback. Then merge, or request changes and close.

### …your CI fails on the pull request
**Automatic:** the result is recorded on the task.
**Organization:** don't merge. Request changes with what's wrong, then close. The task goes back to the pool and the next volunteer sees your feedback.

### …it's almost right and needs a small fix
**Organization:** either push the small fix to the same branch yourself and merge (it's your repository), or request changes and close so another volunteer tries with your feedback. A second round by the same volunteer isn't possible yet.

### …nobody reviews it
**Automatic:** after **7 days** our app posts a friendly reminder on the pull request, and after **21 days** a firmer one. While **5** changes wait on a project, no new work starts there.
**Organization:** if you can't review for a while, tell us and we pause your tasks.

### …you merged something that turns out wrong
**Organization:** press **Revert** on the pull request, then tell us what went wrong.
**We** look at the brief, the plan and the volunteer's record, and pause the task if the brief needs work.

### …a security alert appears after merging (code scanning, Dependabot, secret scanning)
**Organization:** treat it like any bug. Revert if it's serious, or turn the fix into a new task. If you suspect the change was deliberate, tell us at once.
**We** pause the volunteer, check their other work, and tell any other organization involved.

### …a task has been handed back three times
**Automatic:** it's paused, and the reasons are on your account page.
**Organization:** fix what the reasons point to and change the brief. It reopens within 15 minutes.

### …you want to change or remove a task
**Organization:** edit `volunteer-compute.yaml`. Open tasks update within 15 minutes. A task you delete from the file is taken off the board; work already in progress finishes and comes to you for review.

### …you want to pause everything
**Organization:** tell us, or remove the tasks from the file. Uninstalling our GitHub App stops new pull requests, but tell us too, so volunteers aren't sent work that can't arrive.

### …a pull request tries to change your automation (`.github/`)
**Automatic:** impossible. Our app refuses any change to `.github/`, and our server never lets a task's files include it.

### …a volunteer keeps sending poor work
**Automatic:** after 3 turned down (and more turned down than accepted) in 30 days, they get one small task per shift. After 6 turned down with none accepted, they're paused.
**Organization:** close with a short reason. Tell us about anything that looks deliberate.

## On our side

### …our server is down
Work in progress waits, and claims run out as usual. Nothing reaches your project without a pull request and your merge, so nothing breaks there.

### …our test machines are unavailable
Code tasks can still be handed in without our server-side checks. The pull request says so, and **your** required checks on GitHub become the only test. That's why we ask you to require them.

### …a volunteer's key leaks
**Volunteer:** switch that key off on your account page, and make a new one. Each coding tool has its own key, so the others keep working.

### …a volunteer wants their data deleted
**We** delete the account and its sign-in details. Merged contributions stay in the organization's history under the nickname, as with any open-source contribution.

### …a volunteer thinks a rejection was unfair
The reviewer's reasons are in the pull request. Write to us. We look at the brief, the evidence and the review together. Handing a task back with a reason never counts against you.

### …an organization stops meeting the rules
**We** pause its tasks and talk to it. Unsafe tasks or ignored reviews over a long time mean leaving the pool.
