// Phase B1: the note/todo/task action factories must enqueue cloud mutations
// with the shape the backend stores and applyChanges reads back. The real
// orchestrator pulls in the appStore (which imports ESM-only nanoid), so the
// orchestrator is mocked; the patch builders (entityPatches) run for real.

jest.mock('@/lib/cloudflareSync/orchestrator', () => ({
  enqueueCloudChange: jest.fn(),
}));
// uiActions imports nanoid (ESM-only) and tabService; stub both so the action
// factory can be imported under Jest's CJS transform.
jest.mock('nanoid', () => ({ nanoid: () => 'generated-id' }));
jest.mock('@/lib/tabService', () => ({ getAllWindows: jest.fn() }));
jest.mock('@/lib/bookmarkStorage', () => ({
  bookmarkStorage: {
    deleteProject: jest.fn(),
  },
}));
jest.mock('@/lib/bookmarkSyncService', () => ({
  bookmarkSyncService: {
    performFullSync: jest.fn(),
  },
}));

import { enqueueCloudChange } from '@/lib/cloudflareSync/orchestrator';
import { createNoteActions } from '@/stores/actions/noteActions';
import { createTaskActions } from '@/stores/actions/taskActions';
import { createUIActions } from '@/stores/actions/uiActions';
import { createProjectActions } from '@/stores/actions/projectActions';
import { createCloudSyncActions } from '@/stores/actions/cloudSyncActions';
import type { AppState } from '@/stores/types';
import type { AdvancedTask } from '@/types/tasks';

export const mockedEnqueue = enqueueCloudChange as jest.MockedFunction<
  typeof enqueueCloudChange
>;

/**
 * Minimal live-store harness: `set` merges partials (zustand-style), `get`
 * returns the current state. Tests only seed the slice of AppState they touch,
 * so the seed is loosely typed; it is cast to the full AppState internally and
 * only the fields actually read by the actions under test need to be present.
 */
export function makeStore(initial: Record<string, unknown>) {
  let state = initial as unknown as AppState;
  const get = (): AppState => state;
  const set = (
    updater:
      | ((s: AppState) => AppState | Partial<AppState>)
      | Partial<AppState>
  ): void => {
    const partial = typeof updater === 'function' ? updater(state) : updater;
    state = { ...state, ...partial } as AppState;
  };
  return { get, set };
}

export const PROJECT = { id: 'proj-1', cloudEnabled: true, collections: [] };

export function lastCall() {
  const calls = mockedEnqueue.mock.calls;
  return calls[calls.length - 1]?.[0];
}

/** Pull the payload object out of a recorded enqueue call (typed for access). */
export function payloadOf(call: unknown): Record<string, unknown> {
  return (call as { patch: { payload: Record<string, unknown> } }).patch
    .payload;
}

export type { AdvancedTask };
export { createNoteActions, createTaskActions, createUIActions, createProjectActions, createCloudSyncActions };
