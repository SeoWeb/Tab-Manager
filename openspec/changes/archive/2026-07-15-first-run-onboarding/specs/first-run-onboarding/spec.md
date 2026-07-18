## ADDED Requirements

### Requirement: First-run detection and auto-open
The system SHALL automatically open the onboarding wizard the first time a user's store has hydrated AND `hasCompletedOnboarding` is `false`. The system MUST NOT open the wizard on subsequent sessions once onboarding is completed.

#### Scenario: Fresh install shows wizard
- **WHEN** a user opens TabSpace for the first time (no persisted `projects` and `hasCompletedOnboarding` defaults to `false`)
- **THEN** the onboarding wizard opens automatically after store hydration

#### Scenario: Completed onboarding does not reappear
- **WHEN** the store has hydrated and `hasCompletedOnboarding` is `true`
- **THEN** the onboarding wizard is NOT opened automatically

#### Scenario: Existing/upgrading user is skipped
- **WHEN** a user upgrades to a version containing this feature and their persisted snapshot already contains a `projects` array
- **THEN** the merge process sets `hasCompletedOnboarding` to `true` and the wizard is NOT shown

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
