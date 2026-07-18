## 1. Store state & actions

- [x] 1.1 Add `hasCompletedOnboarding: boolean` and `isOnboardingOpen: boolean` to the `AppState` interface in `src/stores/types.ts`, plus the `openOnboarding`, `closeOnboarding`, and `completeOnboarding` action signatures.
- [x] 1.2 Set `hasCompletedOnboarding: false` and `isOnboardingOpen: false` defaults in `initialState` within `src/stores/appStore.ts`.
- [x] 1.3 Include `hasCompletedOnboarding` in the Zustand `partialize` return so it persists; keep `isOnboardingOpen` out of persistence.
- [x] 1.4 In the `merge` function, force `hasCompletedOnboarding: true` when the persisted snapshot already contains a `projects` array (existing/upgrading user skip).
- [x] 1.5 Implement `openOnboarding`, `closeOnboarding`, and `completeOnboarding` actions in `src/stores/actions/uiActions.ts` (`openOnboarding`/`closeOnboarding` toggle `isOnboardingOpen`; `completeOnboarding` sets `isOnboardingOpen: false` and `hasCompletedOnboarding: true`).

## 2. Onboarding wizard component

- [x] 2.1 Create `src/components/onboarding/OnboardingWizard.tsx` rendering a controlled, non-dismissable `Dialog` (overlay/escape disabled) driven by `isOnboardingOpen`.
- [x] 2.2 Add a `Progress` bar bound to the current step and a 5-step sequence: Welcome, Projects, Collections, Links & Quick Links, "You're all set".
- [x] 2.3 Render an explanatory `Card` with a `lucide-react` icon for each concept step (Projects, Collections, Links & Quick Links).
- [x] 2.4 Implement footer controls: Back (hidden on step 1), Skip (calls `completeOnboarding`), Next (advances), and Get started on the final step (calls `completeOnboarding`).

## 3. Mount, auto-trigger & settings re-entry

- [x] 3.1 In `src/components/AppClient.tsx`, `React.lazy`-import `OnboardingWizard` and render it inside a `<Suspense>` block alongside the existing modals.
- [x] 3.2 Add a `useEffect` gated on `_hasHydrated` that calls `openOnboarding()` when `!hasCompletedOnboarding`.
- [x] 3.3 In `src/components/views/SettingsView.tsx`, add a "Show onboarding" / "Tutorial" button that calls `openOnboarding()`.

## 4. Tests & verification

- [x] 4.1 Add a store test under `src/__tests__/` asserting: default `hasCompletedOnboarding === false`, `completeOnboarding` sets it `true`, and `merge` sets it `true` for a snapshot with `projects`.
- [x] 4.2 Run `pnpm lint`, `pnpm typecheck`, and the new test (`pnpm test`) and fix any failures.
