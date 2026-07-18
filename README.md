# TabSpace

A Chrome (MV3) extension that turns the new-tab page and toolbar popup into a
project-oriented workspace: organize links into **projects → collections →
links**, and keep **tasks, a calendar, notes, and todos** scoped per project.
Everything is local-first; optionally connect a self-hosted **Cloudflare**
backend to share a project with a team and sync it across browsers and devices.

Built with [Next.js](https://nextjs.org/) (static export), [React](https://react.dev/),
[TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/),
and [Zustand](https://github.com/pmndrs/zustand).

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Loading the extension in Chrome](#loading-the-extension-in-chrome)
- [How it works](#how-it-works)
- [Per-project data & cloud sync](#per-project-data--cloud-sync)
- [Import & export (JSON / CSV / HTML)](#import--export-json--csv--html)
- [Setting up cloud sync](#setting-up-cloud-sync)
- [Backend protections (rate limits, quotas, abuse protection)](#backend-protections-rate-limits-quotas-abuse-protection)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Documentation](#documentation)
- [Build & packaging notes](#build--packaging-notes)

---

## Features

- **Project-based organization.** Each project holds its own collections of links,
  and its own tasks, notes, todos, and calendar — switching projects switches the
  whole view.
- **Tab & bookmark management.** Save open windows/tabs as collections, mirror
  projects into the Chrome bookmark tree, and import bookmark folders back as
  projects/collections.
- **Quick Clips (right-click "Save to TabSpace").** Clip any page, tab, or link
  straight from the browser context menu **without opening a new tab**. Clips
  land in a top-level **Quick Clips** panel in the right sidebar, where you can
  open, remove, or **drag a clip onto any collection** to file it — the clip is
  removed from Quick Clips once the drop succeeds.
- **Advanced tasks.** Priorities, statuses, categories, tags, due dates, progress,
  subtasks, comments, activity history, templates, Kanban/list/calendar views,
  Pomodoro sessions, and bulk operations. A **Calendar** view renders tasks by
  due date (per active project).
- **Notes & todos.** Per-project rich notes (colors, pinning) and lightweight
  todos.
- **Cloud sync & collaboration (optional).** Connect a Cloudflare Worker backend
  to sync a project's links, collections, tasks, notes, and todos. Invite
  teammates with **owner / admin / editor / viewer** roles, see realtime presence,
  resolve conflicts under last-write-wins, and review a **readable activity feed**
  of who changed what (the **Share & members** dialog opens to an **Activity** tab
  showing each change with the actor's name/email and when it happened).
  Turn a local project into a cloud project from **Project menu → Edit Project →
  "Sync this project to cloud"**; if you aren't signed in yet, a dialog prompts
  you to create an account first, then converts the project once connected.
  Sign-in is **passwordless**: enter your email (and an optional display name)
  and we email you a one-time **8-digit code** you paste into the app to verify —
   no password to remember.
- **Local-first.** Without a backend the extension is fully functional; sync is an
  opt-in layer on top. Data persists in `chrome.storage`.
- **Import & export (per project).** Back up or move a project's data from the
  **Project menu → Export / Import**. Export **Collections & Links**, **Tasks**,
  **Todos**, and **Notes** (you pick which) as **JSON**, **CSV**, or **HTML**;
  re-import a JSON file with a smart merge that never duplicates or deletes
  existing data (see [below](#import--export-json--csv--html)).
- **Drag & drop**, **dark mode**, **global search**, **quick links**, and a
  background service worker that keeps cloud projects synced even when the popup
  is closed.
- **First-run onboarding.** A guided, multi-step wizard explains the core model
  (**Projects → Collections → Links & Quick Links**) the first time you open the
  app. It shows exactly once for a fresh install and is skipped automatically for
  existing users; replay it any time from **Settings → Tutorial**.

---

## Tech stack

| Concern         | Choice                                            |
| --------------- | ------------------------------------------------- |
| UI framework    | Next.js 15 (static export) + React 18             |
| Language        | TypeScript                                        |
| Styling         | Tailwind CSS + Radix UI primitives                |
| State           | Zustand (with `chrome.storage` persistence)       |
| Drag & drop     | @dnd-kit                                          |
| Extension shell | Manifest V3 (service worker + new-tab override)   |
| Backend (opt.)  | Cloudflare Worker + D1 (+ Durable Objects for RT) |
| Tests           | Jest (extension), Vitest (backend)                |

---

## Prerequisites

- **Node.js 20+**
- A package manager. The repo currently uses **pnpm** (see `pnpm-lock.yaml`);
  the `build` script calls `pnpm run …` for its sub-steps, so install pnpm:
  ```bash
  corepack enable
  # or: npm install -g pnpm
  ```
- **Google Chrome** (or any Chromium browser) for loading the unpacked extension.

---

## Getting started

Install dependencies from the repo root:

```bash
pnpm install
```

Run the type checker and the linter:

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # next lint
```

Run the unit tests:

```bash
pnpm test        # jest
```

### Build the extension

```bash
pnpm build
```

`build` chains: `lint` → `typecheck` → `next build` (static export to `out/`) →
`scripts/build-background.mjs` (bundles the MV3 service worker to `out/background.js`)
→ `post-build.js` (copies `public/manifest.json`, icons, and other extension
assets into `out/`). The resulting **`out/`** directory is the loadable extension.

> During development you can iterate with `next dev` for UI work, but the
> extension APIs (and the service worker) only run when you load the built `out/`
> folder as an unpacked extension.

---

## Loading the extension in Chrome

1. Build the extension (`pnpm build`) so the `out/` folder exists.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project's `out/` directory.
5. The extension overrides the **New Tab** page and provides a toolbar **popup**.
   Pin it from the puzzle menu for quick access.
6. After source changes: rebuild (`pnpm build`) and click the **reload** icon on
   the extension card in `chrome://extensions`.

Inspect logs/service-worker output via the **"Inspect views: service worker"**
link on the extension card, and the popup's devtools via right-click → Inspect.

---

## How it works

### State (Zustand)

All app state lives in a single Zustand store (`src/stores/appStore.ts`) and is
split into focused "action slices" under `src/stores/actions/`:

- `projectActions`, `collectionActions`, `linkActions` — the nested
  project → collection → link tree (also mirrored into Chrome bookmarks).
- `taskActions` — the advanced task system.
- `noteActions` — per-project notes.
- `uiActions` — todos, quick links, modals, panel state, onboarding, and theme.
- `cloudSyncActions` — cloud-sync status, cursors, role/flag setters, and the
  remote-change reducer bridge.
- `dragDropActions` — reorder/move links and collections.

State persists to `chrome.storage` via Zustand's `persist` middleware; a `merge`
hook runs a one-time migration to assign legacy items to the active project (see
[Per-project data](#per-project-data--cloud-sync)) **and marks onboarding
complete for any snapshot that already contains a `projects` array** (so existing
users never see the first-run wizard).

### First-run onboarding

A controlled `OnboardingWizard` (`src/components/onboarding/OnboardingWizard.tsx`)
is mounted in `AppClient` and opens automatically the first time the store
hydrates with `hasCompletedOnboarding === false`. Completion persists via the same
`persist` pipeline, so the wizard shows once per fresh install; the **Settings →
Tutorial** button calls `openOnboarding()` to replay it on demand. The open/closed
flag (`isOnboardingOpen`) is transient and excluded from persistence.

### Extension shell (Manifest V3)

`public/manifest.json` declares an MV3 extension: a **service worker**
(`background.js`, built from `src/background/index.ts`) and a **popup / new-tab**
page (`index.html`, the Next.js export). The worker owns the periodic cloud-sync
alarm, the coordination lock, **and the "Save to TabSpace" context menu**; the
popup owns the UI and interactive sync.

#### Quick Clips & the "Save to TabSpace" context menu

Right-clicking a page or link shows **Save to TabSpace**. The click is handled
entirely in the service worker (`src/background/quickClip.ts`): it resolves the
target URL/title, skips internal URLs (`chrome://`, `about:`, `data:`, …), and
appends a `QuickClip` to a **top-level** `chrome.storage.local` key
(`tabspace-quick-clips`) — deliberately **outside** the project/collection model.
No tab or popup is opened.

The right-sidebar **Quick Clips** panel (`src/components/right-vertical-tabs`)
subscribes to that key and lists the clips. Each clip is draggable via
`@dnd-kit`; dropping one onto any collection calls `addLink` to file it into the
project and then `removeQuickClip` so it disappears from Quick Clips. The shared
logic lives in `src/lib/quickClips.ts` so the worker and the UI use one source of
truth.

### Cloud sync pipeline (optional)

When connected, sync is a local-first mutation queue:

1. A local edit on a **cloud-enabled** project calls `enqueueCloudChange(...)`,
   which no-ops unless sync is enabled **and** the owning project is
   `cloudEnabled`. Otherwise it appends a mutation to a persisted queue.
2. **Push/pull** (`syncProjectNow`) sends queued mutations to
   `POST /projects/:id/sync` and pulls change-log rows since the last cursor.
3. **Apply** (`applyRemoteChanges`) folds remote rows into the store, skipping
   this client's own echoes. Unrelated fields merge independently (true
   field-level merge). When a remote change would overwrite a field this client
   has a _pending, not-yet-pushed_ edit for, it is kept locally and surfaced as a
   resolvable conflict (Keep mine / Take theirs / Merge) in the Cloud Sync panel
   instead of being silently dropped.
4. The **background service worker** runs the same flow on an alarm so cloud
   projects stay current while the popup is closed; an advisory lock prevents
   the popup and the worker from double-syncing.

The backend (`backend/`) is a Cloudflare Worker over a D1 database — see
[`deployment.md`](./deployment.md).

---

## Per-project data & cloud sync

Tasks, notes, todos, and (task-derived) calendar entries are **scoped to the
active project**. Every item carries a `projectId`; the views filter by the
active project, and new items are always stamped with the active project at
creation.

- **Creation** stamps `activeProjectId` on every new note/todo/task.
- **Views** (`NotesView`, `TodosView`, `TasksView`) filter by the active project.
  The full-width global **Tasks** route intentionally shows tasks across all
  projects (a cross-project dashboard).
- **Migration** — on rehydrate, any pre-existing item lacking a `projectId` is
  assigned to the active (or first) project, so nothing is orphaned.
- **Project delete** cascades locally to that project's notes/todos/tasks (the
  backend cascades via `ON DELETE CASCADE`).

### Cloud sync write path (Phase B)

Notes, todos, and tasks now push to the cloud just like collections and links:

- **Write path.** `addNote/updateNote/deleteNote`, `addTodo/toggleTodo/removeTodo`,
  and `addTask/updateTask/deleteTask` enqueue cloud mutations. Each carries the
  entity's full payload (`{ title, payload: { … } }`) because the backend stores
  these as a `title` column plus a `payload_json` blob and **replaces** the blob
  wholesale on update — so the merged entity is always sent. Patch shapes live in
  [`src/lib/cloudflareSync/entityPatches.ts`](./src/lib/cloudflareSync/entityPatches.ts).
- **Read path.** Incoming note/todo/task change rows are stamped with
  `projectId` from the change row's `project_id` (authoritative), so remote items
  always land in the right project. `projectId` is immutable once set.
- **Convert to cloud.** Turning a local project into a cloud project re-keys the
  project (and its flat notes/todos/tasks) to the server id and backfills
  `create` mutations for every existing item, so the server mirrors local state
  on the next sync. The entry point is **Project menu → Edit Project → "Sync this
  project to cloud"**, which is always shown for local (non-cloud) projects. If
  cloud sync isn't connected yet, the button opens a **Connect to Cloud Sync**
  dialog (email + display name) so you can sign in / create an account; the
  project is converted automatically once the connection succeeds. The same
  connect dialog also appears after creating a **new** project with "Sync this
  project to cloud" checked while not signed in — the project is created locally
  first, then converted once you connect.

> Scope note: pin toggles, note/task duplication, task archiving, and subtasks
> **are** cloud-synced (the patch builders carry `isPinned`, `isArchived`,
> `subtasks`, `isFavorite`, etc., and every action enqueues a mutation). On a
> shared project, concurrent edits to the _same field_ are detected and surfaced
> as resolvable conflicts rather than being lost to last-write-wins; live
> co-editing presence soft-locks a field while a collaborator is editing it.
> See [`PER_PROJECT_VIEWS_SYNC_PLAN.md`](./PER_PROJECT_VIEWS_SYNC_PLAN.md).

---

## Import & export (JSON / CSV / HTML)

Each project can be backed up or moved via the **Project menu → Export / Import**
(gear icon on a project). This is fully local-first — no backend required.

### Export

The export modal lets you **pick which sections** to include — any combination of
**Collections & Links**, **Tasks**, **Todos**, and **Notes** — and choose a
**format**:

- **JSON** — a single structured file (`{ version, exportedAt, project,
  tasks, todos, notes }`). This is the only format that round-trips back through
  Import.
- **CSV** — one flat spreadsheet per selected section (e.g. `Project_links.csv`,
  `Project_tasks.csv`); handy for spreadsheets or other tools. Links are flattened
  with their collection name, tasks/todos/notes with their key fields.
- **HTML** — a self-contained, read-only report for printing or sharing.

### Import (smart merge)

Only **JSON** files can be imported. After picking a file it is validated and
shown as a **preview** with the target and how many items would be **added**,
**updated**, or **skipped**. You then choose where the data goes:

- **New project** — imports into a freshly created project. If a project with the
  same id already exists (e.g. re-importing the same file), it **merges** into
  that one instead of creating a duplicate.
- **Existing project** — imports into a project you pick from a dropdown.

The merge is **safe and idempotent**:

- Entities are matched by `id` first → the existing item is **updated**.
- Otherwise they are matched by **content** (same link URL, note title + content,
  todo text, or task title within the target project) → the duplicate is
  **skipped**.
- Anything genuinely new is **added**.
- Nothing already in the store and absent from the file is ever **removed**.

### Implementation

- `src/lib/importExport/exportProject.ts` — builds the bundle from the store and
  serializes it to JSON / CSV / HTML, then triggers the download.
- `src/lib/importExport/importProject.ts` — parses/validates the file, computes
  the add/update/skip preview, and applies the merge (mirroring the cloud-sync
  `applyRemoteChanges` upsert-by-id pattern).
- `src/lib/importExport/schema.ts` — zod validation + task sanitization.
- `ExportProjectModal` / `ImportProjectModal` wire the flow into the project menu.

---

## Setting up cloud sync

Cloud sync is optional. To enable it:

1. Deploy the backend Worker + D1 database — full instructions in
   [`deployment.md`](./deployment.md).
2. Add the Worker URL to `public/manifest.json` → `host_permissions` and rebuild.
3. In the extension, open **Settings → Cloud Sync**, enter the Worker URL, and
   sign in. Sign-in is passwordless: submit your email (and optional display
   name), we email you an 8-digit code, and you paste it into the 8-box code
   field to verify and connect. Codes are valid for ~10 minutes and can be
   re-sent; see [`deployment.md`](./deployment.md) for the email-binding setup.
4. Create a cloud project (tick **"Sync this project to cloud"** when adding one —
   if you aren't signed in yet, you'll be prompted to connect first, then the
   project converts automatically), or convert an existing local project to cloud
   from **Project menu → Edit Project → "Sync this project to cloud"**, then
   invite teammates via a share code.
5. Open **Project menu → Share & members** on a cloud project to manage members,
   roles, and invites, and to review the **Activity** tab — a readable history of
   every change. Each row shows the operation, the entity type, the actor
   (display name or email, joined server-side so it's visible to all roles), and a
   relative timestamp (hover for the absolute time). Use **Refresh** to pull the
   latest changes.

---

## Backend protections (rate limits, quotas, abuse protection)

The backend is hardened with defense-in-depth edge controls. These are additive
and safe by default — every threshold has a sensible default and is overridable
via an environment variable (no code changes needed). See
[`deployment.md`](./deployment.md) for the binding/migration setup.

### Rate limiting

A `RateLimiter` Durable Object enforces a precise sliding-window counter, one
instance per rate-limit key. Limits are enforced at the Worker entrypoint,
**before routing** (and skipped for `OPTIONS` preflight):

| Tier              | Key                                  | Default (per 60s) |
| ----------------- | ------------------------------------ | ----------------- |
| Global per-IP     | `rl:global:ip:<ip>`                  | 120               |
| Authenticated API | `rl:api:user:<sub>` (fallback `:ip`) | 300               |
| Sync              | `rl:sync:user:<sub>` (fallback `:ip`)| 60                |
| Auth request-code | `rl:auth:request:ip:<ip>`            | 10                |
| Auth verify       | `rl:auth:verify:ip:<ip>`             | 20                |

- On breach: `429` with `Retry-After` and `X-RateLimit-Limit` /
  `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers.
- On success: the enforced tier's `X-RateLimit-*` headers are attached to the
  response.
- Overrides: `RATE_LIMIT_GLOBAL_PER_IP`, `RATE_LIMIT_API_PER_USER`,
  `RATE_LIMIT_SYNC_PER_USER`, `RATE_LIMIT_AUTH_REQUEST`, `RATE_LIMIT_AUTH_VERIFY`.

### Usage quotas

Enforced inside the domain handlers, returning `403` (or `400` for the
sync-mutation cap) with a structured error:

- **Max projects per user** — default `10` (`QUOTA_MAX_PROJECTS_PER_USER`).
- **Max members per project** — default `50` (`QUOTA_MAX_MEMBERS_PER_PROJECT`).
- **Max entities per project** (collections + links + tasks + notes + todos) —
  default `5000` (`QUOTA_MAX_ENTITIES_PER_PROJECT`).
- **Max sync mutations per request** — default `200`
  (`QUOTA_MAX_SYNC_MUTATIONS_PER_REQUEST`); exceeding it returns `400`.

### Abuse protection

- **Request-body size limit** — JSON bodies over `1 MB` (default) are rejected
  with `413 Payload Too Large`, applied to **all** JSON endpoints including auth.
  Shared `readJson` helper used by routing and auth parsing.
- **Security headers** on every response (success and error):
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and
  `Referrer-Policy: strict-origin-when-cross-origin`.

All overrides are documented in `backend/.dev.vars.example`.

---

## Testing

```bash
pnpm test                 # extension unit tests (jest)
pnpm test:backend         # backend typecheck + tests (vitest)
pnpm test:all             # both
```

The cloud-sync applier, action enqueue shapes, role helpers, coordination lock,
realtime messages, and background sync are all covered. Tests run under jsdom;
`jest.setup.ts` polyfills `structuredClone` and `crypto.randomUUID` for the
jsdom environment.

---

## Project structure

```
.
├── public/                 # manifest.json, icons (copied into out/ at build)
├── src/
│   ├── app/                # Next.js app (entry, layout, global styles)
│   ├── background/         # MV3 service worker source (→ out/background.js)
│   ├── components/         # UI: views, panels, modals, cloud-sync, sidebar, …
│   │   ├── onboarding/     # OnboardingWizard (first-run guided tour)
│   │   └── views/          # NotesView, TodosView, TasksView, TaskCalendarView, …
│   ├── lib/
│   │   ├── cloudflareSync/ # client: queue, API, applier, orchestrator, realtime
│   │   ├── importExport/   # per-project export (JSON/CSV/HTML) + smart import
│   │   ├── bookmarkStorage.ts, bookmarkSyncService.ts  # bookmark tree bridge
│   │   └── tabService.ts   # chrome.tabs / chrome.windows helpers
│   ├── stores/             # Zustand store + action slices
│   │   ├── appStore.ts     # store definition, persistence, migration
│   │   ├── types.ts        # AppState, Note, …
│   │   └── actions/        # project/collection/link/note/task/ui/cloudSync/…
│   └── types/              # shared domain types (Project, Link, tasks.ts, …)
├── backend/                # Cloudflare Worker + D1 (sync, auth, collaboration)
├── scripts/                # build-background.mjs, favicon tooling
├── docs/                   # feature/feature design docs
├── deployment.md           # backend deploy guide
└── BUILD_INSTRUCTIONS.md   # build + load-the-extension walkthrough
```

---

## Documentation

- [`BUILD_INSTRUCTIONS.md`](./BUILD_INSTRUCTIONS.md) — build and load the extension.
- [`deployment.md`](./deployment.md) — deploy the Cloudflare backend (D1, secrets,
  realtime Durable Object, API quick-test).
- [`PER_PROJECT_VIEWS_SYNC_PLAN.md`](./PER_PROJECT_VIEWS_SYNC_PLAN.md) — design for
  per-project tasks/notes/todos + cloud sync (Phase A scoping, Phase B write path).
- [`docs/`](./docs/) — feature deep-dives (bookmark sync, enhanced tasks, favicons).

---

## Build & packaging notes

- The extension is a **static export**; `next build` outputs `out/`, which is the
  directory you load unpacked.
- The MV3 service worker is bundled separately (`scripts/build-background.mjs`)
  because Next.js doesn't emit a worker entry; it lands at `out/background.js`.
- `post-build.js` stages `manifest.json`, icons, and other extension assets into
  `out/` so the folder is self-contained.
- Bookmark-folder ids and Chrome bookmark ids are **device-local** and never sent
  to the cloud — only canonical entity data is synced.
