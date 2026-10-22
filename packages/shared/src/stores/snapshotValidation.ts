export type SnapshotValidation = { ok: true } | { ok: false; reason: string };

// Entity collections that must be arrays when present in a persisted
// snapshot. Absent keys and unknown keys are fine — validation only rejects
// clearly corrupt blobs.
const ARRAY_KEYS = [
  'projects',
  'quickLinks',
  'notes',
  'todos',
  'tasks',
  'taskTemplates',
  'pomodoroSessions',
  'syncConflicts',
] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Structural validation for a raw persisted snapshot (the JSON string read
// from `chrome.storage.local['tab-manager-storage']`). Permissive by design:
// only clearly corrupt blobs (unparseable JSON, missing envelope fields,
// wrong-typed entity collections) are rejected so the caller can quarantine
// them instead of letting garbage into the store.
export function validatePersistedSnapshot(
  raw: string | null
): SnapshotValidation {
  if (raw === null) {
    return { ok: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      reason: `unparseable JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, reason: 'envelope is not an object' };
  }

  const { version, state } = parsed;
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return {
      ok: false,
      reason: `invalid envelope version: ${JSON.stringify(version) ?? 'undefined'}`,
    };
  }

  if (!isPlainObject(state)) {
    return { ok: false, reason: 'state is not a plain object' };
  }

  for (const key of ARRAY_KEYS) {
    if (key in state && !Array.isArray(state[key])) {
      return { ok: false, reason: `state.${key} is present but not an array` };
    }
  }

  if ('cloudSync' in state && !isPlainObject(state.cloudSync)) {
    return {
      ok: false,
      reason: 'state.cloudSync is present but not an object',
    };
  }

  return { ok: true };
}
