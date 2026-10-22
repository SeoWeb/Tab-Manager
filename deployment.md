# Cloudflare Deployment

Backend code lives in `./backend` and is designed to deploy as a Cloudflare Worker with a D1 database.

## Prerequisites

- Cloudflare account
- `wrangler` CLI
- Node.js 20+
- A generated JWT secret

Install dependencies:

```bash
cd backend
npm install
```

Login to Cloudflare:

```bash
npx wrangler login
```

## Create D1 database

Create the D1 database named in `backend/wrangler.toml`:

```bash
npx wrangler d1 create tab-manager-dev
```

Copy the returned database id and update `backend/wrangler.toml`:

```toml
[[d1_databases]]
binding = "D1_DATABASE"
database_name = "tab-manager-dev"
database_id = "PASTE_DATABASE_ID_HERE"
```

If you choose a different database name, update both `database_name` and the migration commands below.

## Durable Objects (realtime)

The `PROJECT_ROOM` Durable Object (Phase 5 realtime presence + change fan-out)
is declared in `backend/wrangler.toml` under `[[durable_objects.bindings]]` and
registered by the `[[migrations]]` block. No manual `wrangler do create` step is
needed — `npx wrangler deploy` (and `npx wrangler dev`) creates the class
automatically from the migration. It works locally with `wrangler dev`.

## Run migrations

The migration freeze has been **lifted** (its cause, migration 0003, was
removed — see below). Remote migrations remain restricted by two rules:
a **verified backup taken immediately before every remote apply**, and
**explicit human confirmation** — run `migrate:remote` only as a deliberate,
logged step at the terminal, never from CI, scripts, or any other automation.

Schema is managed with wrangler's D1 migration framework. Migrations live in
`backend/src/db/migrations/` (wired via `migrations_dir` in
`backend/wrangler.toml`). Wrangler tracks applied migrations in the database's
`d1_migrations` table and applies each file exactly once, in filename order.
The current set:

| Migration | Purpose |
| --------- | ------- |
| `0001_init.sql` | Canonical schema |
| `0002_login_codes.sql` | `login_codes` table |
| `0004_unique_client_mutation_id.sql` | De-duplicates `sync_changes` on `(project_id, client_mutation_id)` (keeping the earliest row) and adds unique index `idx_sync_changes_project_mutation` |

### Removed migration 0003, and why it mattered

`0003_drop_e2e.sql` (rollback of the abandoned cloud E2E encryption columns)
was **removed** from the migration set. It rebuilt `users`/`projects` via
`DROP TABLE`, which was verified empirically to **hard-fail on any populated
database**: with foreign keys enforced, dropping `users` violates
`projects.owner_id REFERENCES users(id)`. The migration aborts and rolls back
atomically (no data loss, no partial tables), but it stays pending forever —
permanently blocking the whole migration chain. None of the usual escape
hatches work: `PRAGMA defer_foreign_keys` only moves the failure to commit
time, `PRAGMA foreign_keys = OFF` is a no-op inside the migration transaction,
and `ALTER TABLE … DROP COLUMN` errors on canonical databases that never had
the E2E columns. Standing rule: **no automatic migration step may run
`DROP TABLE` on a populated parent table.**

No real database carries the E2E columns (`users.public_key` /
`wrapped_private_key` / `key_salt`, `projects.encrypted`, `project_keys`):
they could only exist where the original, since-deleted `0003_e2e_keys.sql`
had actually run — the remote DB was built from canonical 0001/0002 and local
dev states were rebuilt fresh. For a hypothetical straggler that *does* carry
them, use the explicitly manual script `backend/scripts/drop-e2e-columns.sql`
(`wrangler d1 execute --file=…`, verify-first procedure in its header) — never
as an automatic migration. Databases that already recorded 0003 in
`d1_migrations` need no action: stale tracking rows for files that no longer
exist are ignored by wrangler.

### Mandatory: verified backup before any remote migration apply

Immediately before **any** remote migration apply, take and verify a backup:

```bash
npx wrangler d1 export tab-manager-dev --remote --output=backup-$(date +%F).sql
```

(or the Cloudflare dashboard export equivalent). **Verify** it — compare row
counts of the key tables (`users`, `projects`, `collections`, `links`,
`sync_changes`) against the live database before proceeding. A remote apply
without a fresh, verified backup is not allowed.

```bash
cd backend
npx wrangler d1 migrations list tab-manager-dev --local   # preview what is pending
npm run migrate:local                                     # wrangler d1 migrations apply … --local
# npm run migrate:remote                                  # explicit, logged, backup-verified step only
```

Re-running the commands is safe: only migrations not yet recorded in
`d1_migrations` are applied.

### One-time baseline for databases migrated the old way

Databases migrated before the framework existed used `wrangler d1 execute
--file=…`, which runs the SQL but records nothing in `d1_migrations`. On such
a database `d1 migrations list` reports every migration as pending. With 0003
removed, both ways forward are safe on a populated old-way database:

**(a) Local dev / disposable database — fresh start.** Delete the local D1
state and re-apply through the framework:

```bash
cd backend
rm -rf .wrangler/state
npm run migrate:local
```

**(b) Any database that must be preserved — apply (optionally marking 0001/0002
first).** 0001/0002 are guarded (`CREATE … IF NOT EXISTS`) and re-run as
no-ops; 0004 does the real work (de-duplicating `sync_changes`, keeping the
earliest row per `(project_id, client_mutation_id)`, then adding the unique
index). Taking a verified backup first is part of the remote procedure above.

To keep `d1_migrations` honest before applying, create it by running
`npx wrangler d1 migrations list tab-manager-dev --local` once (it creates the
table), then insert one row per already-applied migration — `name` values must
equal the migration filenames exactly:

```bash
npx wrangler d1 execute tab-manager-dev --local --command "INSERT INTO d1_migrations (name) VALUES ('0001_init.sql'), ('0002_login_codes.sql');"
```

(append `--remote` for the remote database).

If an old-way database predates the 2026-07 cloud-E2E removal and still
carries the E2E columns, clean it up first with the manual script
(`backend/scripts/drop-e2e-columns.sql`) — see "Removed migration 0003" above.

## Configure secrets

Generate a JWT secret locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set it as a Worker secret:

```bash
cd backend
npx wrangler secret put JWT_SECRET
```

`ALLOWED_ORIGINS` is a plain var set in `backend/wrangler.toml` under `[vars]`
(not a secret). The list is **exact-match and comma-separated; `*` is rejected**
(the CORS check fails closed):

```toml
[vars]
ALLOWED_ORIGINS = "https://tab-manager.ww0.dev,chrome-extension://<EXTENSION_ID>"
```

`<EXTENSION_ID>` is the extension's ID in the Chrome Web Store — read it from
the store listing URL (or `chrome://extensions`) before deploying. Override
the value for local development in `backend/.dev.vars` (see
`backend/.dev.vars.example`).

## Deploy Worker

```bash
cd backend
npm run deploy
```

Or directly:

```bash
cd backend
npx wrangler deploy
```

After deployment, Wrangler prints the Worker URL, for example:

```txt
https://tab-manager-cloudflare-backend.your-subdomain.workers.dev
```

## Deploy Frontend (Worker)

The frontend is a Next.js static export (`output: 'export'`, `distDir: 'build'`)
shipped as a Cloudflare **Worker** named `tab-manager` that serves the `build/`
directory as static assets — the same `wrangler deploy` model as the backend,
just assets-only (no D1 / Durable Object / Worker script). It is reachable at
`https://tab-manager.siim-liimand.workers.dev`.

Config lives in `frontend/wrangler.toml`:

```toml
name = "tab-manager"
compatibility_date = "2025-01-01"

[assets]
directory = "./build"
```

It deliberately uses the asset defaults (no SPA fallback) to match the live
site, which returns `404` for unknown paths and redirect-cleans `/foo.html`. If
you ever adopt path-based routing, set `not_found_handling =
"single-page-application"` under `[assets]` so deep links fall back to
`index.html`.

Deploy (builds first, then uploads `build/` to the worker):

```bash
cd frontend
npm run deploy
```

Or directly:

```bash
cd frontend
npx wrangler deploy
```

> `npx` fetches `wrangler` on demand — it is not a frontend dependency. The
> backend pins `wrangler` in its own devDependencies; do the same here if you
> prefer a local install.

A custom domain (e.g. `tab-manager.ww0.dev`) can be attached in the Cloudflare
dashboard under Workers & Pages → `tab-manager` → Settings → Domains & Routes.
If you add one, update the backend's `ALLOWED_ORIGINS` to include it.

## Local development

```bash
cd backend
npm run dev
```

## Email-based sign-in (magic PIN)

Authentication is passwordless: the extension/frontend sends the user's email +
(display) name to `POST /auth/request-code`, the Worker generates an 8-digit
code, stores it (one active code per email, valid for 10 minutes), and emails it
via the Cloudflare `send_email` binding (`EMAIL`). The user pastes the code into
the 8-box input and submits it to `POST /auth/verify`, which — on a match —
issues a JWT, deletes the single-use code, and returns the account. Wrong or
expired codes increment an attempt counter; after 5 failures the code is
invalidated and a new one must be requested.

### Configure the email binding

`backend/wrangler.toml` already declares the binding:

```toml
[[send_email]]
name = "EMAIL"
remote = true
```

`remote = true` routes sends through Cloudflare's live email infrastructure, so
the `from` address (`welcome@support.tabspace.ww0.dev`, set in
`backend/src/lib/email.ts`) must be a verified subdomain of the Worker. Verify
the domain in the Cloudflare dashboard (Email → Addresses / sending) before
deploying.

### Run the migration

The login codes live in a new table (`0002`). Apply migrations locally; for
the remote database follow the remote rules in
[Run migrations](#run-migrations) (verified backup, explicit logged step):

```bash
cd backend
npm run migrate:local
# npm run migrate:remote — explicit, logged, backup-verified step only
```

`migrate:local`/`migrate:remote` run `wrangler d1 migrations apply`: every
not-yet-applied `src/db/migrations/*.sql` in filename order, recorded in the
database's `d1_migrations` table. Re-running after deploying a new Worker
version applies only the new migrations.

### Local development

`JWT_SECRET` is required for the issued tokens to verify. The easiest way is to
copy the example env file (gitignored once copied):

```bash
cd backend
cp .dev.vars.example .dev.vars
# then edit .dev.vars to set a real JWT_SECRET
npm run dev
```

To run on a single invocation instead:

```bash
cd backend
npx wrangler dev --var JWT_SECRET:$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

The sign-in flow has two endpoints:

```bash
# 1) request a code (always 202, even for unknown addresses)
curl -X POST http://localhost:8787/auth/request-code \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","display_name":"Test User"}'

# 2) verify the code from the email
curl -X POST http://localhost:8787/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","code":"12345678"}'
```

Use the returned `token` as:

```txt
Authorization: Bearer <token>
```

## Extension manifest update

After deployment, add the Worker URL to `public/manifest.json` host permissions.

Example:

```json
"host_permissions": [
  "https://tab-manager-cloudflare-backend.your-subdomain.workers.dev/*"
]
```

If you later move the Worker to a custom domain, update this value.

## Synced entity types

The sync endpoint accepts mutations for six entity types, all scoped to a
project via `projectId` (bound to the D1 `project_id` column, `NOT NULL` with
`ON DELETE CASCADE`):

| `entityType` | Storage               | Patch shape                                             |
| ------------ | --------------------- | ------------------------------------------------------- |
| `project`    | `projects` row        | `{ name, description?, color?, icon? }`                 |
| `collection` | `collections` row     | `{ name, description?, color?, minimized?, order? }`    |
| `link`       | `links` row           | `{ collectionId?, url, title?, favIconUrl?, tags?, … }` |
| `task`       | JSON entity (`tasks`) | `{ title, collectionId?, payload: { …flat fields } }`   |
| `note`       | JSON entity (`notes`) | `{ title, payload: { content, color, isPinned } }`      |
| `todo`       | JSON entity (`todos`) | `{ title, payload: { text, completed, category } }`     |

`task`, `note`, and `todo` are **JSON entities**: the Worker stores a `title`
column plus a `payload_json` blob (see `prepareInsertJsonEntity` /
`prepareUpdateJsonEntity` in `backend/src/lib/sync.ts`). The blob is **replaced
wholesale** on update, so the client always sends the full `payload` (the merged
entity), never a partial one. The extension builds these patches in
`src/lib/cloudflareSync/entityPatches.ts`, and folds remote rows back with the
same shape in `src/lib/cloudflareSync/applyChanges.ts` (stamping `projectId`
from each change row's `project_id`).

`project` and `collection` _creates_ are rejected on the sync endpoint — project
ids are server-authoritative (round-trip through `POST /projects`), while
collection/link/task/note/todo ids are client-authoritative.

> Bookmark-folder ids and Chrome bookmark ids are device-local and are never
> sent to the server.

## API quick test

Create a user token:

```bash
TOKEN_RESPONSE=$(curl -s -X POST https://YOUR_WORKER_URL/auth/demo \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","display_name":"Owner"}')

TOKEN=$(node -e "const fs=require('fs'); const input=JSON.parse(fs.readFileSync(0,'utf8')); console.log(input.token)" <<< "$TOKEN_RESPONSE")
```

Create a project:

```bash
curl -X POST https://YOUR_WORKER_URL/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Research","description":"Synced project","color":"#3b82f6","icon":"R"}'
```

List projects:

```bash
curl https://YOUR_WORKER_URL/projects \
  -H "Authorization: Bearer $TOKEN"
```

Sync a project. The sync endpoint accepts any combination of entity mutations —
here a `collection` create and a `note` create (a per-project JSON entity) in a
single push:

```bash
curl -X POST https://YOUR_WORKER_URL/projects/PROJECT_ID/sync \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "lastCursor": null,
    "mutations": [
      {
        "clientMutationId": "local-mutation-1",
        "projectId": "PROJECT_ID",
        "entityType": "collection",
        "entityId": "COLLECTION_ID",
        "operation": "create",
        "patch": { "name": "Articles", "order": 0 },
        "clientId": "extension-client-1",
        "createdAt": "2026-06-16T00:00:00.000Z"
      },
      {
        "clientMutationId": "local-mutation-2",
        "projectId": "PROJECT_ID",
        "entityType": "note",
        "entityId": "NOTE_ID",
        "operation": "create",
        "patch": {
          "title": "Meeting notes",
          "payload": { "content": "Follow up with team", "color": "#ffffff", "isPinned": false }
        },
        "clientId": "extension-client-1",
        "createdAt": "2026-06-16T00:00:01.000Z"
      }
    ]
  }'
```

The response returns the next `cursor`, the `changes` log since `lastCursor`
(everyone's mutations, including your echoes), and any `conflicts`.

## Token expiry cutover (harden-auth-tokens)

Access tokens used to be minted with a 30-day expiry (and the earliest tokens
with no expiry at all). This deployment switches minting to short-lived tokens
while tolerating the old ones for one migration window:

1. **Deployed now (migration window).** Every newly minted token (login
   `POST /auth/verify`, `POST /auth/renew`) carries `exp = now + TOKEN_TTL_SECONDS`
   (default 7 days, hard cap 30 days) and a unique `jti`. Verification still
   **accepts legacy tokens without `exp`** so existing installs keep working,
   and silently renews them: the extension re-mints via `POST /auth/renew`
   before expiry, so the legacy population drains on its own within days.
2. **Legacy-token visibility.** There is nothing to count at boot — legacy
   tokens are only observable when they are used. Each isolate logs its first
   legacy acceptance with a **hashed** subject (`sha256(sub)`, first 12 hex
   chars — never the raw subject, `jti`, or token) plus a running count, and
   the daily cron (`scheduled`) logs
   `legacy-token verifications since isolate start: N`. Watch for that count
   approaching zero before flipping the switch in step 3.
3. **After ≥30 days (one legacy-token lifetime), enforce expiry.** Set the
   Worker var and redeploy:

   ```bash
   npx wrangler secret put REQUIRE_EXP_ON_ALL_TOKENS   # or add to [vars]
   # value: 1
   npx wrangler deploy
   ```

   From then on, exp-less tokens are rejected as unauthenticated (401) and
   holders simply sign in again with the email code. Tokens missing only
   `jti` (but with `exp`) stay valid — strict mode enforces `exp` only.

   **Verify:** `curl -s https://tab-manager-backend.ww0.dev/me -H "Authorization: Bearer <exp-less-token>"`
   must return 401, while a freshly minted token still returns 200.

   **Rollback:** unset `REQUIRE_EXP_ON_ALL_TOKENS` (remove the var and
   redeploy). The legacy-tolerant verifier remains in place until step 4.
4. **After cutover: remove the legacy token branch in `jwt.ts`** — tracked for
   the cleanup change. Delete the `legacy` branch in `verifyJwtDetailed` (the
   `exp === undefined` tolerance), the `REQUIRE_EXP_ON_ALL_TOKENS` handling in
   `strictExpRequired`, and the once-per-isolate legacy log + counter once the
   strict flag has been on for a full token lifetime.

## Production hardening checklist

- `ALLOWED_ORIGINS` (in `backend/wrangler.toml` `[vars]`) must list the dashboard
  origin and the production `chrome-extension://<EXTENSION_ID>` origin — complete
  the `TODO(pre-deploy)` there before deploying; `*` is rejected (fails closed).
- Rotate `JWT_SECRET` if it is ever exposed.
- Verify the email sending domain (the `EMAIL` binding `from` address) before
  going live; login codes can't be delivered until it is verified.
- The login flow already rate-limits code requests per email; consider Cloudflare
   rate limiting at the edge if the Worker becomes heavily public.
- Run the test suites (`pnpm test` for the extension, `pnpm test:backend` for
  the Worker) in CI; the sync applier, action enqueue shapes, roles, and
  background sync are all covered.
- Monitor D1 usage and Worker logs in the Cloudflare dashboard.
