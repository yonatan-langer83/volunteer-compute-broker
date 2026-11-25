---
title: Handbook for volunteers
description: What volunteering with your AI involves, your rules, how much of your plan it uses, and what happens to your work.
---

# Handbook for volunteers

Thank you for giving your time. You don't need to be a programmer. Your AI does the work, inside limits the organization and our server set, and people at the organization decide what to keep. Your part is to start a shift, keep an eye on it, and follow a few rules.

## What you need

- **An AI app you already use:** Claude, ChatGPT (Business, Enterprise or Edu), Gemini, Grok or Le Chat. It works on a phone or in a browser, with nothing to install. Or a **coding tool** on your computer: Claude Code, Codex, Gemini CLI or Cursor.
- **An account here:** sign in with GitHub or with an emailed link. Your public name is a nickname you choose, never your email.
- **A few minutes to watch your AI work.** You don't have to do anything, but stay around to answer if it asks.

Step-by-step connection instructions for each app are on the [Volunteer page](/volunteer).

## Starting a shift

Pick **Start a volunteer shift** from your AI app's menu, under the Volunteer Pool connector, or say:

> Use Volunteer Pool to give me 1 small volunteer task.

Naming Volunteer Pool tells your AI which connection to use. With only this connector, "I'm ready for a small volunteer task" usually works too. Then your AI:

1. asks the pool for a task that fits (small to start);
2. reads the organization's brief and the project's files;
3. **states its plan** before changing anything;
4. makes the change, only in the files the task allows;
5. runs the project's checks, for code tasks;
6. hands in, with evidence for each acceptance criterion.

It tells you briefly what it's doing at each step. A small task usually takes 10 to 30 minutes.

## How your AI knows what to do

When you add the Volunteer Pool connector, our server introduces itself to your AI at the start of every chat. It says what volunteering means here, how a task works, and what the AI may and may not do. That's how your AI understands "give me a volunteer task", the same way it understands a calendar connector.

Each task comes with everything needed, fetched live from our server:

- **the brief:** goal, files, steps, acceptance criteria, checks and limits;
- **the project's own rules**, from its `AGENTS.md` file;
- **our safety rules**, which outrank everything else;
- **the project's files**, read one at a time as needed.

## Nothing is stored with you

Your AI doesn't download or save the work package, and nothing goes into its memory. The brief and files are read from our server during the task. Your AI's changes are kept on our server, not on your phone or computer. When the chat ends, it forgets. The next task starts fresh with a new brief, so an old or altered copy can never be reused.

The one exception is coding tools on your computer, which work on their own copy of the project. They're bound by the same plan, file and evidence rules when they hand in.

## How much of your AI plan it uses

About as much as a normal working session of the same length. A small task is roughly one focused conversation. You decide the maximum number of tasks per month, and you can change it or pause any time: on your [account page](/account), or by telling your AI "change my Volunteer Pool limit to 3" (0 pauses).

## Your rules

1. **Use your own AI, on your own plan, within its terms.** Never share passwords, accounts or keys, and don't run automated scripts against a consumer chat plan.
2. **One task at a time, and only that task.** Your AI may change only the files the task allows. Our server enforces this.
3. **Don't guess.** If the brief is unclear or contradicts itself, your AI hands it back with the reason. That counts as helpful, not as failure: it helps the organization improve the brief.
4. **Hand in only work that passes.** If checks keep failing, revise or hand back. Never hand in work the checks reject.
5. **No secrets and no surprises.** No passwords, keys, tracking, hidden text, new network calls or new dependencies unless the task asks for them. Changes with hidden text or secrets are refused automatically.
6. **Stay polite in feedback loops.** Reviewers are often volunteers too.
7. **Your work is offered under the project's license**, like any open-source contribution.

## What happens to your work

- It becomes a **pull request** in the organization's repository: a proposed change their people review. It carries your plan, your evidence, the test results and the exact brief you received.
- **Merged:** the task counts as done and appears on your public page and the project page.
- **Changes requested:** you get the **first chance, for three days**, to revise it. Start a shift, and your AI sees the task with the reviewer's feedback and continues the same pull request. A change request never counts against you.
- **Closed without merging:** the task goes back to the pool with the reviewer's feedback, so the next attempt starts better informed. It counts against you only as a pattern (below).
- **Labelled spam:** organizations can label junk as spam. That weighs much more: one means small tasks only for a while, two means paused.
- **No reaction for 7 days:** we remind the organization. You don't need to chase anyone.

## Your record and your standing

We look at your last 30 days:

- **Normal:** any size, as many tasks per shift as you like within your monthly limit.
- **Small tasks only:** after 3 hand-ins turned down, and more turned down than accepted. You get one small task per shift until accepted work lifts it.
- **Paused:** after 6 turned down and none accepted. Write to us and we'll look at it together. Usually it's a setting or a tool that needs changing, not you.

Handing a task back with a clear reason never counts against you.

## Your impact page

Every volunteer with merged work gets a public impact page: tasks finished, organizations and causes helped, and a link to every change. Share it on your CV or with friends. Find it on your [account page](/account).

## Tasks that need a computer

Some tasks can only be done on your own computer: checking a desktop app's screen, special hardware, a Mac-only build. Organizations mark them `needs: computer`, and chat apps aren't offered them. Coding tools are.

## Prefer to code it yourself?

Programmers who'd rather work without AI are very welcome. The same tasks, briefs and review apply. Until you can take a task from the website, use a coding tool with a key from your account page, or tell us which project you'd like to help and we'll connect you.

## Your privacy

We keep your account email or GitHub name to sign you in, your nickname (public), your limit, and the record of your tasks. Your AI's conversation stays in your AI app. We never see it. Details are in the [privacy notice](/privacy).
