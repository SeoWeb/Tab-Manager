## MODIFIED Requirements

### Requirement: First-run detection and auto-open
The system SHALL automatically open the onboarding wizard the first time a user's store has hydrated AND `hasCompletedOnboarding` is `false`. The system MUST NOT open the wizard on subsequent sessions once onboarding is completed. `hasCompletedOnboarding` SHALL be governed solely by the explicit flag: completing or skipping onboarding sets it; nothing else sets it to `true`. Whether a user is an existing/upgrading user SHALL be determined by a one-time migration marker (`onboardingMigrationDone`) written on first load by any version containing this requirement — a user whose storage predates onboarding gets the marker set (and is skipped), while a genuinely fresh install has no marker and the flag `false`, so the wizard shows. The presence of a persisted `projects` array MUST NOT be used to infer completion.

#### Scenario: Fresh install shows wizard
- **WHEN** a user opens TabSpace for the first time (no persisted state: no migration marker and `hasCompletedOnboarding` is `false`)
- **THEN** the onboarding wizard opens automatically after store hydration

#### Scenario: Completed onboarding does not reappear
- **WHEN** the store has hydrated and `hasCompletedOnboarding` is `true`
- **THEN** the onboarding wizard is NOT opened automatically

#### Scenario: Existing/upgrading user is skipped exactly once
- **WHEN** a user upgrades to a version containing this requirement and their storage lacks the migration marker (storage predates onboarding)
- **THEN** the migration marker is written, the wizard is NOT shown, and the marker ensures this decision is never revisited

#### Scenario: New user who dismisses without completing sees the wizard again
- **WHEN** a fresh-install user closes the tab (or the wizard is otherwise not completed) without finishing or skipping, and later opens TabSpace again
- **THEN** `hasCompletedOnboarding` is still `false` and the onboarding wizard opens again

#### Scenario: First store write does not complete onboarding
- **WHEN** a fresh-install user's state is persisted for the first time (e.g. a settings change) before onboarding completes
- **THEN** the persisted snapshot does not imply completion and the wizard still opens on the next launch
