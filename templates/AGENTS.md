# Volunteering on <your project>

Thank you for helping. This file is read by every volunteer's AI before each task.
The task's brief says what to do; this file says how this project works.
Volunteer Pool's safety rules outrank both.

## About the project

<Two or three sentences: who uses it and what it is for.>

## Setup

<How to install and run the tests, for coding tools working on a computer. Chat apps
use Volunteer Pool's tools and need no setup.>

```bash
npm ci
npm test
```

## Style

- <Language and version, for example Node 22, TypeScript.>
- <Formatting and naming rules.>
- <Where tests live and how they are named.>
- Comments explain why, not what.

## Never

- Never change `.github/`, deployment files or anything with secrets.
- Never add a dependency unless the task says so.
- Never add tracking, analytics or network calls unless the task says so.
- Never put personal data, passwords or keys in code, tests or examples.

## When you're unsure

Hand the task back with the reason (`release_task`). A clear question helps us improve
the brief. Don't guess.
