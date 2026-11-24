# Volunteer compute broker

This is meant for nonprofit projects and organizations getting work done through open-source development. It is transparent and helps everyone: a nonprofit that can't afford a dev team can still get big projects done by splitting them into small tasks that many donors' compute completes.

A project posts small tasks. A volunteer connects their own AI app (Claude, Gemini CLI, Grok and others) over MCP, claims one task, does it on their own plan and hands back a patch or a pull request. The broker gives each task to one volunteer, keeps the order, and lists accepted work publicly. The code is MIT licensed.

> **The donated-API-key route is local and experimental only.** OpenAI's business terms forbid transferring API keys to a third party, and Anthropic's terms forbid sharing an API key. The hosted broker therefore runs MCP only (the Worker uses the fake provider registry and exposes no key registration). Do not collect real donor keys. See `ROADMAP.md`.

The project writes the instructions. The donor does not need to be a programmer. This repository is the service in the middle: registration, eligibility, assignment, and execution. It does not open pull requests or talk to GitHub. A donor who brings an AI app asks for a number of tasks of one size and receives them one at a time. Finished work is public at `/` and `/public.json` on the worker, under the donor's pseudonym.

Payments and money donations are a future idea. This broker does not move money.

## Storage

The hard rule is that a task is held by one donor, including when two claims arrive together. `SqliteStore` is the only place that writes task rows. Local tests use Node 22 `node:sqlite`: `BEGIN IMMEDIATE`, then an update that matches only `state = 'open'`.

The Cloudflare Worker uses the same store on D1. One Durable Object named `broker` runs claim, submit, accept, reject, release, and lease expiry one at a time. D1 commits each statement on its own, so that object is the lock. See `DEPLOY.md` for `https://volunteer.apishelf.dev`.

`node:sqlite` is still marked experimental in Node 22. The npm scripts set `NODE_OPTIONS=--disable-warning=ExperimentalWarning` so that notice stays out of the test log. Node 22 or newer is required.

## Layout

```
src/state-machine.ts    task states and the only legal moves between them
src/budget.ts           monthly budget, claim order, and tasks too big to place
src/eligibility.ts      donor gate: terms, monthly budget, provider, key
src/manifest.ts         volunteer-compute.yaml: tasks, dependencies, nonprofit, cycles
src/sqlite-store.ts     row store behind a small SQL interface
src/schema.ts           D1 and SQLite table definitions
src/d1-sql.ts           D1 adapter used inside the Durable Object
src/worker.ts           Worker fetch: /mcp and /admin
src/admin.ts            JSON admin API
src/remote-cli.ts       CLI calls against BROKER_URL
src/crypto.ts           envelope encryption for donor API keys
src/redact.ts           strips keys from errors and log lines
src/providers.ts        Anthropic, OpenAI, xAI, and Google adapters
src/fake-provider.ts    scripted providers for tests and local dry runs
src/runner.ts           decrypts the key and executes one claimed task
src/broker.ts           register, claim, run, retry, expire
src/cli.ts              command line
src/types.ts            shared types
src/index.ts            library exports
fixtures/sample-project a repo-shaped manifest next to AGENTS.md
tests                   unit tests, concurrent claims, end-to-end run
```

## Task states

`src/state-machine.ts` is the lifecycle. Nothing else decides the next state.

```
blocked --dependencies_met--> open
open --claim--> claimed
open --dependencies_unmet--> blocked
claimed --start--> running
claimed --lease_expired | release--> open
claimed --submit--> review
review --accept--> done
review --reject--> open
running --succeed--> done
running --fail--> failed
running --lease_expired | release--> open
failed --retry--> open      dependencies still done, attempts left
failed --retry--> blocked   dependencies not done, attempts left
```

A task with dependencies is registered as `blocked`. It becomes `open` only after every dependency is `done`. A claim moves `open` to `claimed` and reserves the task's estimated cost against the donor's remaining monthly budget. The lease is 10 minutes. If the donor never finishes, the next claim or `expire-leases` returns the task to `open` and releases the reservation. A failed run stays `failed` until `retry`, and stops after 3 attempts.

A task may set `provider`. Only a donor on that provider can claim it. Otherwise the donor's own provider is used. The key and the API always belong to the same provider.

## Manifest

Projects keep `volunteer-compute.yaml` in the repo, beside something like `AGENTS.md`. See `fixtures/sample-project`.

```yaml
schemaVersion: 1
project:
  name: leaflet-docs
  github: https://github.com/example/leaflet-docs
  nonprofit: true
  orgUrl: https://example.org/leaflet-docs
tasks:
  - id: inventory
    title: List the public modules
    instructions: |
      List the public modules as a short bullet list.
    acceptance: |
      Three or more bullets, each naming one module.
    estimatedCostUsd: 0.02
  - id: readme-section
    title: Draft a README section
    dependsOn: [inventory]
    provider: anthropic   # optional; only an Anthropic donor can claim it
    instructions: |
      Draft the section from the inventory.
    acceptance: |
      One section that mentions every module.
```

Registration reads a local file. It does not call GitHub. A dependency cycle, an unknown id, or a duplicate id is rejected and nothing is stored.

`nonprofit: true` (or `publicGood: true`) marks a public-good project. `orgUrl` is optional. When a donor asks for work, `src/budget.ts` keeps tasks from the organizations they named (or every project, if they named none), keeps tasks that fit the remaining budget for the UTC calendar month, puts nonprofit tasks first, and then picks the largest. A task whose cost is above every eligible donor's full monthly budget is left open. `too-big` lists those so the project can split them. Spent and reserved amounts are tracked per month and refill on the first request in the new month.

## Donor keys

Each API key is sealed with envelope encryption before it is written. A random data key encrypts the secret with AES-256-GCM. `BROKER_MASTER_KEY` (base64, 32 bytes) encrypts that data key. The master key comes from the environment, never from the repo.

`src/runner.ts` is the only place a key is decrypted. It is passed to the provider call and then discarded. Commands and broker results return donor id, provider, cap, and spend. They do not return the key. Errors and log lines go through `redact`. The ciphertext lives in a separate `secrets` table from the donor row.

The CLI refuses `--api-key`, because a process list would show it. Pass a file or an environment variable name.

Eligibility, in `src/eligibility.ts`:

- terms accepted
- monthly budget is a finite number greater than 0 (`--budget`, or `--cap` as the same number)
- provider is `anthropic`, `openai`, `xai`, or `google`
- key shape is acceptable, then the provider accepts the key
- a claim also has to fit in this month's `budget - spent - reserved`

Local rules run before the provider is contacted.

## Providers

The adapters call the official HTTP APIs:

| Provider | Validation | Execution |
| --- | --- | --- |
| Anthropic | `GET https://api.anthropic.com/v1/models` | `POST /v1/messages` |
| OpenAI | `GET https://api.openai.com/v1/models` | `POST /v1/chat/completions` |
| xAI | `GET https://api.x.ai/v1/models` | `POST /v1/chat/completions` |
| Google | `GET https://generativelanguage.googleapis.com/v1beta/models` | `POST .../models/{model}:generateContent` |

The Google key is sent in the `x-goog-api-key` header, not the URL. Default models are `claude-sonnet-4-5`, `gpt-4.1-mini`, `grok-3`, and `gemini-2.5-flash`. Override one with `BROKER_MODEL_ANTHROPIC`, `BROKER_MODEL_OPENAI`, `BROKER_MODEL_XAI`, or `BROKER_MODEL_GOOGLE`.

Tests use `src/fake-provider.ts` and never call the network. `tests/live-smoke.test.ts` calls the real APIs only when `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, or `GEMINI_API_KEY` / `GOOGLE_API_KEY` is set. Otherwise those tests are skipped.

## Install and test

```bash
npm install
npm test
```

`npm test` runs the unit tests and the end-to-end harness. The harness alone:

```bash
npm run test:e2e
```

The harness registers `fixtures/sample-project` (four tasks, including a dependency and an OpenAI-only task), adds three donors on Anthropic, OpenAI, and Google, and runs until every task is done. It checks dependency order, one holder per task, and that none of the keys appear in logs, command results, or the database file. A second test fires six processes at one task and expects a single winner. Another gives a small monthly budget and a large one: the small donor receives the largest fitting nonprofit task, a task above every monthly budget is flagged and never assigned, the budget refills in the next UTC month, and the ledger names the project, donor, provider, and estimated spend without keys. A further test checks that a provider error which contains the key is stored and printed as `[REDACTED]`.

## CLI

```bash
export BROKER_MASTER_KEY="$(npm run --silent cli -- init-key)"
export BROKER_DB="$PWD/data/broker.sqlite"

npm run cli -- register-project --manifest fixtures/sample-project/volunteer-compute.yaml

# Real provider check. Omit BROKER_PROVIDERS, or set it to real.
export ANTHROPIC_API_KEY="sk-ant-..."
npm run cli -- register-donor \
  --name ada \
  --provider anthropic \
  --budget 5 \
  --accept-terms \
  --api-key-env ANTHROPIC_API_KEY

npm run cli -- status
npm run cli -- claim-next --donor "$DONOR_ID"
npm run cli -- run --donor "$DONOR_ID" --task "$TASK_ID"
npm run cli -- too-big
npm run cli -- ledger
npm run cli -- support --donor "$DONOR_ID" --projects leaflet-docs
npm run cli -- impact --donor "$DONOR_ID"
```

A local dry run that does not contact a provider:

```bash
export BROKER_PROVIDERS=fake
printf '%s' 'local-test-key-0001' > /tmp/donor.key
npm run cli -- register-donor \
  --name ada \
  --provider anthropic \
  --budget 5 \
  --accept-terms \
  --api-key-file /tmp/donor.key
```

`fake` accepts any well-formed key and returns scripted task output. Do not use it with a real donor key.

`ledger` prints completed work twice: once grouped by project, once by donor. Each line has the task, the donor's display name, the provider that ran it, the estimated spend, and the UTC month. It does not print keys or anything beyond that name.

`support --donor <id> --projects name,name` limits that donor to those projects. `--clear` opens the list again. A donor who never sets one can receive any fitting task.

`impact --donor <id>` tells that donor how their compute helped: tasks completed, organizations helped, estimated spend, and which of those projects are now fully done. It prints the display name only.

## MCP

An AI app can do the work itself. It connects to the broker, receives the task and `AGENTS.md`, works in its own environment, and submits a pull request URL or a patch. No provider API key is stored. The donor's budget is a count of tasks per UTC month.

A task may name a provider, for example `provider: anthropic`. That lock applies only to API-key donors, who must hold a key for that provider. An MCP donor brings their own model, so the lock does not apply. Otherwise a provider-locked task would sit forever on a broker whose donors are all MCP agents.

Register the donor, mint a token once, then serve MCP:

```bash
npm run cli -- register-mcp-donor --name ada --tasks 10 --accept-terms
npm run cli -- mcp-token --donor "$DONOR_ID"
npm run cli -- mcp-serve --port 8788
```

`mcp-revoke --donor "$DONOR_ID"` invalidates that donor's tokens. `accept --task <id>` and `reject --task <id> --reason "..."` are the maintainer review. A submission stays in `review` until it is accepted, so it does not unblock dependencies or count as impact yet.

Claude Desktop, local stdio:

```json
{
  "mcpServers": {
    "volunteer-compute": {
      "command": "npm",
      "args": ["run", "cli", "--", "mcp-stdio"],
      "env": {
        "BROKER_MASTER_KEY": "paste-the-master-key",
        "BROKER_DB": "/absolute/path/data/broker.sqlite",
        "MCP_TOKEN": "vbk_paste-the-token"
      }
    }
  }
}
```

Claude Desktop, Gemini CLI, Cursor, or any client that speaks streamable HTTP:

```json
{
  "mcpServers": {
    "volunteer-compute": {
      "url": "http://127.0.0.1:8788/mcp",
      "headers": {
        "Authorization": "Bearer vbk_paste-the-token"
      }
    }
  }
}
```

The tools are `request_work`, `claim_next`, `list_eligible_tasks`, `claim_task`, `get_task_instructions`, `submit_result`, `release_task`, `stop_work`, and `my_impact`. They use the same claim, budget, support, and nonprofit rules as the CLI. `JOINING.md` is how a project gets on the list. `CONNECTING.md` is how a donor's app connects.

Hosted MCP, after the steps in `DEPLOY.md`:

```json
{
  "mcpServers": {
    "volunteer-compute": {
      "url": "https://volunteer.apishelf.dev/mcp",
      "headers": {
        "Authorization": "Bearer vbk_paste-the-token"
      }
    }
  }
}
```

The same commands run against the hosted broker when `BROKER_URL` and `BROKER_ADMIN_TOKEN` are set:

```bash
export BROKER_URL=https://volunteer.apishelf.dev
export BROKER_ADMIN_TOKEN=...
npm run cli -- register-project --manifest fixtures/harbor-pantry/volunteer-compute.yaml --repo fixtures/harbor-pantry
npm run cli -- register-mcp-donor --name ada --tasks 10 --accept-terms
npm run cli -- mcp-token --donor "$DONOR_ID"
```

`BROKER_ADMIN_TOKEN` is the Worker secret `ADMIN_TOKEN`. The token is shown once. `mcp-revoke`, `list-tasks`, `accept`, `reject`, `ledger`, and `impact` use the same flags as the local CLI.

### Deploy

The Worker code is in this repo and is not deployed from here. `wrangler.jsonc` binds D1, the `BrokerObject` Durable Object, and the custom domain `volunteer.apishelf.dev` (`custom_domain: true`, `workers_dev: false`). Secrets `BROKER_MASTER_KEY` and `ADMIN_TOKEN` are Worker secrets only. `DEPLOY.md` has the create, migrate, secret, and deploy commands. `npm test` builds `dist/worker` with `wrangler deploy --dry-run --outdir` and runs the fetch handler in Miniflare.

`too-big` lists open tasks that cannot be placed. `exceeds_every_monthly_budget` means the cost is above every eligible donor's full monthly budget, so the project should split the task. `no_eligible_donor` means no vetted donor can run that provider.

Other commands: `claim`, `release`, `retry`, `expire-leases`, `list-tasks --project <id>`. `npm run cli -- help` prints them.

## Related projects

[Claw Club](https://github.com/launchaddict/clawclub) (MIT) is an MCP server that pulls a charity task from a public GitHub Issues board into the volunteer's own Claude session. A maintainer label is the vetting gate. Its injection lint warns and still shows the brief; the volunteer has to agree before the work starts. This broker holds a flagged brief until an admin approves it, then assigns one leased task at a time, with budgets, dependencies, and a public record. Nothing here is copied from that repository.

[Compute for Good](https://github.com/kiselas/compute_for_good) (MIT) is a larger service: accounts, a web app, independent review, and GitHub delivery, on FastAPI, Postgres, and Redis. This broker is the smaller piece: one store, one Durable Object, no accounts, and the project's own Action opens the pull request. The only page is the read-only board.

## Known gaps

- Registration reads a local manifest posted by the admin. The task list does not sync from GitHub yet.
- The GitHub App opens a pull request per submission and treats merge as accept and close as reject (`src/github-app.ts`, `src/github-routes.ts`). Diffs are applied by the broker's own unified-diff applier through the GitHub API; binary files and renames with edits are not supported.
- Spend is the task's `estimatedCostUsd`, not measured tokens.
- The lease is refreshed when a run starts, not while the provider call is in flight. A run that outlives the lease can lose the write.
- Failed tasks wait for `retry` and then stop at 3 attempts.
- One master key, no rotation. The envelope version field is `1`.
- The CLI trusts whoever can read the database and the master key. The hosted admin token is the same kind of shared secret.
- On D1, a crash between the task update and the budget update can leave those rows apart. The Durable Object still runs one claim at a time.
- The hosted Worker does not call provider APIs. API-key runs stay on the local CLI.
- Text that merely looks like a provider key is redacted before it is stored.
- The injection lint is a keyword check. A flagged brief waits for an admin. A brief that passes can still be hostile, so the safety rules are wrapped around every brief and still outrank it.
