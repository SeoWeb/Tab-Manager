## REMOVED Requirements

### Requirement: Client-side content encryption
**Reason**: The E2E encryption feature was not successfully implemented and is being removed entirely to eliminate broken/dead code.
**Migration**: Cloud projects continue to sync as plaintext (the pre-E2E behavior). No client-side content encryption is performed.

### Requirement: Field encryption envelope
**Reason**: The `v1:` ciphertext envelope is part of the abandoned E2E feature and has no remaining consumers.
**Migration**: Field values are stored and transmitted as plaintext. The `v1:` envelope format is no longer produced or parsed.

### Requirement: Per-user asymmetric keys
**Reason**: User RSA keypair generation, wrapping, and `/me/keys` storage are part of the abandoned E2E feature.
**Migration**: Users no longer generate or upload keypairs. `PUT /me/keys` and `GET /me/keys` endpoints are removed.

### Requirement: Per-project wrapped data key
**Reason**: The per-project DEK and `project_keys` table are part of the abandoned E2E feature.
**Migration**: `GET /projects/:id/keys` and `POST /projects/:id/keys` endpoints and the `project_keys` table are removed. `projects.encrypted` is dropped.

### Requirement: Key distribution to new members
**Reason**: Key granting to new members depends on the removed DEK/wrapping machinery.
**Migration**: Members join projects without any key-grant step; no "waiting for key" state exists.

### Requirement: Force full re-upload on enable
**Reason**: Re-upload-on-enable only applied to the abandoned encryption-enable flow.
**Migration**: Enabling cloud sync no longer triggers an encrypted re-upload; entities sync as plaintext.

### Requirement: Backend key storage and endpoints
**Reason**: The key-storage columns, `project_keys` table, and key endpoints are part of the abandoned E2E feature.
**Migration**: Backend removes `users.public_key`/`wrapped_private_key`/`key_salt`, `projects.encrypted`, the `project_keys` table, and the `/me/keys` + `/projects/:id/keys` routes. `GET /projects/:id/members` no longer returns `public_key`/`has_key`. Rate-limiting/quota endpoints are unaffected.

### Requirement: No server-side decryption
**Reason**: This property only existed to support the abandoned E2E ciphertext model.
**Migration**: The server stores project content as plaintext (same as before the E2E attempt).
