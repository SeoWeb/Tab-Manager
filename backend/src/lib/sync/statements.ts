import type { Env, SyncMutation } from '../../types';
import { MutationPatchError, VERSION_GUARD_SQL } from './shared';
import {
  buildCollectionUpdateStatement,
  prepareInsertCollection,
  prepareReadCollectionRow,
  prepareUpdateCollection,
  type CollectionRow,
} from './statements/collection';
import {
  buildLinkUpdateStatement,
  prepareInsertLink,
  prepareReadLinkRow,
  prepareUpdateLink,
  type LinkRow,
} from './statements/link';
import {
  buildJsonEntityUpdateStatement,
  prepareInsertJsonEntity,
  prepareReadJsonEntityRow,
  prepareUpdateJsonEntity,
  type JsonEntityRow,
} from './statements/jsonEntity';

export {
  prepareCasIncrementVersion,
  prepareIncrementVersion,
  prepareInsertSyncChange,
  prepareInsertSyncChangeRow,
  prepareReadEntityVersion,
  isUniqueMutationIdViolation,
} from './statements/changelog';

export function prepareInsert(
  env: Env,
  mutation: SyncMutation,
  now: string,
  guardSql?: string,
  guardArgs?: unknown[]
): D1PreparedStatement {
  switch (mutation.entityType) {
    case 'collection':
      return prepareInsertCollection(env, mutation, now, guardSql, guardArgs);
    case 'link':
      return prepareInsertLink(env, mutation, now, guardSql, guardArgs);
    case 'task':
    case 'note':
    case 'todo':
      return prepareInsertJsonEntity(env, mutation, now, guardSql, guardArgs);
    default:
      throw new MutationPatchError('Unsupported entity type');
  }
}

/**
 * Project-scoped soft delete. When `baseVersion` is supplied the statement is
 * CAS-guarded (only commits while the entity's version still equals it);
 * otherwise it is the legacy unguarded delete. The WHERE clause always filters
 * on BOTH `id` and `project_id` — a delete can never touch another project's
 * row, even for a colliding entity id.
 */
export function prepareSoftDelete(
  env: Env,
  table: string,
  entityId: string,
  projectId: string,
  now: string,
  entityType: SyncMutation['entityType'],
  baseVersion?: number
): D1PreparedStatement {
  const guardSql =
    baseVersion === undefined ? '' : ` ${VERSION_GUARD_SQL}`;
  return env.D1_DATABASE.prepare(
    `
    UPDATE ${table}
    SET deleted_at = ?, updated_at = ?
    WHERE id = ? AND project_id = ? AND deleted_at IS NULL${guardSql}
    `
  ).bind(
    now,
    now,
    entityId,
    projectId,
    ...(baseVersion === undefined
      ? []
      : [projectId, entityType, entityId, baseVersion])
  );
}

/**
 * Project-scoped update dispatcher. The row read and the UPDATE are both
 * filtered by `projectId`, and no builder ever puts `project_id` in the SET
 * list. `baseVersion` (when defined) turns the write into a CAS.
 */
export async function prepareUpdate(
  env: Env,
  mutation: SyncMutation,
  projectId: string,
  now: string,
  baseVersion?: number
): Promise<D1PreparedStatement | null> {
  switch (mutation.entityType) {
    case 'collection':
      return prepareUpdateCollection(env, mutation, projectId, now, baseVersion);
    case 'link':
      return prepareUpdateLink(env, mutation, projectId, now, baseVersion);
    case 'task':
    case 'note':
    case 'todo':
      return prepareUpdateJsonEntity(env, mutation, projectId, now, baseVersion);
    default:
      return null;
  }
}

/**
 * Project-scoped current-row read for an update's field merge — the read the
 * serial path performs inside `prepareUpdate`. Exported so the batched apply
 * path can fan one read per mutation through a single shared D1 batch instead
 * of paying a round-trip per mutation. Returns null for unsupported types.
 */
export function prepareReadEntityRow(
  env: Env,
  mutation: SyncMutation,
  projectId: string
): D1PreparedStatement | null {
  switch (mutation.entityType) {
    case 'collection':
      return prepareReadCollectionRow(env, mutation, projectId);
    case 'link':
      return prepareReadLinkRow(env, mutation, projectId);
    case 'task':
    case 'note':
    case 'todo':
      return prepareReadJsonEntityRow(env, mutation, projectId);
    default:
      return null;
  }
}

/**
 * Update merge + build from an ALREADY-READ row (`prepareReadEntityRow`'s
 * result). The batched apply path uses this pair — batched reads, then this
 * pure build — so the generated SQL is byte-identical to the serial path's
 * `prepareUpdate`. Returns null when the row is missing (the caller maps that
 * to the not-found conflict, like the serial path). May throw
 * `MutationPatchError` for invalid patch data, exactly like the serial build.
 */
export function prepareUpdateFromRow(
  env: Env,
  mutation: SyncMutation,
  projectId: string,
  now: string,
  baseVersion: number | undefined,
  existing: unknown
): D1PreparedStatement | null {
  switch (mutation.entityType) {
    case 'collection':
      return buildCollectionUpdateStatement(
        env,
        mutation,
        projectId,
        now,
        baseVersion,
        existing as CollectionRow | null
      );
    case 'link':
      return buildLinkUpdateStatement(
        env,
        mutation,
        projectId,
        now,
        baseVersion,
        existing as LinkRow | null
      );
    case 'task':
    case 'note':
    case 'todo':
      return buildJsonEntityUpdateStatement(
        env,
        mutation,
        projectId,
        now,
        baseVersion,
        existing as JsonEntityRow | null
      );
    default:
      return null;
  }
}
