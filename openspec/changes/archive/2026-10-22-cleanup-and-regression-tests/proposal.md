## Why

The codebase carries dead weight that ships to users or rots: `firebase`, `cheerio`, and `fs-extra` are installed but imported nowhere; `moment` survives in exactly one file alongside `date-fns`; `MainLayout.tsx` is referenced by nothing; `/debug-favicons` and `/favicon-migration` compile into the production bundle; `scripts/update-favicons.js` cannot run; page contexts emit 33 stray `console.log`s; the API base URL has two independent definitions; and the `frontend/` workspace "reuses" extension code via tsconfig path shadowing plus a mirrored dependency list that will drift silently. Meanwhile the audit's worst findings (cross-context data loss, backend IDOR/quotas) were invisible to the existing test suites because the tests mock exactly the semantics that were broken — there is no cross-context storage test, no real-D1 integration test, no bookmark-sync queue test, and no fresh-install onboarding test.

## What Changes

- Remove the dead dependency (`firebase`) and consolidate on a single date library (`date-fns`), removing `moment` and `react-big-calendar` in favor of the existing `react-day-picker`-based calendar rendering. (`cheerio`/`fs-extra` are *build-time* deps used by `post-build.js` — replace their usage with `node:fs`/string APIs there, then remove them.)
- Delete dead code: `MainLayout.tsx`, `scripts/update-favicons.js`, the duplicate `setHasHydrated` definition, debug routes from the production build (kept as a dev-only flag), stray `console.log`s in page contexts, and the triplicated URL-in-collection check in `useDragAndDrop`.
- Single sources of truth: one `DEFAULT_API_BASE_URL` constant; one canonical home for modules shared by the extension and `frontend/` (extract to a shared workspace package, eliminating tsconfig `@/*` shadowing and the mirrored dependency list).
- Bring `backend/` under pnpm workspaces (single lockfile strategy).
- A11y: every icon-only control gets an accessible name (starting with `TabSessionsPanel`'s ~15 unnamed buttons); UI preferences (`sortOption`, `searchFilters`) persist.
- Resilience: per-region error boundaries with Reset; no selector-error swallowing; no fire-and-forget bookmark operations inside state updates.
- Regression test suite covering the audit's blind spots: two-context storage simulator tests, real-D1 (miniflare) backend integration tests (IDOR matrix, quota commit paths, invitation races, login brute force), bookmark-sync queue/matching tests, and the fresh-install onboarding flow test.

## Capabilities

### New Capabilities
- `regression-test-suite`: Integration-level tests that model real semantics — multi-context chrome.storage, real D1 via miniflare, bookmark-event queueing, and onboarding — so the audit's failure classes cannot recur silently.
- `ui-resilience`: Fault isolation in the UI — per-region error boundaries with recovery, honest selector failures, and no detached async mutations of state-dependent resources.
- `accessible-ui`: Accessible names for all interactive controls and persisted UI preferences.

### Modified Capabilities
- `code-organization`: Adds requirements for production-bundle hygiene (no debug tooling, no dead code/dependencies), single-source-of-truth constants, and a canonical shared-module home for the extension + web frontend.

## Impact

- **Removed**: `firebase`, `cheerio`, `fs-extra`, `moment`, `react-big-calendar` (+ `@types/react-big-calendar`) from `package.json`; `src/components/MainLayout/`; `scripts/update-favicons.js`; debug routes in production builds.
- **Modified files**: `src/components/views/TaskCalendarView.tsx` (rework on `react-day-picker`), `src/hooks/useDragAndDrop/useDragEnd.ts` (shared helper), `src/lib/cloudflareSync/config.ts` + `src/stores/appStore.ts` (one constant), `pnpm-workspace.yaml` + `backend/package.json` (workspace consolidation), `frontend/tsconfig.json` + `frontend/package.json` (shared package import), `src/components/right-vertical-tabs/panels/TabSessionsPanel.tsx` (labels), `src/stores/appStore.ts` (persist `sortOption`/`searchFilters`), `src/components/ErrorBoundary.tsx` (regional boundaries + Reset), `src/stores/actions/dragDropActions.ts` (await/queue bookmark ops), plus new shared package `packages/shared/`.
- **Test infrastructure**: new `src/stores/__tests__/` simulator suite (from the data-loss change, extended here), `backend/src/lib/__tests__/integration/` miniflare harness, bookmark-sync and onboarding test files.
- **Risk**: calendar rework changes Task-calendar rendering details — mitigated by snapshot/interaction tests and keeping the moment-based implementation behind a flag until parity is verified.
