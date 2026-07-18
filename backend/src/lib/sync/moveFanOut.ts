import type { EntityType, SyncOperation } from '../../types';
import { jsonTableFor } from './shared';

export interface ChangeLogRow {
  projectId: string;
  operation: SyncOperation;
  patch: Record<string, unknown>;
}

/**
 * Decide whether a JSON-entity (task/note/todo) update is a cross-project move,
 * and if so, which change-log rows must be emitted. The change log is partitioned
 * by project_id, so a single update row can't reach members of both the old and
 * the new project: instead emit a 'create' row in the new project's log (so its
 * members materialize the entity) and a 'delete' row in the old project's log
 * (so its members drop it). Both rows inherit the acting mutation's client_id,
 * so the moving client skips them as echoes while everyone else applies them.
 *
 * Returns null for a non-move (the caller emits the normal single row). Pure —
 * unit-tested without a database.
 */
export function describeMoveFanOut(
  entityType: EntityType,
  operation: SyncOperation,
  existingProjectId: string | null,
  mutation: { projectId: string; patch: Record<string, unknown> }
): ChangeLogRow[] | null {
  if (operation !== 'update') return null;
  if (!jsonTableFor(entityType)) return null;
  if (!existingProjectId) return null;
  if (existingProjectId === mutation.projectId) return null;
  return [
    {
      projectId: mutation.projectId,
      operation: 'create',
      patch: mutation.patch,
    },
    { projectId: existingProjectId, operation: 'delete', patch: {} },
  ];
}
