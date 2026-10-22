import { validatePersistedSnapshot } from '@tabspace/shared/stores/snapshotValidation';

const envelope = (state: unknown, version: unknown = 1) =>
  JSON.stringify({ state, version });

describe('validatePersistedSnapshot', () => {
  it('accepts null (nothing stored)', () => {
    expect(validatePersistedSnapshot(null)).toEqual({ ok: true });
  });

  it('accepts a valid envelope', () => {
    const raw = envelope({
      projects: [{ id: 'p1' }],
      quickLinks: [],
      cloudSync: { enabled: false },
    });
    expect(validatePersistedSnapshot(raw)).toEqual({ ok: true });
  });

  it('accepts absent entity keys and unknown extra keys (permissive)', () => {
    const raw = JSON.stringify({
      state: { unknownKey: { nested: true } },
      version: 1,
      extra: 'ignored',
    });
    expect(validatePersistedSnapshot(raw)).toEqual({ ok: true });
  });

  it('rejects unparseable JSON with a reason', () => {
    const result = validatePersistedSnapshot('{"state":{"projects":[]},"ver');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unparseable/i);
  });

  it('rejects a non-object envelope', () => {
    expect(validatePersistedSnapshot('"just a string"').ok).toBe(false);
    expect(validatePersistedSnapshot('42').ok).toBe(false);
    expect(validatePersistedSnapshot('null').ok).toBe(false);
  });

  it('rejects a missing, non-numeric, or non-finite version', () => {
    expect(validatePersistedSnapshot('{"state":{}}').ok).toBe(false);
    expect(validatePersistedSnapshot('{"state":{},"version":"1"}').ok).toBe(
      false
    );
    expect(validatePersistedSnapshot('{"state":{},"version":null}').ok).toBe(
      false
    );
    expect(validatePersistedSnapshot('{"state":{},"version":1e999}').ok).toBe(
      false
    );
  });

  it('rejects a missing, null, array, or non-object state', () => {
    expect(validatePersistedSnapshot('{"version":1}').ok).toBe(false);
    expect(validatePersistedSnapshot('{"version":1,"state":null}').ok).toBe(
      false
    );
    expect(validatePersistedSnapshot('{"version":1,"state":[1,2]}').ok).toBe(
      false
    );
    expect(validatePersistedSnapshot('{"version":1,"state":"oops"}').ok).toBe(
      false
    );
  });

  it('rejects entity keys that are present but not arrays', () => {
    const result = validatePersistedSnapshot(
      envelope({ projects: 'corrupted', todos: 42 })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('projects');
  });

  it('accepts every known entity key when it is an array', () => {
    const raw = envelope({
      projects: [],
      quickLinks: [],
      notes: [],
      todos: [],
      tasks: [],
      taskTemplates: [],
      pomodoroSessions: [],
      syncConflicts: [],
    });
    expect(validatePersistedSnapshot(raw)).toEqual({ ok: true });
  });

  it('rejects cloudSync that is present but not a non-null object', () => {
    expect(validatePersistedSnapshot(envelope({ cloudSync: null })).ok).toBe(
      false
    );
    expect(validatePersistedSnapshot(envelope({ cloudSync: 'off' })).ok).toBe(
      false
    );
    expect(
      validatePersistedSnapshot(envelope({ cloudSync: { enabled: true } })).ok
    ).toBe(true);
  });
});
