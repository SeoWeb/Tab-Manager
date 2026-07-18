## Why

The cloud end-to-end (E2E) encryption feature in the uncommitted work was not successfully implemented — it adds a fragile RSA/DEK envelope scheme, a migration, new backend key-distribution routes, and a UI surface (passphrase modal, lock banner, encryption controls) that do not function correctly. Removing it eliminates dead, partly-broken code and its attack surface while keeping the coexisting first-run onboarding and backend rate-limiting/quota features fully intact.

## What Changes

- **Remove** the backend E2E key-distribution module and routes (`PUT/GET /me/keys`, `POST/GET /projects/:id/keys`).
- **Remove** the `0003_e2e_keys.sql` migration (`users.public_key`, `users.wrapped_private_key`, `users.key_salt`, `projects.encrypted`, `project_keys` table) and its references in `package.json` migrate scripts.
- **Remove** frontend crypto/key-store modules (`crypto.ts`, `keyStore.ts`, `orchestrator/encryption.ts`) and their call sites across the cloud-sync orchestrator, queue, background sync, and stores.
- **Remove** E2E UI components (`EncryptionPassphraseModal`, `ProjectEncryptionLockBanner`) and the encryption control section in the collaboration modal, plus the lock badge in `ProjectHeader` and the `v1:` ciphertext envelope handling in `LinkItem`/`faviconService`.
- **Remove** the `cloud-e2e-encryption` OpenSpec capability, its archived change, the diagnostic script `scripts/diag-decrypt.mjs`, and E2E mentions in `README.md` / `deployment.md`.
- **Keep (untouched)**: first-run onboarding (frontend) and backend rate-limiting/quotas/abuse-protection features.

## Capabilities

### New Capabilities
<!-- None introduced by this removal. -->

### Modified Capabilities
- `cloud-e2e-encryption`: **REMOVE** — this capability is dropped entirely. Its spec and archive entry are deleted; no requirement remains.

## Impact

- **Backend**: `backend/src/index.ts`, `backend/src/lib/projects.ts`, `backend/src/lib/keys.ts` (deleted), `backend/src/types.ts`, `backend/src/db/migrations/0003_e2e_keys.sql` (deleted), `backend/package.json`, `backend/.dev.vars.example` (no e2e vars, no change needed).
- **Frontend**: `src/lib/cloudflareSync/{crypto,keyStore,types,client,queue,backgroundSync,reconcile,account,sync}.ts`, `src/lib/cloudflareSync/orchestrator/{encryption.ts(deleted),ts}`, `src/stores/{appStore,types}.ts`, `src/stores/actions/cloudSyncActions.ts`, `src/types/index.ts`, `src/components/cloud-sync/*`, `src/components/main-content/{ProjectHeader,MainContentArea,LinkItem}.tsx`, `src/lib/faviconService.ts`, `src/components/AppClient.tsx`, `src/components/cloud-sync/ProjectCollaborationModal.tsx`.
- **Tests**: delete `keys.test.ts` (backend) and 4 frontend crypto/keyStore/encryption test files; keep `quotas.test.ts`, `ratelimit.test.ts`, `onboarding.test.ts`.
- **Docs/OpenSpec**: remove `cloud-e2e-encryption` spec + archive; trim README/deployment E2E sections; delete `scripts/diag-decrypt.mjs`.
- **Non-breaking for other features**: no onboarding or rate-limit/quota behavior is altered.
