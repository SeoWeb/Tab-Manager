// Cloudflare sync orchestrator — barrel that re-exports the split modules.
//
// The orchestration logic used to live in a single ~1670-line file. It has been
// decomposed into focused modules under `./orchestrator/` (enqueue, account, sync,
// reconcile, lifecycle, collaboration) plus shared `internal` helpers.
// This file keeps the original public API so all existing callers import from
// `@/lib/cloudflareSync/orchestrator` unchanged.

export {
  enqueueCloudChange,
  enqueueCloudMutation,
} from './orchestrator/enqueue';
export {
  initCloudSync,
  setCloudApiBaseUrl,
  requestLoginCode,
  verifyAndConnect,
  verifyCloudAccount,
  disconnectCloudAccount,
} from './orchestrator/account';
export { syncProjectNow, syncAllCloudProjects } from './orchestrator/sync';
export {
  reconcileProject,
  reconcileAllCloudProjects,
} from './orchestrator/reconcile';
export {
  addCloudProject,
  convertProjectToCloud,
  disconnectProjectFromCloud,
} from './orchestrator/lifecycle';
export {
  refreshProjectRole,
  fetchProjectMembers,
  createProjectInviteCode,
  changeMemberRole,
  removeProjectMemberById,
  fetchProjectActivity,
  acceptInviteCode,
  discoverCloudProjects,
  importCloudProject,
} from './orchestrator/collaboration';
