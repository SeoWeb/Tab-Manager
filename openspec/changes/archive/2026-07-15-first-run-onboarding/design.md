## Context

TabSpace is a Chrome MV3 extension (also shipped as a web app via a shared `src/` tree) that renders the new-tab page, the toolbar popup, and a website from the same Next.js/React UI. There is currently **no first-run experience**: a fresh install lands directly on a seeded, empty "Work" project. Users are never taught the application's core organizing metaphor — Projects → Collections → Links/Quick Links.

Navigation inside the app is **state-driven, not route-driven** (`activeView` in a Zustand store), and the new-tab page, popup, and web app all mount the same `AppClient` component. Onboarding must therefore be a UI overlay mounted within `AppClient`, not a new Next.js route. State persistence is handled by a single Zustand store hydrated from `chrome.storage.local` (and from IndexedDB in the web build, via a shadowed storage adapter). There is no existing first-run flag anywhere in storage, session, or the store.

## Goals / Non-Goals

**Goals:**
- Show a guided, multi-step wizard automatically on a user's first session.
- Explain the three core concepts (Projects, Collections, Links/Quick Links) clearly and concisely.
- Persist completion so the wizard appears exactly once for new users and is skipped for existing/upgrading users.
- Provide a manual re-entry point from Settings so the wizard can be replayed.
- Reuse existing UI primitives (Radix/shadcn `Dialog`, `Progress`, `Card`, `Button`) and `lucide-react` icons — no new runtime deps.

**Non-Goals:**
- No interactive in-context product tour (spotlights on live UI) — out of scope and brittle across surfaces.
- No cloud-sync sign-in flow, tab-capture, or theme-selection steps in the wizard (user-selected scope: "Core concepts" only).
- No new marketing/landing pages or backend changes.
- No changes to the data model itself — only additive UI state.

## Decisions

### D1. First-run detection via a persisted store flag
Add `hasCompletedOnboarding: boolean` to `AppState` (default `false`) and persist it through the existing Zustand `partialize`. The wizard auto-opens when the store has hydrated and `hasCompletedOnboarding === false`.

**Rationale:** Reuses the already-correct hydration/persistence pipeline that works identically in the extension and web builds. Alternatives considered:
- *A separate `chrome.runtime.onInstalled` flag in the background worker:* would not apply to the web build and adds a second storage channel; rejected.
- *A standalone `chrome.storage.local` key (à la `cloudflareSync/storage.ts`):* works but diverges from the single-source-of-truth store and complicates re-entry/testing; rejected in favor of the store flag.

### D2. Skip existing/upgrading users via `merge`
In the Zustand `merge` function, if the persisted snapshot already contains a `projects` array (i.e. the user had prior state), force `hasCompletedOnboarding: true`. Fresh installs have no persisted snapshot, so the flag stays `false` and the wizard shows.

**Rationale:** Prevents a jarring "what's new" prompt for users who upgrade to a version containing this feature. This is idempotent and runs on every rehydrate, consistent with the existing per-project migration already in `merge`.

### D3. Controlled, non-dismissable mid-flow `Dialog`
The wizard `Dialog` is controlled and disables overlay-click/escape dismissal so the flow can't be accidentally closed without a decision. The footer exposes **Back**, **Skip**, and **Next**/**Get started**. Both **Skip** and the final **Get started** call `completeOnboarding()`, which sets `hasCompletedOnboarding: true` and closes.

**Rationale:** Guarantees the wizard is shown exactly once (the flag flips on any exit), while still letting users bail. Manual re-entry from Settings calls `openOnboarding()` and ignores the flag.

### D4. Modal open state kept out of persistence
Add `isOnboardingOpen: boolean` to `AppState` as a transient UI flag (excluded from `partialize`). The auto-open `useEffect` in `AppClient` flips it after hydration; Settings re-entry also flips it.

**Rationale:** The open/closed state must not survive reloads (we don't want the wizard re-popping on every refresh for a user mid-flow); the *completion* flag is what persists.

### D5. Step content and progress
Five steps: (1) Welcome, (2) Projects, (3) Collections, (4) Links & Quick Links, (5) "You're all set". A `Progress` bar reflects `step / totalSteps`. Each concept step uses a `Card` with a `lucide-react` icon (`FolderKanban`, `FolderOpen`, `Link2`/`Bookmark`) and short copy.

### D6. Lazy mount for performance parity
`OnboardingWizard` is `React.lazy`-imported and rendered inside `AppClient` alongside the existing lazy modals (`AddProjectModal`, etc.), wrapped in `<Suspense>`.

**Rationale:** Keeps the initial bundle lean and matches the established modal pattern in `AppClient.tsx`.

## Risks / Trade-offs

- **[Risk] Upgrading users briefly flash the empty app before the wizard could show** → Mitigated: the wizard opens immediately post-hydration, and existing users are skipped entirely via `merge`, so they never see it.
- **[Risk] A user force-closes the tab mid-wizard and reloads** → Mitigated: `completeOnboarding` only fires on explicit Skip/Get started. If they reload before finishing, the wizard re-opens (acceptable — it's the first run and not yet completed). The flag's sole purpose is "completed", so re-showing until completed is correct.
- **[Risk] Web build `merge` differs** → Mitigated: logic lives in shared `src/stores/appStore.ts`; the web build shadows only `storage.ts`, not the store, so behavior is identical.
- **[Trade-off] Non-dismissable mid-flow may feel slightly restrictive** → Accepted for first-run clarity; the Skip button is always visible.

## Migration Plan

- No DB/schema migration; purely additive store fields.
- Roll out with the next extension/web release. On upgrade, `merge` sets `hasCompletedOnboarding: true` for existing users, so no behavior change for them.
- Rollback: removing the wizard is safe; the persisted `hasCompletedOnboarding` flag is ignored if the consuming code is absent. No destructive change.

## Open Questions

- None outstanding; scope (core concepts only, re-triggerable, multi-step wizard) was confirmed with the user.
