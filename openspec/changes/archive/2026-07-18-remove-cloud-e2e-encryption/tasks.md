## 1. Delete Entirely E2E Files

- [x] 1.1 Delete `backend/src/lib/keys.ts`
- [x] 1.2 Delete `backend/src/db/migrations/0003_e2e_keys.sql`
- [x] 1.3 Delete `backend/src/lib/__tests__/keys.test.ts`
- [x] 1.4 Delete `src/lib/cloudflareSync/crypto.ts`
- [x] 1.5 Delete `src/lib/cloudflareSync/keyStore.ts`
- [x] 1.6 Delete `src/lib/cloudflareSync/orchestrator/encryption.ts`
- [x] 1.7 Delete `src/components/cloud-sync/EncryptionPassphraseModal.tsx`
- [x] 1.8 Delete `src/components/cloud-sync/ProjectEncryptionLockBanner.tsx`
- [x] 1.9 Delete `src/lib/cloudflareSync/__tests__/crypto.test.ts`
- [x] 1.10 Delete `src/lib/cloudflareSync/__tests__/keyStore.test.ts`
- [x] 1.11 Delete `src/lib/cloudflareSync/__tests__/unlockEncryptedProject.test.ts`
- [x] 1.12 Delete `src/lib/cloudflareSync/__tests__/encryption.integration.test.ts`
- [x] 1.13 Delete `openspec/specs/cloud-e2e-encryption/` directory
- [x] 1.14 Delete `openspec/changes/archive/2026-07-15-cloud-e2e-encryption/` directory
- [x] 1.15 Delete `scripts/diag-decrypt.mjs`

## 2. Backend Surgical Removal

- [x] 2.1 In `backend/src/index.ts`: remove the `keys` import; remove the `/me/keys` route block; remove the `/projects/:id/keys` route block. Keep ratelimit imports, `export { RateLimiter }`, `applyRateLimiting`/`subjectOf`/`attachRateLimitHeaders`, and shared `readJson`.
- [x] 2.2 In `backend/src/lib/projects.ts`: remove `encrypted`, `public_key`, `has_key`, `project_keys` from `listProjects`/`getProject`/`updateProject` SELECTs, UPDATE, input type, and `getProjectMembers` mapping. Keep `checkProjectQuota`/`checkMemberQuota` calls and the `./quotas` import.
- [x] 2.3 In `backend/src/types.ts`: remove `Project.encrypted`, `CloudMemberKeyInfo`, `CloudUserKeys`, `CloudWrappedKey`. Keep `RATE_LIMITER` and all `RATE_LIMIT_*`/`QUOTA_*` env fields.
- [x] 2.4 In `backend/package.json`: strip the `&& ... 0003_e2e_keys.sql` segment from both `migrate:local` and `migrate:remote`.

## 3. Frontend Surgical Removal

- [x] 3.1 In `src/lib/cloudflareSync/types.ts`: remove `CloudMember.public_key`, `has_key`, and `CloudProject.encrypted`.
- [x] 3.2 In `src/lib/cloudflareSync/client.ts`: remove `updateProject` helper and `putUserKeys`/`getUserKeys`/`getProjectKeys`/`grantProjectKeys`. Keep `request<T>` refactor.
- [x] 3.3 In `src/lib/cloudflareSync/queue.ts`: remove `getProjectDek`/`encryptPatch` import and call.
- [x] 3.4 In `src/lib/cloudflareSync/backgroundSync.ts`: remove crypto/keyStore imports, `restoreSession()` calls, and all decrypt/`encrypted`/`encryptionUnlocked` logic.
- [x] 3.5 In `src/lib/cloudflareSync/orchestrator/account.ts`, `reconcile.ts`, `sync.ts`: remove crypto/keyStore/encryption imports and `decrypt*`/`ensureProjectDek`/`runGrantStep`/`getProjectDek` usage.
- [x] 3.6 In `src/lib/cloudflareSync/orchestrator.ts`: remove the `export { ... } from './orchestrator/encryption'` line. Keep the barrel refactor and other exports.
- [x] 3.7 In `src/stores/appStore.ts`: remove `resetEncryptionUnlocked` helper and its `.map(resetEncryptionUnlocked)`. Keep onboarding state logic.
- [x] 3.8 In `src/stores/types.ts`: remove `setProjectEncrypted`, `setProjectDekUnlocked` declarations. Keep onboarding state/actions.
- [x] 3.9 In `src/stores/actions/cloudSyncActions.ts`: remove `setProjectEncrypted` and `setProjectDekUnlocked` actions.
- [x] 3.10 In `src/types/index.ts`: remove `Project.encrypted` and `Project.encryptionUnlocked`.
- [x] 3.11 In `src/components/cloud-sync/ProjectCollaborationModal.tsx`: remove the `EncryptionSection` subcomponent and its imports/render (keep the rest of the modal).
- [x] 3.12 In `src/components/AppClient.tsx`: remove keyStore import and the `getProjectDek`/`setProjectDekUnlocked` hydration effect. Keep onboarding wizard.
- [x] 3.13 In `src/components/main-content/ProjectHeader.tsx`: remove `Lock` import and the encrypted lock badge.
- [x] 3.14 In `src/components/main-content/MainContentArea.tsx`: remove `ProjectEncryptionLockBanner` import and render.
- [x] 3.15 In `src/components/main-content/LinkItem.tsx`: revert `v1:` envelope handling (`isEncrypted`/`safeUrl`/guard) back to original plaintext behavior.
- [x] 3.16 In `src/lib/faviconService.ts`: remove `isValidFaviconUrl` and the `v1:` bail.

## 4. Documentation Trimming

- [x] 4.1 In `README.md`: remove the E2E TOC line, the Features bullet, and the full `## End-to-end encryption (optional)` section (~lines 380–429).
- [x] 4.2 In `deployment.md`: trim the E2E sentences in "Run the migration" and remove the "Consider end-to-end encryption" checklist bullet.

## 5. Verification

- [x] 5.1 Grep `src` and `backend` for `encrypt|e2e|passphrase|decrypt|keyStore|getProjectDek|v1:` returns no E2E-related references.
- [x] 5.2 Backend: `cd backend && npx vitest run` (keys.test.ts gone; quotas/ratelimit pass).
- [x] 5.3 Frontend: `npm run lint && npm run typecheck` pass; `npm run test` passes (onboarding test intact).
