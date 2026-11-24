# Joining the volunteer pool

This is for a nonprofit or public-good open-source project on GitHub. Joining takes two files and one click.

1. **Add two files** to your repository (copy them from `templates/project-starter/`):

   | File | Why it is there |
   | --- | --- |
   | `volunteer-compute.yaml` | The task list. Every task must pass the task standard below (`npm run cli -- lint --manifest volunteer-compute.yaml`). |
   | `AGENTS.md` | The standing rules a volunteer's AI reads with every brief: setup, style, what not to touch. |

   You also need tests that run on pull requests (any CI). The starter's `.github/workflows/test.yml` is an example.

2. **Install the Volunteer Compute Broker GitHub App** on that repository. It asks for permission to write contents and pull requests in the repositories you choose, nothing else.

3. **Ask to be registered.** During the test phase the broker admin registers your task list. Repo-ownership checks and a project application form come next.

## What you do day to day

Nothing new. When a volunteer submits work, a pull request appears in your repository, opened by the app, with the volunteer's report and the task's acceptance criteria. Your CI runs on it as usual.

- **Merge it** → the task is marked done, tasks that depend on it open up, and the volunteer's impact counts on the public page.
- **Close it without merging** → the task goes back to the pool for another volunteer.

The app never merges anything and never touches a pull request it did not open. It refuses any diff that touches `.github/`.

## The task standard

Every task needs all of these. `lint` rejects a missing field and a vague one.

- `goal`: one sentence.
- `instructions`: the steps, at least two lines.
- `acceptance`: how a reviewer can tell it is done.
- `tests`: the exact commands, one per line.
- `do`: files or areas the volunteer may touch.
- `don't`: what they must not do.
- `deliverable`: what they hand back. A unified diff, or a pull request URL.
- `size`: `small`, `medium`, or `large`.
- `estimatedCostUsd`: inside that size's band.

Size bands:

| Size | Cost (USD) | Effort |
| --- | --- | --- |
| small | more than 0 and at most 0.10 | one sitting, a few files |
| medium | more than 0.10 and at most 0.40 | one pull request with tests |
| large | more than 0.40 and at most 100 | a bigger change that is still one task |

A task above $100 is not a volunteer task. Split it. A task can also be too big for every donor's monthly budget even when the size is valid. `too-big` lists those.

### One task that passes

```yaml
  - id: readme-audience
    title: Say who the project is for
    goal: Add one sentence to the README that names the people the project is for.
    instructions: |
      Open README.md.
      Add one sentence under the title that names the audience.
    acceptance: README.md contains one new sentence naming the audience, and node --test exits 0.
    tests: |
      node --test
    do:
      - README.md
    don't:
      - Do not add a dependency.
      - Do not edit files other than README.md.
    deliverable: A unified diff that changes only README.md.
    size: small
    estimatedCostUsd: 0.04
```

### One task that is rejected

```yaml
  - id: fix
    title: Fix it
    goal: Fix it.
    instructions: Fix it.
    acceptance: done
    tests: tests
    do:
      - etc
    don't:
      - no
    deliverable: something
    size: small
    estimatedCostUsd: 0.05
```

`lint` reports that the goal is vague, the instructions are not steps, and the tests are not an exact command.

## How finished work gets back

1. A volunteer's AI submits a unified diff through MCP.
2. The broker applies the diff to your default branch through the GitHub API, on a branch called `volunteer/<task-id>-<commit>`, and opens a pull request. The commit is credited to the volunteer.
3. You review and merge or close it on GitHub. The app's webhook tells the broker which.

If the app is not installed yet, submissions wait. Installing it opens pull requests for everything waiting.

Projects that cannot install an app can still use the older route: `templates/project-starter/.github/workflows/volunteer-apply.yml` opens pull requests from your own Action after an admin accepts the diff.
