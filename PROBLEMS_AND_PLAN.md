# TabSpace — Deep Problem Analysis & Remediation Plan

_Generated 2026-10-20 from a full audit of `src/`, `backend/`, `frontend/`, build pipeline, and configs._

## 0. Baseline (what already passes)

| Check | Result |
|---|---|
| `pnpm run typecheck` | ✅ clean |
| `pnpm test` (jest) | ✅ 29 suites / 144 tests |
| `pnpm run test:backend` (vitest) | ✅ 11 files / 61 tests |
| `pnpm run build` | ✅ succeeds |

**All detected problems are therefore runtime, security, architectural, and consistency problems — not compile errors.** Several tests pass *because the mocks don't model real behavior* (noted explicitly below).

---

## 1. Problem inventory

Severity legend: 🔴 Critical (data loss / exploitable now) · 🟠 High · 🟡 Medium · ⚪ Low / hygiene.

### A. Extension runtime — data loss & concurrency

| # | Sev | Problem | Where | Why it matters |
|---|---|---|---|---|
| A1 | 🔴 | **Popup, every newtab, and the background worker all write the entire app state to one `chrome.storage.local` blob, last-writer-wins.** The only cross-context refresh (`CloudSyncRealtime.tsx`) triggers only on cloud-sync timestamp changes. Local-only edits made in one context are silently clobbered by another. | `public/manifest.json` (popup + newtab share `index.html`), `src/stores/appStore.ts:99-109`, `src/stores/storage.ts`, `src/components/cloud-sync/CloudSyncRealtime.tsx:64-112` | A user with one newtab open who uses the popup loses edits. This is the *default* operating mode (no cloud sync needed). |
| A2 | 🔴 | **Background sync releases its advisory lock *before* writing the store** (`finally` → then `applyToStore`), the opposite of the popup path which writes inside the lock. A concurrent "Sync now" can read/write between release and write. | `src/lib/cloudflareSync/backgroundSync.ts:123-128,270` vs `src/lib/cloudflareSync/orchestrator/sync.ts:86-88` | Lost-update window between background pull and popup pull. |
| A3 | 🔴 | **Rehydrate (`mergeAppState`) replaces `projects/notes/todos/tasks` arrays wholesale** with the persisted snapshot. Any in-flight edit in the current context is reverted when the other context persists. | `src/stores/mergeAppState.ts:54-56` | Non-deterministic, user-visible data loss tied to the 5-minute background sync alarm. |
| A4 | 🔴 | **The onboarding wizard can never be completed by a genuinely new user.** `partialize` always persists a `projects` array; `mergeAppState` then forces `hasCompletedOnboarding: true` whenever a snapshot *has* projects — i.e. after the very first store write, even if the user closed the wizard without finishing. Contradicts the stated design in `AppClient.tsx:134-142`. | `src/stores/appStore.ts:139`, `src/stores/mergeAppState.ts:115-118` | First-run feature effectively broken; also an existing-user trap if they dismiss early. |
| A5 | 🔴 | **Bookmark-event sync drops events and fakes mutual exclusion.** Events arriving mid-sync are discarded (`if (syncInProgress) return`); the feedback-loop suppressor is a `setTimeout(…, 100)` restore; `performPartialSync`'s "debounce" schedules one full sync per event (N events → N full syncs). | `src/lib/sync/syncHandlers.ts:14,37,54,80`, `src/lib/bookmarkStorage.ts:71-86,116-131,168-184`, `src/lib/bookmarkSyncService.ts:115-119` | Missed bookmark changes, sync storms, feedback loops. |
| A6 | 🟠 | **Destructive one-way bookmark sync with name-based matching.** Projects/collections are *deleted locally* when their bookmark folder vanishes (no trash/confirm), evaluated against a stale pre-`Promise.all` snapshot; new folders are matched to entities **by display name** — two folders with the same title stamp the wrong entity. | `src/lib/sync/projectSync.ts:36-46,71-73`, `src/lib/sync/collectionSync.ts:57-64,88-90`, `src/stores/actions/uiActions.ts:324-342` | Real data destruction + mislinked entities. |
| A7 | 🟠 | **Every long-lived newtab runs its own tab auto-saver** (3 chrome.tabs listeners + 30 s `setInterval`) against the same `current_tab_session` storage key — N unsynchronized read-modify-writers; session-restore check also runs per context. | `src/components/AppClient.tsx:159-196`, `src/lib/tabSessionService/autoSave.ts:116-156` | Same lost-update shape as A1; wasted work per context. |
| A8 | 🟠 | **Sync conflict handling is silently lossy.** Conflicted mutations are deleted from the queue with only a status string; `applyResolution` returns `{}` for anything but task/note; `pushResolvedValue` handles only task/note — link/collection/todo conflicts silently do nothing. `syncProjectNow` reads cursors *before* acquiring the lock. | `orchestrator/sync.ts:56-66`, `stores/actions/cloudSyncActions.ts:265-332`, `sync.ts:22 vs 44` | Users "resolve" conflicts that don't actually apply. |
| A9 | 🟠 | **Advisory sync lock is non-renewing and admitted-racy**, and there is no fetch timeout anywhere (`client.ts` has no `AbortController`), so a hung request lets another context steal the 60 s lock and run a second concurrent sync. | `src/lib/cloudflareSync/syncLock.ts:8-26`, `client.ts:89-93` | Concurrent syncs → duplicates/conflicts. |
| A10 | 🟡 | **`partialize` error fallback returns `{}`**, so a transient error persists an (almost) empty snapshot **over the user's real data**. | `src/stores/appStore.ts:182-185` | Potential catastrophic wipe on an edge case. |
| A11 | 🟡 | **Hydration gating is dead code; default state is non-deterministic.** `StoreWrapper.checkStore` always succeeds synchronously (children render with mock data then swap); the mock default project id is `nanoid()` at module load — different per context. Build log confirms: store code runs during static prerender. | `src/stores/storeWrapper.tsx:23-47`, `src/stores/mockData.ts:10-22` | Flash of mock "Work" project; two contexts can start with *different* default ids. |
| A12 | 🟡 | **Selector wrappers swallow real bugs** (`useSafeAppStore`, `useAppStoreWithDefaults` try/catch + fallback + per-render console.warn). Single root `ErrorBoundary` with no reset and no per-region isolation. Fire-and-forget bookmark ops inside `moveLink`'s `set()`. | `src/stores/appStore.ts:237-249`, `src/hooks/useAppStoreWithDefaults.ts:27-60`, `src/components/ErrorBoundary.tsx`, `stores/actions/dragDropActions.ts:84-108` | Bugs become silently-wrong UI instead of errors. |
| A13 | ⚪ | `sortOption`/`searchFilters` not persisted (reset each launch); `setHasHydrated` defined twice (dead copy in uiActions); `bookmarkSyncService.destroy()` removes `.bind()`ed refs (no-op leak); 33 stray `console.log`s in page contexts; triplicated "URL already in collection" logic; hardcoded API URL in two places; ~15 unnamed icon-only buttons in TabSessionsPanel. | see report | Hygiene, a11y, minor leaks. |

### B. Backend — security & correctness

| # | Sev | Problem | Where | Why it matters |
|---|---|---|---|---|
| B1 | 🔴 | **Cross-project IDOR in the sync mutation engine.** `entityExists()` and every `prepareUpdate*`/`delete` filter by entity `id` only — never by the route's `project_id`. Missing `baseVersion` skips the version check entirely. An update **moves** a foreign project's task/note/todo into the attacker's project (fan-out then replicates the data to the attacker's members → exfiltration); link/collection updates overwrite foreign content; deletes tombstone foreign entities. Requires only an editor role in *any* one project plus entity UUIDs (which every former member retains). | `backend/src/lib/sync/queries.ts:4-31`, `sync/statements/jsonEntity.ts:79-124`, `link.ts:138-156`, `collection.ts:127-144`, `sync/mutations.ts:264-274`, `applyMutation.ts:56-92` | Privilege-escalation + data theft/destruction across projects. **Top security fix.** |
| B2 | 🔴 | **Quota "atomicity" is fictional.** D1 `batch()` has no conditional execution — dependents run even when the guard inserts 0 rows. Results: project-creation at cap → FK violation → 500 instead of 403; invitation acceptance at member cap → **invitation burned with no membership**; entity-creation at cap → **phantom changelog `create` rows** that other clients dutifully apply. Tests pass only because the mock D1 ignores FK semantics. | `backend/src/lib/quotas.ts:79-89`, `crud.ts:73-96`, `invitations.ts:200-208`, `sync.ts:158-171`, `__tests__/quotas.concurrent.test.ts:52-93` | Broken quota enforcement corrupts shared state. |
| B3 | 🔴 | **Migration 0003 rebuilds `users`/`projects` via `DROP TABLE`+rename.** With D1's default FK enforcement, dropping `projects` cascades through *all* child tables — on a populated DB this is either mass data loss or a hard failure. Migrations are chained `&&` shell commands (not `wrangler d1 migrations`), so a mid-chain failure leaves an unknown state. | `backend/src/db/migrations/0003_drop_e2e.sql:22-52`, `backend/package.json` scripts | Production-migration landmine. |
| B4 | 🔴 | **CORS: wildcard origin reflection with `Allow-Credentials: true`.** Default allow-list is `['*']` and production `wrangler.toml` sets `ALLOWED_ORIGINS = "*"`; preflight echoes arbitrary methods/headers. Limited today (bearer auth, no cookies) but invalid-by-spec and account-compromising the moment cookie auth lands. | `backend/src/lib/cors.ts:3-53`, `backend/wrangler.toml:14` | Standards-violating, forward-dangerous config. |
| B5 | 🟠 | **Concurrency is advisory everywhere.** Version CAS doesn't exist (read outside the write, unconditional `version = version + 1`); `client_mutation_id` has no UNIQUE constraint (concurrent duplicates double-apply); login-code attempts are read-then-increment and success is check-then-delete → concurrent verifies both mint tokens / exceed attempt caps. | `applyMutation.ts:32-92`, `statements/changelog.ts:3-19`, `0001_init.sql:128-129`, `auth/login.ts:160-203` | Lost updates and brute-force weakening. |
| B6 | 🟠 | **Realtime revocation gap + volatile rate limits.** Sockets are authorized only at upgrade; `removeMember`/role changes never close `ProjectRoom` sockets — a removed editor keeps a live feed of all changes until they disconnect. Rate-limiter windows are memory-only in the DO (any eviction resets them; the `alarm()` cleanup deletes nothing). | `backend/src/index.ts:436-453`, `membership.ts:207-295`, `realtime.ts:151-157`, `ratelimit.ts:59,107-116` | Ex-members retain data access; brute-force protection weaker than it looks. |
| B7 | 🟠 | **Internal errors leak to clients as "conflicts".** D1/SQL error messages go into `SyncConflict.message`; genuine infrastructure failures are reported as data conflicts, so clients never retry → silent divergence. | `applyMutation.ts:111-123,171-183`, `mutations.ts:217-229` | Info disclosure + silent data divergence. |
| B8 | 🟠 | **Missing indexes on hot paths.** No `project_id` index on collections/links/tasks/notes/todos (every guarded create runs a 5-table `COUNT(*)`; `/snapshot` scans); no `project_members(user_id)` index; `sync_changes` grows unboundedly with full-payload rows and no pruning. | `0001_init.sql:34-107,31,155-156`, `snapshot.ts:127-139` | Latency and cost grow linearly with data. |
| B9 | 🟡 | **Sync scalability:** updates/deletes apply serially, ~5–6 D1 round-trips each → a max sync (200 mutations) is ~1,000+ subrequests (at/over the Workers ceiling, far over free tier); `notifyRealtime` awaited in request path. | `sync.ts:173-192` | Large projects will hit hard platform limits. |
| B10 | 🟡 | **JWT weaknesses:** tokens without `exp` never expire; 30-day tokens, no refresh/revocation/`jti`; token plaintext in `chrome.storage.local`; realtime token in `?token=` query (log leakage); JWT verified twice per request + a D1 upsert on *every* authed call. | `jwt.ts:102,145-177`, `login.ts:207-217`, `index.ts:435` | Long-lived irrevocable credentials. |
| B11 | 🟡 | **Privilege-model inconsistencies:** project delete requires only *admin* (owner not required), while member removal is owner-only; `updateProject` doesn't trim/validate names; mismatched update/delete mutations are silently `continue`d while mismatched creates return a conflict — clients get no signal their write was dropped. | `crud.ts:181,128-132`, `mutations.ts:55`, `sync.ts:108-118,175` | Surprising authorization holes. |
| B12 | 🟡 | **Manual, spotty input validation (no zod anywhere).** `expiresInDays` unbounded (`-5` … `1e9`); no length limits on names/descriptions/tags/payloads up to the 1 MB body; shape checks are scattered `as` casts. | `invitations.ts:49-56`, `crud.ts:33-42`, `link.ts:22-24`, `jsonEntity.ts:17-19` | Garbage-in, storage abuse. |
| B13 | ⚪ | Login codes stored plaintext; `b % 10` modulo bias; expired codes/invitations never cleaned; `display_name` from the request body lands in the login email (greeting-injection phishing vector) and can be set permanently by an attacker pre-verify; `.dev.vars.example` documents a nonexistent demo-auth endpoint; `X-Forwarded-For` trusted over `CF-Connecting-IP` in dev. | `login.ts` various, `email.ts:37-39` | Hardening. |

### C. Architecture, repo & tooling

| # | Sev | Problem | Where |
|---|---|---|---|
| C1 | 🟠 | **God-object store**: one `AppState` with ~100 action signatures and a single persistence blob is the *root cause* of the entire A-section (every context persists everything). Actions are split across ~15 files but state+persist is not. | `src/stores/types.ts`, `appStore.ts` |
| C2 | 🟠 | **`frontend/` "tabspace-web" reuses extension source via tsconfig `@/*` shadowing** and mirrors the whole dependency list "to guarantee identical resolution" — two dependency manifests and shadowed/copied files that will drift silently. | `pnpm-workspace.yaml` comment, `frontend/` |
| C3 | 🟡 | **Dead dependencies**: `firebase` (0 imports anywhere), `cheerio` (0 imports), `fs-extra` (0 imports); `moment` kept for exactly one file (`TaskCalendarView`) while `date-fns` is also a dependency; `react-big-calendar` + `react-day-picker` + `recharts` calendar/chart overlap. | `package.json`, `src/components/views/TaskCalendarView.tsx:2-4` |
| C4 | 🟡 | **No CI.** No `.github/`; lint/typecheck/tests/build only run when someone remembers. | repo root |
| C5 | 🟡 | **Mixed package managers & migration strategy**: pnpm at root, npm lockfiles in `backend/` and frontend deps; D1 "migrations" are chained `&&` shell commands repeated in two scripts. | root `package.json`, `backend/package.json` |
| C6 | 🟡 | **Stale artifacts & drift**: `out/` (old export dir, contains a nested `build/`), `dist/` with `tabspace-0.1.0.zip`, `.next/`, `.swc/` — while `next.config.ts` uses `distDir: 'build'`; `manifest.json` version **0.1.2** vs `package.json` **0.1.1** vs packaged zip 0.1.0; empty `.modified` file; `TODO.md` references the obsolete `out/` flow. | repo root, `public/manifest.json` |
| C7 | ⚪ | `scripts/update-favicons.js` is a dead one-off that cannot run as written (imports commented out); debug routes `/debug-favicons` and `/favicon-migration` ship in the production bundle (confirmed in build output); root `.env` holds an unused `GEMINI_API_KEY` (verified not referenced in code or bundle — inert but should not live here). | `scripts/`, `src/app/debug-*` |

---

## 2. Remediation plan

Ordering principle: **security first (B), then stop data loss (A), then architecture (C)** — but Phase 0 (safety nets) precedes everything because several fixes touch sync/storage logic that only integration tests can validate.

### Phase 0 — Safety nets (½ day)
1. **Add CI** (`.github/workflows/ci.yml`): lint + typecheck + jest + backend vitest + `pnpm run build` on every PR. (Fixes C4.)
2. **Set a real `ALLOWED_ORIGINS`** (extension origin `chrome-extension://<ID>` + dashboard origin) in `wrangler.toml`; fail closed when unset. (B4, ~15 min.)
3. **Freeze production migrations**: do not run `migrate:remote` until B3 is done; adopt `wrangler.toml [migrations]` + `wrangler d1 migrations` instead of chained scripts. (C5.)
4. Version single-source: derive `manifest.json` version from `package.json` in `post-build.js`; delete stale `out/`, `dist/`, `.next/`, `.swc/`, `.modified`. (C6.)

### Phase 1 — Backend security (2–4 days)
1. **B1 IDOR**: thread `project_id` into `entityExists`, `getEntityVersion`, every `prepareUpdate*` and delete; require `baseVersion` for updates (reject if absent); write changelog rows to the *entity's* project; add regression tests: editor of project A cannot read/mutate/move/delete project B entities.
2. **B2 quotas**: split each guarded batch into *guard → check `meta.changes` → dependents* (two round-trips), or make dependents conditional on the guard (`INSERT … SELECT … WHERE changes()`-style). Rewrite quota tests against **real D1 semantics** (miniflare / `@cloudflare/vitest-pool-workers` — also fixes the "vitest runs plain Node" test gap).
3. **B3 migration**: rewrite 0003 to avoid table rebuilds (additive column drops / copies with FKs temporarily disabled is not available in D1 → prefer new-table + copy + verified counts + rename inside a single migration run on a DB **copy** first).
4. **B5 concurrency**: `UNIQUE` index on `sync_changes.client_mutation_id`; CAS updates (`UPDATE … SET version = version + 1 WHERE id = ? AND version = ?` and check `meta.changes`); login-code attempts via single atomic `UPDATE … WHERE attempts < max`; consume code via `DELETE … RETURNING`.
5. **B6 revocation + rate limits**: on `removeMember`/role change, post to the project DO to close that user's sockets; persist sliding-window state to DO storage (write-through with in-memory fast path).
6. **B7 error contract**: map D1 errors to 5xx + `retryable` flag; never embed raw error text in conflict messages.
7. **B11/B12 hardening**: project delete → owner-only; zod schemas for every body; bound `expiresInDays` (1–30); string-length limits; trim/validate names symmetrically; report per-mutation status for skipped mutations.

### Phase 2 — Extension data-loss fixes (3–5 days)
1. **Single-writer discipline (A1/A2/A3)** — pragmatic sequence:
   a. Hold the sync lock **across** `applyToStore`/`applyReconcileToStore` in `backgroundSync.ts` (match the popup path).
   b. Add a monotonic `stateGeneration` counter to the persisted blob; every context reads it, and before `writeStoreRaw` verifies generation unchanged — on mismatch, **re-merge instead of overwrite**.
   c. Subscribe to `chrome.storage.onChanged` in every context and re-run rehydrate with the fixed merge (next item), replacing the `CloudSyncRealtime`-timestamp-only trigger.
2. **Fix `mergeAppState` (A3)**: merge lists by entity `id` with `updatedAt` comparison instead of wholesale array replacement; never revert entities that are newer locally or absent from the snapshot but present locally.
3. **Fix onboarding (A4)**: persist `hasCompletedOnboarding` only as the explicit flag; delete the `Array.isArray(projects) → true` inference; add a jest case: "fresh install → wizard shows → close without finishing → reload → wizard shows again".
4. **Deduplicate tab auto-save (A7)**: move auto-save + session-restore checks into the background service worker only; page contexts send messages instead of writing storage.
5. **Bookmark sync rework (A5/A6)**: queue events during sync and drain after (no drops); replace the `setTimeout` suppressor with try/finally around an "applying-bookmarks" flag; real trailing-edge debounce for partial sync; match new folders by `bookmarkFolderId` only — never by name; make folder-disappearance a **soft delete / trash** with confirmation instead of immediate local deletion.
6. **Lock hardening (A9)**: `AbortController` timeout (30 s) on all sync fetches; lock heartbeat via `chrome.alarms` while a sync is running.
7. **Smaller guards (A8/A10/A11/A12)**: keep conflicted mutations in the queue until resolution applies; implement `applyResolution`/`pushResolvedValue` for link/collection/todo; `partialize` error → skip the write (never `{}`); stable default ids in `mockData`; delete the dead `StoreWrapper` gating or make it actually await hydration; drop the selector-swallowing wrappers in favor of correct selectors + error boundaries per major region (with a Reset button).

### Phase 3 — Backend performance & scale (1–2 days, after Phase 1)
1. Batch/parallelize update+delete mutations within D1 limits (target: ≤ 10 round-trips per sync); move `notifyRealtime` to `ctx.waitUntil`.
2. Add the missing indexes: `project_id` on all five entity tables, `project_members(user_id)`, `invitations(project_id)`; add a D1 changelog-pruning alarm (e.g. keep 90 days / N rows per project).
3. Paginate `/snapshot` (or compress) for large projects; guard realtime fan-out payload size (split into chunks).

### Phase 4 — JWT & auth polish (1 day)
1. Require `exp`; shorten access tokens (e.g. 7 days) with silent renewal on sync (or refresh-token rotation); add `jti`.
2. Stop passing the realtime token as a query param (use a `Sec-WebSocket-Protocol` subprotocol or one-time ticket endpoint).
3. Verify the JWT once per request; cache the `users` upsert (only when claims change).

### Phase 5 — Cleanup & consistency (1–2 days)
1. **Dependencies**: remove `firebase`, `cheerio`, `fs-extra`; remove `moment` by either dropping `react-big-calendar` in favor of the existing `react-day-picker`-based calendar or isolating moment to that single import (pick one date library: `date-fns`).
2. **Dead code**: delete `MainLayout.tsx`, `scripts/update-favicons.js`, the duplicate `setHasHydrated`, debug routes (or gate them behind an env check that's false in production builds), strip page-context `console.log`s (keep `console.debug` in the SW where it's intentional).
3. **Single source of truth**: one `DEFAULT_API_BASE_URL` constant imported by the store and config; deduplicate the triplicated URL-in-collection check in `useDragEnd.ts`.
4. **Frontend workspace (C2)**: extract genuinely shared modules into a workspace package (e.g. `packages/shared`) with its own tsconfig, imported by both `src` and `frontend/src` — no more `@/*` shadowing; let `frontend/package.json` depend on the workspace instead of mirroring the dependency list.
5. **One package manager**: bring `backend/` under pnpm workspaces (drop `package-lock.json`); keep npm only if wrangler tooling requires it.
6. **A11y pass**: name all icon-only buttons (`aria-label`) starting with `TabSessionsPanel`; persist `sortOption`/`searchFilters`.

### Phase 6 — Tests that would have caught this (1–2 days, parallel with Phase 5)
1. **Cross-context storage test**: two store instances over one mocked `chrome.storage`, interleaved writes → assert no clobber (regression for A1/A2/A3).
2. **Backend integration tests on real D1** (miniflare): IDOR matrix, quota-breach commit paths, invitation-accept race, login-code brute force.
3. **Bookmark sync**: queue-drain test, duplicate-folder-name test, folder-deleted → trash test.
4. **Onboarding**: fresh-install flow test (see Phase 2.3).

---

## 3. Suggested execution order & timeboxes

| Order | Phase | Effort | Risk if skipped |
|---|---|---|---|
| 1 | Phase 0 (CI, CORS, migration freeze, versions) | ½ d | Unsafe foundation for everything else |
| 2 | Phase 1 (backend security) | 2–4 d | Exploitable IDOR, corrupt quotas |
| 3 | Phase 2 (extension data loss) | 3–5 d | Ongoing silent user-data loss |
| 4 | Phase 3 (scale) | 1–2 d | Hard platform limits at real usage |
| 5 | Phase 4 (JWT) | 1 d | Long-lived irrevocable tokens |
| 6 | Phase 5+6 (cleanup + tests) | 2–4 d | Regressions, drift |

**Total: roughly 10–16 focused working days.** Phases 1 and 2 are independent of each other and can proceed in parallel.

## 4. Explicit non-problems (verified, don't "fix")

- MV3 service worker structure (`src/background/index.ts`): top-level listeners, alarms re-armed on boot, no suspended-state globals, no unhandled rejections.
- SSR/static-export safety: `dynamic(..., { ssr: false })`, `chrome`-guarded storage API.
- SQL injection: none (all values bound; only fixed enum table names interpolated).
- `cloudflareSync/queue.ts` (per-context serialization + dedupe) and `reconcile.ts` (pure LWW engine) are sound.
- No secrets committed: `.env` is untracked and its key is unreferenced (still relocate it, see C7).
