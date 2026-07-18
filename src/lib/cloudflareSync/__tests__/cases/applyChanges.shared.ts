import { applyRemoteChanges } from '../../applyChanges';
import type { CloudEntityType, CloudSyncChange } from '../../types';

/** Build a change-log row with sane defaults, overridden per test. */
export function change(
  overrides: Partial<CloudSyncChange> &
    Pick<CloudSyncChange, 'entity_type' | 'entity_id' | 'project_id' | 'patch'>
): CloudSyncChange {
  return {
    id: 1,
    change_id: 'ch-1',
    actor_id: 'u-other',
    operation: 'create',
    base_version: null,
    client_mutation_id: null,
    client_id: 'ext-other',
    created_at: '2026-06-16T12:00:00.000Z',
    ...overrides,
  };
}

export const EMPTY = { projects: [], notes: [], todos: [], tasks: [] };

export { applyRemoteChanges };
export type { CloudEntityType };
