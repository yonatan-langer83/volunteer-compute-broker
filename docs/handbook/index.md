---
title: The Volunteer Pool handbook
description: How volunteers, their AI, organizations and Volunteer Pool work together, who decides what, and what happens when something goes wrong.
---

# The Volunteer Pool handbook

Volunteer Pool works like a volunteer bank for digital work. Volunteers deposit capacity: their AI's help, or their own skills. Organizations draw on it with small, clearly described pieces of work. We run the bank. We check every organization, help package the work, check every result before a person sees it, and keep a public record of everything done.

This handbook is the shared agreement. It's written the way a good nonprofit onboards new volunteers: people who mean well and need clear tasks, clear limits and someone to ask. Volunteers, organizations and the AI tools working for volunteers all read the same rules. Most rules here are also enforced by our server, so they're more than advice.

## Who does what

| Who | What they do | What they decide |
|---|---|---|
| **Volunteer** | Connects their AI app or coding tool, chooses how much to give, starts a shift, stays available for questions. | How many tasks a month (or pause). Which shift to start. When to stop. |
| **The volunteer's AI** | Claims one task, states its plan, makes the change, runs the checks, hands in with evidence. | Nothing beyond the task. If the brief is unclear, it hands the task back with the reason. |
| **Organization** | Writes the work packages, keeps its repository safe, reviews each pull request. | What work exists. What gets merged. Everything about its own project. |
| **Volunteer Pool (us)** | Vets organizations, checks every brief, enforces the plan and scope, scans each change, opens the pull request, keeps the record, runs the routines below. | Who may take part. Pausing a task, a volunteer or a project that breaks the rules. |
| **GitHub** | Holds the project, the proposed change, the checks and the review. | Nothing by itself: it enforces the rules the organization switches on. |

The short version: **AI changes who does the work, not who owns the result.** The organization stays accountable for what it merges, and the volunteer for how they use their AI. We treat AI work as a contribution, like anyone's: no extra suspicion, no extra trust.

**Digital volunteering is volunteering.** Less physical doesn't mean less giving. A fixed sign-up form or a translated guide helps a nonprofit as surely as an afternoon at the food bank.

## Every task follows the same loop

1. **Package.** The organization describes one small task: goal, files, steps, acceptance criteria, checks, what not to do. Our server refuses vague or contradictory briefs.
2. **Claim.** A volunteer's AI claims one task. Only one at a time.
3. **Plan.** Before changing anything, the AI states what it understood, which files it will change, its steps, how it will check, and what it will do if it doesn't work. Edits are refused until the plan is in.
4. **Change.** The AI edits only the files in its plan, inside the files the task allows.
5. **Check.** For code, the project's own tests run on our test machine. The AI compares the result with every acceptance criterion. If checks fail, it revises and tries again, or hands the task back.
6. **Hand in.** A summary, plus evidence for each acceptance criterion. Our server scans the change for warning signs and opens a pull request carrying the whole record.
7. **Review.** People at the organization look at it, with their own required checks. They merge it, or ask for changes and close it.
8. **Record.** Merged work is listed publicly with the volunteer's name. Closed work goes back to the pool with the reviewer's feedback, for the next attempt.

## The handbook

- [For volunteers](/handbook/volunteers): what to expect, your rules, and how much of your AI plan it uses.
- [For organizations](/handbook/organizations): how to prepare, review and stay in charge.
- [Writing a good work package](/handbook/work-packages): the checklist and a template.
- [What is GitHub?](/handbook/what-is-github): in plain words, for organizations new to it.
- [Secure your repository in 5 minutes](/handbook/secure-your-repository): the settings that make review an enforced gate.
- [Safety and quality](/handbook/safety-and-quality): how work is checked, how spam is kept out, which AI tools can take part.
- [Working with GitHub and AI](/handbook/github-best-practice): our best practice, the must-haves, and how it follows GitHub's own guidance.
- [What happens when…](/handbook/what-happens-when): 30 situations, and who does what in each.
- [Open source for nonprofits](/handbook/open-source): what it is, its limits, project ideas and good free tools.
- [Templates](/handbook/templates): ready-made files for your repository.
