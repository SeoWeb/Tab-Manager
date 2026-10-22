export {
  TABLE_COUNT_PLACEHOLDERS,
  MutationPatchError,
  VERSION_GUARD_SQL,
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
  versionConflict,
  versionGuardBindings,
} from './shared';
export type { ApplyMutationResult, TableKey } from './shared';

export {
  entityExists,
  entityExistsBatch,
  getEntityVersion,
  getEntityVersionBatch,
} from './queries';

export {
  prepareCasIncrementVersion,
  prepareIncrementVersion,
  prepareInsert,
  prepareInsertSyncChange,
  prepareInsertSyncChangeRow,
  prepareReadEntityVersion,
  prepareSoftDelete,
  prepareUpdate,
  isUniqueMutationIdViolation,
} from './statements';

export {
  applyProjectMutation,
  buildCreateStatements,
  buildEntityStatement,
  commitEntityBatch,
  invalidPatchConflict,
  INVALID_MUTATION_PATCH_MESSAGE,
} from './mutations';
