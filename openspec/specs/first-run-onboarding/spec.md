## Purpose

Govern the first-run experience: detect genuinely new users and walk them through TabSpace's core concepts (Projects → Collections → Links) via an onboarding wizard exactly once, without inferring completion from persisted data shape, while keeping the wizard re-runnable on demand from Settings.
## Requirements
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

### Requirement: Onboarding wizard UI and steps
The onboarding wizard SHALL be a controlled modal dialog that presents the core concepts across a fixed sequence of steps with a progress indicator. The steps SHALL be: Welcome, Projects, Collections, Links & Quick Links, and a final "You're all set" step. The wizard SHALL NOT be dismissable by overlay click or escape while open.

#### Scenario: Progress indicator advances
- **WHEN** the user clicks "Next" on a step
- **THEN** the wizard advances to the next step and the progress bar reflects the new step position

#### Scenario: Back navigation
- **WHEN** the user is on any step after the first and clicks "Back"
- **THEN** the wizard returns to the previous step

#### Scenario: Core concepts are explained
- **WHEN** the user views the Projects, Collections, and Links & Quick Links steps
- **THEN** each step displays an explanatory card describing that concept in the Projects → Collections → Links hierarchy

#### Scenario: Mid-flow dismissal is prevented
- **WHEN** the wizard is open and the user clicks the overlay or presses escape
- **THEN** the wizard remains open (only explicit Skip/Get started closes it)

### Requirement: Completing or skipping onboarding
The system SHALL mark onboarding complete when the user finishes the final step or chooses to skip. Completing or skipping MUST set `hasCompletedOnboarding` to `true` and close the wizard.

#### Scenario: Get started completes onboarding
- **WHEN** the user reaches the final step and clicks "Get started"
- **THEN** `hasCompletedOnboarding` becomes `true` and the wizard closes

#### Scenario: Skip completes onboarding
- **WHEN** the user clicks "Skip" at any point
- **THEN** `hasCompletedOnboarding` becomes `true` and the wizard closes without requiring the remaining steps

### Requirement: Re-trigger onboarding from Settings
The system SHALL provide a control in Settings that opens the onboarding wizard on demand, regardless of whether onboarding was previously completed.

#### Scenario: Replay from Settings
- **WHEN** a user who has completed onboarding opens Settings and activates the "Show onboarding" / "Tutorial" control
- **THEN** the onboarding wizard opens

