## Context

The uncommitted work on the TabManager extension bundles three independent features: first-run onboarding (frontend), backend rate-limiting/quotas/abuse-protection, and an attempted cloud end-to-end (E2E) encryption system. The E2E attempt introduced an RSA-OAEP 2048 keypair per user, a per-project AES-GCM-256 data key (DEK) envelope, client-side field encryption with a `v1:` ciphertext marker, backend key-distribution routes, a `project_keys` migration, and supporting UI (passphrase modal, lock banner, encryption controls). The implementation was not completed successfully and leaves broken/partial behavior in both the backend and frontend sync path. Onboarding and rate-limiting/quotas are unrelated and must be preserved.

## Goals / Non-Goals

**Goals:**
- Fully remove the E2E encryption feature (backend + frontend) so the codebase contains no dead or broken encryption code.
- Preserve the first-run onboarding feature and the backend rate-limiting/quota/abuse-protection features without behavioral change.
- Remove the `cloud-e2e-encryption` OpenSpec capability and its archive, the `0003_e2e_keys.sql` migration, and the `scripts/diag-decrypt.mjs` diagnostic.
- Keep the cloud-sync orchestrator refactor (barrel split) and generic sync/queue/reconcile logic intact.

**Non-Goals:**
- Not re-implementing or fixing E2E encryption (explicitly deferred/abandoned).
- Not modifying onboarding or rate-limiting/quota behavior.
- Not altering the existing `v1:` envelope contract elsewhere (it is only used by E2E and is removed wholesale).

## Decisions

- **Delete whole files that are 100% E2E.** `backend/src/lib/keys.ts`, `backend/src/db/migrations/0003_e2e_keys.sql`, `backend/src/lib/__tests__/keys.test.ts`, `src/lib/cloudflareSync/crypto.ts`, `src/lib/cloudflareSync/keyStore.ts`, `src/lib/cloudflareSync/orchestrator/encryption.ts`, the two E2E UI components, the four frontend E2E test files, the `cloud-e2e-encryption` spec directory, the e2e archive change, and `scripts/diag-decrypt.mjs`. Rationale: lowest-risk, no partial edits.

- **Surgically strip E2E from mixed files.** In `backend/src/index.ts`, `backend/src/lib/projects.ts`, `backend/src/types.ts`, `src/lib/cloudflareSync/{client,queue,backgroundSync,types}.ts`, `src/lib/cloudflareSync/orchestrator/{account,reconcile,sync}.ts`, `src/lib/cloudflareSync/orchestrator.ts`, `src/stores/{appStore,types}.ts`, `src/stores/actions/cloudSyncActions.ts`, `src/types/index.ts`, `src/components/cloud-sync/ProjectCollaborationModal.tsx`, `src/components/AppClient.tsx`, `src/components/main-content/{ProjectHeader,MainContentArea,LinkItem}.tsx`, and `src/lib/faviconService.ts`, remove only the E2E-specific additions (routes, columns, types, actions, imports, decrypt/`encrypted`/`encryptionUnlocked` logic, lock UI, `v1:` envelope handling). Rationale: these files also contain onboarding or generic sync/quota code that must survive.

- **Keep the orchestrator barrel refactor.** `orchestrator.ts` was reduced to a re-export of the new `orchestrator/` submodules; only the single `export { ... } from './orchestrator/encryption'` line is removed. The other submodules (`account`, `reconcile`, `sync`, `enqueue`, `internal`, `lifecycle`, `collaboration`) remain.

- **Keep generic `request<T>` refactor in `client.ts`** and the shared `readJson`/`rateLimited`/`quotaExceeded` backend helpers. Only E2E helpers (`updateProject` with `encrypted`, `putUserKeys`/`getUserKeys`/`getProjectKeys`/`grantProjectKeys`) are removed.

- **Trim docs, not rewrite them.** Remove the E2E section and TOC/Features mentions from `README.md`, and the E2E migration sentences + checklist bullet from `deployment.md`.

## Risks / Trade-offs

- [Risk] Accidentally removing a line that onboarding or rate-limiting/quota depends on (e.g. the `readJson`/`RATE_LIMITER`/`quota` imports in shared files). → Mitigation: keep rate-limit/quota imports, the `./quotas` import in `projects.ts`, and all onboarding state/actions; verify with grep + typecheck/lint/tests after removal.
- [Risk] Lingering references cause runtime/type errors. → Mitigation: final grep for `encrypt|e2e|passphrase|decrypt|keyStore|getProjectDek|v1:` across `src` and `backend` must return nothing E2E-related; run backend jest and frontend typecheck/lint.
- [Risk] `package.json` migrate scripts still reference the deleted `0003_e2e_keys.sql`. → Mitigation: strip the `&& ... 0003_e2e_keys.sql` segment from both `migrate:local` and `migrate:remote`.
- [Trade-off] Removing `updateProject` helper from `client.ts` even though it is generic-shaped; it has no non-E2E caller, so deletion is safe.
