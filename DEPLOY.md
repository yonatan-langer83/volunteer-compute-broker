# Deploy to volunteer.apishelf.dev

The Worker is ready to deploy and is not deployed from this repo. These commands use Wrangler with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token needs Workers Scripts, D1, and zone edit on `apishelf.dev`. Do not enable `workers.dev`. The route in `wrangler.jsonc` is the custom domain only.

`BROKER_MASTER_KEY` and `ADMIN_TOKEN` are Worker secrets. They are not in `wrangler.jsonc` and they are not passed as command arguments.

## 1. Create D1

```bash
npx wrangler d1 create volunteer-broker
```

Copy the printed `database_id` into `wrangler.jsonc` under `d1_databases[0].database_id`. The committed value `00000000-0000-0000-0000-000000000000` is a placeholder so the config parses before the database exists.

## 2. Apply the schema

```bash
npx wrangler d1 migrations apply volunteer-broker --remote
```

That runs every file in `migrations/`. `0002` adds the task brief, the donor handle, and `work_sessions`. `0003` adds the safety-review columns. A new database needs all of them. `src/schema.ts` is the full schema a fresh local database creates in one step.

## 3. Set the two secrets

```bash
npm run cli -- init-key | npx wrangler secret put BROKER_MASTER_KEY
npx wrangler secret put ADMIN_TOKEN
```

`init-key` prints a base64 32-byte key. Type or pipe the admin token at the second prompt. A long random string is enough. The CLI sends it as `BROKER_ADMIN_TOKEN` and the Worker reads it as `ADMIN_TOKEN`.

## 4. Deploy and attach the domain

```bash
npx wrangler deploy
```

`routes` already contains `volunteer.apishelf.dev` with `custom_domain: true`, and `workers_dev` is false, so this deploy attaches that hostname. The zone `apishelf.dev` must already be on the same Cloudflare account.

## 5. Check

```bash
curl https://volunteer.apishelf.dev/
export BROKER_URL=https://volunteer.apishelf.dev
export BROKER_ADMIN_TOKEN=...
npm run cli -- register-project --manifest fixtures/harbor-pantry/volunteer-compute.yaml --repo fixtures/harbor-pantry
```

MCP clients use `https://volunteer.apishelf.dev/mcp` with `Authorization: Bearer vbk_...`.

## Bundle without deploying

```bash
npx wrangler deploy --dry-run --outdir dist/worker
```

`npm test` runs that command and then starts the Worker locally. The dry run does not publish the script. The deployable module is `dist/worker/worker.js`.

## What the Worker does

- `POST /mcp` is the SDK Web Standard streamable HTTP transport. Bearer tokens are the donor tokens minted by `mcp-token`. `GET` and `DELETE` return 405.
- `/admin/*` is JSON, authorized by `ADMIN_TOKEN` with a constant-time compare. It registers a project from posted manifest YAML, registers an MCP donor, mints and revokes a donor token (the mint response is the only time the token appears), lists tasks, accepts or rejects a submission, and reads the ledger and impact.
- Claim, submit, accept, reject, release, and lease expiry run inside one Durable Object (`BrokerObject`, id name `broker`) so two claims of the same task still have one winner.
- D1 has no interactive transaction. Each statement commits. The Durable Object finishes one of those calls before it starts the next. A crash between the task update and the budget update can leave those two rows apart until a later repair; the conditional `state = 'open'` update still prevents a second winner.

The hosted Worker accepts MCP submissions. It does not call Anthropic, OpenAI, xAI, or Google. Provider runs stay on the local CLI.

## Cloudflare API, if you are not using Wrangler

Use the same API token.

1. `POST /accounts/{account_id}/d1/database` with `{"name":"volunteer-broker"}`. Put the returned uuid in `wrangler.jsonc`.
2. `POST /accounts/{account_id}/d1/database/{database_id}/query` with the body of `migrations/0001_init.sql` as the SQL. Repeat per statement if the endpoint accepts one statement at a time.
3. `PUT /accounts/{account_id}/workers/scripts/volunteer-compute-broker/secrets` with `BROKER_MASTER_KEY` and `ADMIN_TOKEN`.
4. Upload the module in `dist/worker` as the script `volunteer-compute-broker`, with the D1 binding `DB` and the Durable Object binding `BROKER` class `BrokerObject`. Apply the migration tag `v1` (`new_classes: ["BrokerObject"]`) before the first request.
5. `PUT /accounts/{account_id}/workers/domains` (or the workers/scripts subdomain route API for custom domains) to attach `volunteer.apishelf.dev`. Do not add a `workers.dev` route.
