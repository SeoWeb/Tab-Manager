# auth-code-flow Specification

## Purpose
TBD - created by archiving change secure-sync-backend. Update Purpose after archive.
## Requirements
### Requirement: Login codes are single-use and consumed atomically
Verifying a login code SHALL consume it atomically: the successful verification SHALL be a single conditional delete that returns the row only if the code is correct and unexpired, so two concurrent verifications with the same code cannot both mint tokens.

#### Scenario: Concurrent verifies with the same code
- **WHEN** two verify requests carrying the same valid code race
- **THEN** exactly one receives a token; the other fails as used/invalid

#### Scenario: Successful verify invalidates the code
- **WHEN** a code is verified successfully
- **THEN** a subsequent verify with the same code fails

### Requirement: Attempt limits are enforced atomically
The per-code attempt counter SHALL be incremented with a single conditional statement that refuses to increment past the maximum, and the check-and-increment SHALL NOT be a separate read followed by a write. Wrong attempts beyond the maximum SHALL invalidate the code.

#### Scenario: Brute force beyond the attempt cap
- **WHEN** an attacker submits wrong codes concurrently against one pending code
- **THEN** no more than the configured number of wrong attempts are accepted and the code becomes unusable at the cap

#### Scenario: Correct code after failed attempts within cap
- **WHEN** a user submits one wrong code and then the correct code, still within the attempt cap
- **THEN** verification succeeds

### Requirement: Bounded code expiry and hygiene
Login codes SHALL expire within a bounded lifetime (default 10 minutes, overridable but capped), codes SHALL be generated without modulo bias, expired code rows SHALL be purged (on access and via periodic cleanup), and codes SHALL be stored hashed.

#### Scenario: Expired code is rejected and purged
- **WHEN** a verify arrives for a code older than its lifetime
- **THEN** verification fails and the expired row is removed

#### Scenario: Codes are not stored in plaintext
- **WHEN** a login code row is inspected in the database
- **THEN** it contains a hash of the code, not the code itself

### Requirement: Email content is not attacker-controlled
The login email SHALL NOT interpolate requester-supplied display names or other free-form input into the message body. Any displayed identity SHALL be derived from verified data or strictly sanitized (length- and character-bounded), and a display name supplied in a request-code body SHALL NOT be persisted for an address that has not verified.

#### Scenario: Unverified display name is not persisted
- **WHEN** a request-code body includes a display name for an email that has no verified account yet
- **THEN** the name is not stored and the sent email contains no attacker-chosen text

