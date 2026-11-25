---
title: Writing a good work package
description: The checklist and template for tasks volunteers' AIs can do well, and that your reviewers can check quickly.
---

# Writing a good work package

A work package is one task: a GitHub issue made with the **Volunteer task** form, or an entry in your `volunteer-compute.yaml`. Need ideas? See the [task menu](/handbook/task-menu). Think of briefing a capable new volunteer on their first day. They want to help, they follow instructions exactly, and they don't know your organization. Tell them the outcome, show them where, set the limits, and say how you'll check it.

The same brief goes, word for word, to every volunteer's AI, and its fingerprint appears in the pull request. So a good brief is your strongest quality control.

## Inputs, outputs, success

Every task is a contract with three parts. An under-specified task gets a change that looks plausible and is wrong, so each part is required.

| Part | What it is | Where it goes |
|---|---|---|
| **Inputs** | The context the AI starts from: the goal and why, the files it may change, the steps, the limits | `goal`, `do`, `instructions`, `don't`, plus your `AGENTS.md` |
| **Outputs** | What comes back: a written plan before any edit, a pull request, and evidence for each acceptance criterion | `deliverable`; the plan and evidence are added by our server |
| **Success criteria** | How you decide, without trusting the AI's own confidence: the checks pass, the scans show no warnings, a person who may merge approves | `acceptance`, `tests`, your required checks and review rules |

**Plan first, then act.** By default the AI writes its plan, our server checks it against the allowed files, and the plan goes into the pull request with the change, so your reviewer reads the reasoning and the diff together. If you'd rather approve the plan *before* any change is written, for a risky area, say so in the brief ("Stop after the plan and wait for approval in the issue"). The AI then opens a pull request containing only its plan, and continues after you approve. It costs you an extra review step, so keep it for the few tasks that need it.

## The checklist

Every task needs:

- [ ] **One outcome.** A goal in one sentence: "The sign-up form works on phones 360 pixels wide." Not "improve the form".
- [ ] **Small.** Something a person could do in one sitting: one bug, one page, one translation file. Split anything bigger, and use `dependsOn` for the order.
- [ ] **Exact files** in `do`. Name every file the volunteer may change or create, and mention each one in the instructions. Our server refuses edits to any other file.
- [ ] **Steps** in `instructions`: what to change, in order. Point to the code or text that's involved.
- [ ] **Acceptance criteria** you can check: what must be true when it's done. The volunteer's AI must give evidence for each one.
- [ ] **Everyone can use it.** If people will see or use the change, say who must be able to: right-to-left languages (Hebrew, Arabic), keyboard and screen reader, a 360-pixel phone screen, slow connections. Put these in the acceptance criteria, not as an afterthought.
- [ ] **A check command** in `tests` for code tasks (for example `python -m pytest`). Writing tasks can leave it out.
- [ ] **Limits** in `don't`: no new dependencies, don't touch other features, keep the existing style.
- [ ] **A deliverable:** what you get back ("a change to `signup.html` and `signup.css`").
- [ ] **No secrets, private data or live systems.** Volunteers must never need a password, customer data or production access.
- [ ] **The kind:** `code` (default) or `writing` (docs, translations, research notes).
- [ ] **`needs: computer`** if it can only be done on a desktop (checking a desktop app's screen, special hardware). Chat-app volunteers won't be offered it.

Our server checks most of this automatically and refuses the task with a clear message if something's missing. The ones it can't check are judgement: is it truly small, and are the criteria truly checkable?

## Good and bad

| | Weak | Strong |
|---|---|---|
| Goal | Fix the form | The sign-up form fits a 360-pixel-wide phone screen without sideways scrolling. |
| Files | the frontend | `site/signup.html`, `site/signup.css` |
| Acceptance | It looks good | At 360px wide, no horizontal scroll; all fields and the button are visible; desktop layout unchanged. |
| Check | test it | `npx playwright test tests/signup.spec.ts` |
| Limits | (empty) | No new libraries. Don't change the other pages. Keep the colours. |

## The template

```yaml
schemaVersion: 1
project:
  name: harbor-pantry                 # letters, digits, dashes
  github: https://github.com/your-org/your-repo
  nonprofit: true                     # or publicGood: true
  cause: food                         # community, education, environment, food, health,
                                      # human-rights, animals, arts-culture, open-source, other
  summary: A food bank's volunteer shift planner.
  preview: https://{branch}.harbor.pages.dev   # optional: preview link per pull request
  volunteerReviewers: true            # optional: welcome advice from volunteer reviewers
  checks:                             # how our test machine runs your tests
    setup: python -m pip install -q -e ".[dev]"
    run: python -m pytest -q
tasks:
  - id: fix-overnight-hours           # lowercase, dashes
    title: Count overnight shifts forward
    goal: Make shift_hours count shifts that cross midnight forward.
    size: small                       # small, medium or large
    instructions: |
      Fix shift_hours in pantry_shifts/shifts.py so a shift that ends after
      midnight counts the hours forward instead of going negative.
      Remove the xfail marker in tests/test_shifts.py and keep its assertions.
    acceptance: |
      python -m pytest exits 0, including test_overnight_closer_is_four_hours.
      Shifts that don't cross midnight give the same result as before.
    tests: [python -m pytest]
    do: [pantry_shifts/shifts.py, tests/test_shifts.py]
    don't:
      - Do not add a dependency.
      - Do not change other functions.
    deliverable: A change to pantry_shifts/shifts.py and tests/test_shifts.py.

  - id: write-first-shift-note
    kind: writing
    title: Write a first-shift note for new volunteers
    goal: New pantry volunteers know where to go and what to bring on their first shift.
    size: small
    instructions: |
      Write docs/first-shift.md (new file) for someone arriving for the first time.
      Cover where to check in, what to wear, and how the 15-minute shift grid works.
    acceptance: Under 300 words, friendly, mentions check-in, clothing and the 15-minute grid.
    do: [docs/first-shift.md (new file)]
    don't: [Do not change code.]
    deliverable: The new Markdown file.
```

Your `AGENTS.md` tells every volunteer's AI how your project works: setup, style, what never to touch. See the [templates](/handbook/templates).

## After you publish

- Changes appear within 15 minutes. Tasks in progress keep their old brief until handed in or back.
- **A task handed back three times is paused** until you change its brief. The reasons are on your account page and in the closed pull requests. Fix what they point to, and the task reopens.
- If volunteers ask the same question twice, the answer belongs in the brief or in `AGENTS.md`.
