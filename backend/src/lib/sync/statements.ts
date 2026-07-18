import type { Env, SyncMutation } from '../../types';
import { prepareInsertCollection, prepareUpdateCollection } from './statements/collection';
import { prepareInsertLink, prepareUpdateLink } from './statements/link';
import {
  prepareInsertJsonEntity,
  prepareUpdateJsonEntity,
} from './statements/jsonEntity';

export {
  prepareIncrementVersion,
  prepareInsertSyncChange,
  prepareInsertSyncChangeRow,
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
      throw new Error('Unsupported entity type');
  }
}

export async function prepareUpdate(
  env: Env,
  mutation: SyncMutation,
  now: string
): Promise<D1PreparedStatement | null> {
  switch (mutation.entityType) {
    case 'collection':
      return prepareUpdateCollection(env, mutation, now);
    case 'link':
      return prepareUpdateLink(env, mutation, now);
    case 'task':
    case 'note':
    case 'todo':
      return prepareUpdateJsonEntity(env, mutation, now);
    default:
      return null;
  }
}
