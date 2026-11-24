# Joining the volunteer pool

This is for a nonprofit open-source project on GitHub. The broker at `https://volunteer.apishelf.dev` keeps the task list and the single-claim rule. It never gets a token that can write to your repository. Your repository opens its own pull requests.

Copy `templates/project-starter/` into the repository and change the project name. The files that matter:

| File | Why it is there |
| --- | --- |
| `volunteer-compute.yaml` | The task list. Every task has to pass `npm run cli -- lint --manifest volunteer-compute.yaml`. |
| `AGENTS.md` | The standing rules a volunteer agent reads with the brief. |
| `.github/workflows/test.yml` | Runs the commands named in the tasks. |
| `.github/workflows/volunteer-apply.yml` | After you accept a diff, this opens a pull request with the repository's own `GITHUB_TOKEN`. |

## Register

For the current test, an admin registers the manifest. From a checkout of this broker, with the admin token:

```bash
export BROKER_URL=https://volunteer.apishelf.dev
export BROKER_ADMIN_TOKEN=...
npm run cli -- register-project --manifest path/to/volunteer-compute.yaml --repo path/to/the/repo
```

That posts the YAML and `AGENTS.md`. Later, ownership should be checked before a project name can be registered: the broker issues a nonce, the repository commits it at `.well-known/volunteer-compute`, and the broker reads that file from the public GitHub URL. That check is not built yet. Until it is, only the admin token can register a project.

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

1. The volunteer submits a unified diff through MCP. They can also submit a pull request URL if they already opened one themselves.
2. You read the summary and diff with `GET /admin/tasks?project=<id>` (admin token). Submissions stay off the public page until you accept them, because they are unreviewed.
3. You accept or reject it:

```bash
npm run cli -- accept --task <task-id>
npm run cli -- reject --task <task-id> --reason "the test output is missing"
```

4. In the repository settings, under Actions → General → Workflow permissions, tick "Allow GitHub Actions to create and approve pull requests". Without it the workflow cannot open the pull request.
5. `.github/workflows/volunteer-apply.yml` runs on a schedule or when you start it by hand. It refuses any patch that touches `.github/`, runs your `TEST_COMMAND` and only opens a pull request if the tests pass. Because GitHub does not start `pull_request` workflows for pull requests opened with `GITHUB_TOKEN`, it then starts your test workflow on the branch by hand, so the checks still show on the pull request. It downloads an accepted patch for this project that does not yet have a pull request URL, applies it on a branch, and opens the pull request with `GITHUB_TOKEN`. The broker still cannot push.
6. Record the pull request so the public page links to it:

```bash
npm run cli -- record-pr --task <task-id> --pr https://github.com/you/project/pull/1
```

Accepting a task is what unblocks tasks that `dependsOn` it, and what counts for the donor's public impact.
