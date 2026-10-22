## Context

Six remediation changes land in sequence; this one is last and consolidates what the earlier phases touched plus the hygiene debt the audit surfaced. Key existing facts: the frontend workspace already shares the root pnpm store via `pnpm-workspace.yaml` (with a comment explicitly documenting the tsconfig-shadowing workaround this change removes); `TaskCalendarView.tsx` is the only `moment` consumer (`react-big-calendar` + `momentLocalizer`); `date-fns` is used elsewhere; analytics uses `recharts`. The data-loss change already introduces the two-context storage simulator — this change extends it into the permanent regression suite. The backend currently runs vitest in plain Node with hand-rolled D1 mocks; the secure-sync change already pilots a miniflare harness for quota tests, which this change generalizes.

## Goals / Non-Goals

**Goals:**
- The production bundle contains only production code; the dependency tree contains only used dependencies.
- One canonical copy of every shared module and constant; one package manager.
- The audit's failure classes are locked behind regression tests that model real semantics.
- UI crashes are contained and recoverable; icon-only controls are accessible.

**Non-Goals:**
- Rewriting the calendar's feature set (parity with existing `react-big-calendar` behavior is the bar).
- New user-facing features, theme work, or the deferred single-sync-owner architecture.
- Performance work (owned by `scale-sync-backend`).
- Server behavior changes (all backend items here are tests/harness only).

## Decisions

- **Calendar: rework `TaskCalendarView` on `react-day-picker` + existing custom rendering.** The view renders tasks by due date with drag interactions; `react-day-picker` (already a dependency) supplies the month grid while the existing task-card rendering supplies content. Parity checklist: month/week navigation, per-day task lists, drag-to-reschedule, dark-mode styles. Keep `react-big-calendar` for one release behind `USE_LEGACY_CALENDAR=1` (checked at module init, tree-shaken in production), then delete. *Alternative:* keep `moment`+`react-big-calendar` just for this view — rejected: two date libraries and a 70 KB+ legacy calendar for one view.
- **Shared package: `packages/shared`** exporting the modules `frontend/src` currently shadows or duplicates (`stores/storage.ts`, `lib/cloudflareSync/storage.ts`, `lib/cacheService.ts`, favicon services, etc.). Both `src/` and `frontend/src` import via `@tabspace/shared/*` (tsconfig `paths` + package `exports`). The frontend keeps genuinely-web-only modules (privacy page, web layout) locally. Migration is mechanical: move file → re-point imports → delete shadowed copy → `pnpm build` in both consumers. *Alternative:* leave shadowing and add a drift-check CI job — rejected: enforces nothing at author time; imports make drift impossible.
- **Backend under pnpm workspaces:** add `backend` to `packages`, delete `backend/package-lock.json`, route scripts through workspace commands (`pnpm --filter tab-manager-cloudflare-backend test`). Wrangler runs unchanged from the backend directory. *Alternative:* leave npm for backend — two lockfiles indefinitely; the audit flagged the drift.
- **Debug pages:** gate behind `process.env.INCLUDE_DEBUG_ROUTES === '1'` at the `src/app` level using Next's dynamic-route exclusion (conditional `generateStaticParams`/route files moved to a `_debug` segment excluded by the build flag). Simpler alternative considered: delete outright — kept optional because the favicon tooling had real debugging value; production exclusion is the requirement.
- **miniflare harness:** `@cloudflare/vitest-pool-workers` with `wrangler.toml`-derived bindings and migration-applied local D1; shared fixtures (seed users/projects at roles) live in `backend/src/lib/__tests__/integration/fixtures.ts`. The IDOR matrix is data-driven (5 entity types × {update, delete, move-attempt} × {member, ex-member, viewer}).
- **Error boundaries:** a `<RegionBoundary name>` wrapper (left/main/right/modal) around the four regions in `AppClient`, reusing the existing boundary component with a Reset button (remount via key increment) + a11y wiring (announced error, focus moved to Reset). The root boundary stays for anything above the regions.

## Risks / Trade-offs

- [Calendar rework regressions in drag-to-reschedule] → Parity checklist + interaction tests; legacy flag keeps a fallback during review.
- [Shared-package extraction breaks frontend build in subtle ways (CSS imports, Next-specific modules)] → Move pure TS modules first; any module importing Next- or chrome-specific APIs stays local with an interface seam documented.
- [miniflare harness flakes on CI (port/binding quirks)] → Pool-workers config pins versions; harness is allowed to mark itself skipped with a loud warning if the runtime is unavailable, never silently passing.
- [Removing moment changes date formatting edge cases] → Central `formatDate` helpers in shared package with unit tests around week-start and locale-sensitive paths.

## Migration Plan

1. Dependencies first (remove `firebase`/`cheerio`/`fs-extra`; calendar behind flag; delete `moment` when flag ships).
2. Dead code + console.log + constant dedupe (pure deletions, CI-gated).
3. Shared package extraction + frontend de-shadowing + backend workspace consolidation.
4. A11y + persisted prefs + regional error boundaries.
5. Regression suite last (it tests the *final* behavior, including fixes from earlier phases — those phases ship their own targeted tests; this suite is the permanent integration layer).

Rollback: each step reverts independently; the legacy-calendar flag is the only temporary code.

## Open Questions

- Does the web frontend actually need `recharts`/`dnd-kit` in its own manifest once imports go through the shared package? (Answer at extraction time: no — the workspace root provides them; trim `frontend/package.json` to web-specific deps.)
- Which additional page-context `console.log`s are load-bearing diagnostics vs. noise? (Default: convert intentional diagnostics to `console.debug` gated by a `DEBUG` flag.)
