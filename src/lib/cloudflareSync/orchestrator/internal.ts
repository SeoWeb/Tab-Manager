import { useAppStore } from '@/stores/appStore';
import type { CloudSyncStatus, DirtyFields } from '../types';

/**
 * Shared internal helpers used across the orchestrator modules. These are not
 * part of the public API and are kept here to avoid duplication.
 */

function setCloudState(
  patch: Partial<{
    enabled: boolean;
    status: CloudSyncStatus;
    lastSyncedAt: string | null;
    lastReconciledAt: string | null;
    lastError: string | null;
    pendingMutationCount: number;
    pendingEdits: DirtyFields;
    account: import('../types').CloudAccount | null;
    apiBaseUrl: string;
  }>
): void {
  useAppStore.getState().setCloudSyncState(patch);
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function nowIso(): string {
  return new Date().toISOString();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

function formatConflicts(
  projectId: string,
  conflicts: { entityType: string; entityId: string; message: string }[]
): string {
  const first = conflicts[0];
  return `${conflicts.length} sync conflict(s) for project ${projectId}: ${first.entityType} ${first.entityId} — ${first.message}`;
}

export { setCloudState, isOnline, nowIso, errorMessage, formatConflicts };
