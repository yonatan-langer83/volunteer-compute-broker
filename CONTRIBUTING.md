# Contributing to Volunteer Pool

Thank you for helping. This project follows the same standard it asks of everyone:
[Working with GitHub and AI](docs/handbook/github-best-practice.md).

In short:

1. **One goal per pull request**, linked to an issue.
2. **A plan in the description**: scope, success criteria, and a fallback.
3. **A bounded change** on a branch. Never push to `main`.
4. **Evidence**: `npm run typecheck` (or `npx tsc --noEmit -p .`), `npx vitest run`, and for
   website changes, screenshots at 360px and desktop. Say what you didn't test.
5. **After editing `docs/handbook/` or `templates/`**, run `npm run handbook` and commit the result.
6. **AI-assisted work is welcome** and reviewed like any contribution: no extra suspicion, no
   extra trust. You remain responsible for what you submit.

Never commit secrets (`.dev.vars` stays local). Security problems: see `/.well-known/security.txt`
on the live site instead of opening a public issue.
