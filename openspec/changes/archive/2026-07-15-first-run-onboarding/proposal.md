## Why

New TabSpace users currently land directly on an empty default "Work" project with no guidance on the core data model (Projects → Collections → Links/Quick Links). This creates a confusing first-run experience and leaves the app's organizing metaphor unexplained. A guided, dismissable first-run onboarding wizard improves activation and comprehension.

## What Changes

- Introduce a multi-step first-run onboarding wizard shown automatically the first time a user opens the app (new-tab page, popup, or web build).
- The wizard explains the core concepts: Projects, Collections, and Links/Quick Links, using the existing Radix/shadcn `Dialog`, `Progress`, `Card`, and `Button` primitives.
- Add persisted state to track whether onboarding has been completed, so it shows only once for fresh installs (existing users are skipped via migration logic).
- Add a "Show onboarding" / "Tutorial" entry in Settings so the wizard can be replayed on demand.
- Onboarding is non-dismissable by overlay/escape mid-flow; explicit Skip and Done buttons both mark it complete so it never nags.

## Capabilities

### New Capabilities
- `first-run-onboarding`: A controlled, multi-step modal wizard that explains TabSpace's core data model on first run and is re-triggerable from Settings. Covers detection of first run, persisted completion state, the wizard UI/steps, and the Settings re-entry point.

### Modified Capabilities
<!-- No existing capability requirements change; this is net-new. -->

## Impact

- **State**: `src/stores/types.ts` (`AppState`), `src/stores/appStore.ts` (`initialState`, `partialize`, `merge` migration), `src/stores/actions/uiActions.ts` (new actions).
- **UI**: New component `src/components/onboarding/OnboardingWizard.tsx`; mounted and auto-triggered in `src/components/AppClient.tsx`; new re-entry control in `src/components/views/SettingsView.tsx`.
- **Tests**: New store test under `src/__tests__/` covering default flag, completion, and merge-based skip for existing users.
- **Surfaces**: Applies automatically to both the Chrome extension (new tab + popup) and the web build because all logic lives in shared `src/`.
- **Dependencies**: No new runtime dependencies; uses existing `lucide-react` and shadcn/ui primitives.
