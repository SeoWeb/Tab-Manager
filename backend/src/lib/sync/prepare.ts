export {
  TABLE_COUNT_PLACEHOLDERS,
  entityNotFoundConflict,
  isEntityType,
  isNumber,
  isObjectRecord,
  isString,
  isSyncOperation,
  isValidMutation,
  jsonTableFor,
  nowIso,
  optionalNumber,
  optionalString,
  parseCursor,
  parseMutations,
  requireString,
  safeJsonParse,
  tableFor,
} from './shared';
export type { ApplyMutationResult, TableKey } from './shared';

export {
  entityExists,
  entityExistsBatch,
  getEntityVersion,
  getEntityVersionBatch,
} from './queries';

export {
  prepareIncrementVersion,
  prepareInsert,
  prepareInsertSyncChange,
  prepareInsertSyncChangeRow,
  prepareUpdate,
} from './statements';

export {
  applyProjectMutation,
  buildCreateStatements,
  buildEntityStatement,
} from './mutations';
