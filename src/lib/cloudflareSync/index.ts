// Cloudflare sync client (Phase 2): local-first mutation queue, API client,
// remote-change applier, and orchestrator wired to the Zustand store.
// Phase 4 adds collaboration (members, invitations, activity) + role helpers.
// Phase 5 adds background sync, a coordination lock, and realtime presence.

export {
  CloudSyncApiError,
  getCurrentUser,
  listProjects,
  createProject,
  getProject,
  getProjectMembers,
  createProjectInvitation,
  acceptProjectInvitation,
  updateMemberRole,
  removeProjectMember,
  getProjectActivity,
  syncProject,
} from './client';
export {
  initCloudSync,
  setCloudApiBaseUrl,
  requestLoginCode,
  verifyAndConnect,
  verifyCloudAccount,
  disconnectCloudAccount,
  enqueueCloudMutation,
  enqueueCloudChange,
  addCloudProject,
  convertProjectToCloud,
  disconnectProjectFromCloud,
  syncProjectNow,
  syncAllCloudProjects,
  reconcileProject,
  reconcileAllCloudProjects,
  refreshProjectRole,
  fetchProjectMembers,
  createProjectInviteCode,
  changeMemberRole,
  removeProjectMemberById,
  fetchProjectActivity,
  acceptInviteCode,
} from './orchestrator';
export { applyRemoteChanges } from './applyChanges';
export type { ApplyChangesInput, ApplyChangesResult } from './applyChanges';
export * as cloudQueue from './queue';
export {
  roleAtLeast,
  canEdit,
  canManageMembers,
  isOwner,
  CLOUD_ROLES,
  CLOUD_ROLE_RANK,
} from './roles';
// Phase 5: background sync, coordination lock, realtime presence.
export { backgroundSyncAll, backgroundReconcileAll } from './backgroundSync';
export {
  acquireSyncLock,
  releaseSyncLock,
  isSyncLockedByOther,
  LOCK_FRESH_MS,
} from './syncLock';
export {
  connectProjectRealtime,
  disconnectProjectRealtime,
  isRealtimeConnected,
  handleRealtimeMessage,
  realtimeUrl,
} from './realtime';
export type { RealtimeStoreLike } from './realtime';
export type {
  CloudAccount,
  CloudEntityType,
  CloudPresenceUser,
  CloudMutation,
  CloudOperation,
  CloudProject,
  CloudProjectDetail,
  CloudRole,
  CloudMember,
  CloudMembersResponse,
  CloudInvitation,
  CloudAcceptedInvitation,
  CloudMemberRoleUpdate,
  CloudMemberRemoval,
  CloudActivityResponse,
  CloudSyncChange,
  CloudSyncConflict,
  CloudSyncResponse,
  CloudSyncState,
  CloudSyncStatus,
  CloudVerifyResponse,
} from './types';
