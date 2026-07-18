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

Apply the initial schema:

```bash
cd backend
npx wrangler d1 execute tab-manager-dev --remote --file=./src/db/migrations/0001_init.sql
```

For local testing only:

```bash
cd backend
npx wrangler d1 execute tab-manager-dev --local --file=./src/db/migrations/0001_init.sql
```

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

Optional variables:

```bash
npx wrangler secret put ALLOWED_ORIGINS
```

Example `ALLOWED_ORIGINS` value:

```txt
chrome-extension://YOUR_EXTENSION_ID,https://your-dashboard.example.com
```

If omitted, `wrangler.toml` defaults `ALLOWED_ORIGINS` to `*`. For production, restrict this value.

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

The login codes live in a new table (`0002`). Apply them locally **and** remotely:

```bash
cd backend
npm run migrate:local
npm run migrate:remote
```

`migrate:local`/`migrate:remote` run every `src/db/migrations/*.sql` file in
order. After
deploying a new Worker version, re-run `migrate:remote` to apply the new schema.

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

## Production hardening checklist

- Set `ALLOWED_ORIGINS` to your extension origin and dashboard domain only.
- Rotate `JWT_SECRET` if it is ever exposed.
- Verify the email sending domain (the `EMAIL` binding `from` address) before
  going live; login codes can't be delivered until it is verified.
- The login flow already rate-limits code requests per email; consider Cloudflare
   rate limiting at the edge if the Worker becomes heavily public.
- Run the test suites (`pnpm test` for the extension, `pnpm test:backend` for
  the Worker) in CI; the sync applier, action enqueue shapes, roles, and
  background sync are all covered.
- Monitor D1 usage and Worker logs in the Cloudflare dashboard.
