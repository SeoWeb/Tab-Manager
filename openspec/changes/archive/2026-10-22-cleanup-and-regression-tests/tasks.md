## 1. Dependency Cleanup

- [x] 1.1 Remove `firebase` from `package.json` (verify zero imports via grep + full gate run); replace `fs-extra`/`cheerio` usage in `post-build.js` with `node:fs`/plain string APIs, then remove both from `package.json`
- [x] 1.2 Rework `src/components/views/TaskCalendarView.tsx` on `react-day-picker` with a parity checklist (month/week nav, per-day task lists, drag-to-reschedule, dark mode); keep the legacy implementation behind `USE_LEGACY_CALENDAR=1` for one release
- [x] 1.3 Remove `moment`, `react-big-calendar`, and `@types/react-big-calendar` once parity is verified; delete the legacy path
- [x] 1.4 Run all CI gates and record before/after bundle size in `PERFORMANCE_OPTIMIZATIONS.md`

## 2. Dead Code & Console Hygiene

- [x] 2.1 Delete `src/components/MainLayout/` and `scripts/update-favicons.js`
- [x] 2.2 Remove the duplicate `setHasHydrated` definition in `uiActions.ts` (keep the effective one; delete the dead copy)
- [x] 2.3 Gate debug routes (`/debug-favicons`, `/favicon-migration`) behind `INCLUDE_DEBUG_ROUTES=1` so production builds exclude them; verify absence in `build/` and availability in dev
- [x] 2.4 Strip page-context `console.log` noise (33 call sites); convert intentional diagnostics to a `DEBUG`-gated `console.debug`; keep the background worker's existing debug/error conventions
- [x] 2.5 Extract the triplicated URL-in-collection check in `useDragEnd.ts` into one shared helper; dedupe `DEFAULT_API_BASE_URL` into a single constant imported by `appStore.ts` and `config.ts`

## 3. Shared Package & Workspace Consolidation

- [x] 3.1 Create `packages/shared` (TS source package, `exports` map, tsconfig `paths` alias `@tabspace/shared/*` for both consumers)
- [x] 3.2 Move shadowed/duplicated modules from `frontend/src` into `packages/shared` (storage, cloudSync storage, cache/favicon services, pure utils); re-point imports in `src/` and `frontend/src`; delete the shadowed copies and the tsconfig shadowing
- [x] 3.3 Trim `frontend/package.json` to web-specific dependencies (root workspace provides shared ones)
- [x] 3.4 Add `backend` to `pnpm-workspace.yaml` `packages`; delete `backend/package-lock.json`; update root scripts to workspace-filtered commands; verify `wrangler dev/deploy` still run from `backend/`
- [x] 3.5 Verify both consumers build and all tests pass against the single shared copy; add a CI assertion that `frontend/src` contains no file duplicated from `src/`

## 4. A11y, Preferences & Resilience

- [x] 4.1 Add accessible names to all icon-only buttons in `TabSessionsPanel.tsx`; enable `eslint-plugin-jsx-a11y` rule for unnamed interactive elements so regressions fail lint
- [x] 4.2 Add `sortOption` and `searchFilters` to `partialize`; test persistence across a simulated restart
- [x] 4.3 Add `<RegionBoundary>` wrappers (left/main/right/modal) in `AppClient` with a Reset action (remount via key increment), announced error state, and focus moved to Reset; keep the root boundary as last resort
- [x] 4.4 Remove selector-swallowing fallbacks in `useSafeAppStore`/`useAppStoreWithDefaults` (landing the fix from the data-loss change if not already); test a throwing selector reaches the boundary
- [x] 4.5 Make `moveLink`'s bookmark mirroring sequenced with rollback/retry-marker handling; test the failure path leaves no divergent `bookmarkId`

## 5. Regression Test Suite

- [x] 5.1 Generalize the two-context storage simulator into a permanent suite: interleaved-write convergence, rehydrate-preserves-newer-edits, corrupt-snapshot quarantine, deterministic defaults
- [x] 5.2 Set up the miniflare/`@cloudflare/vitest-pool-workers` integration harness (migrations-applied D1, seeded fixtures; loud skip if runtime unavailable — never silent pass)
- [x] 5.3 Write the IDOR matrix tests (5 entity types × update/delete/move-attempt × member/ex-member/viewer) against real D1
- [x] 5.4 Write quota commit-path tests (project cap, member cap, entity cap): 403 not 500, unburned invitation, no phantom changelog, partial capacity
- [x] 5.5 Write concurrency tests: invitation-accept race, login-code concurrent verify/brute-force cap, CAS version conflict
- [x] 5.6 Write bookmark-mirror tests: queue-drain, debounce coalescing, duplicate-name non-linking, folder-disappearance non-destruction + re-link
- [x] 5.7 Write the onboarding fresh-install flow test (write-before-complete re-shows; upgrading storage skipped exactly once)
- [x] 5.8 Wire the integration suite into CI (`harden-ci-and-config` workflow) as a required job
