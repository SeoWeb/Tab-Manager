import { gateMutationsByOutcomes } from '../outcomes';
import type { CloudMutation, SyncMutationOutcome } from '../types';

function mutation(id: string): CloudMutation {
  return {
    clientMutationId: id,
    projectId: 'p1',
    entityType: 'task',
    entityId: `t-${id}`,
    operation: 'update',
    patch: { title: id },
    clientId: 'c1',
    createdAt: '2026-10-20T00:00:00.000Z',
  };
}

function outcome(
  clientMutationId: string,
  status: SyncMutationOutcome['status'],
  extra: Partial<SyncMutationOutcome> = {}
): SyncMutationOutcome {
  return { clientMutationId, status, ...extra };
}

/** Spy on the console methods the gate logs to, silencing test output. */
function spyConsole(): {
  warn: jest.SpyInstance;
  error: jest.SpyInstance;
  restore: () => void;
} {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  return {
    warn,
    error,
    restore: () => {
      warn.mockRestore();
      error.mockRestore();
    },
  };
}

describe('gateMutationsByOutcomes', () => {
  let consoleSpies: ReturnType<typeof spyConsole>;

  beforeEach(() => {
    consoleSpies = spyConsole();
  });

  afterEach(() => {
    consoleSpies.restore();
  });

  it('retains conflicted mutations flagged, settles applied/skipped, keeps errors', () => {
    const mutations = [
      mutation('m-applied'),
      mutation('m-conflict'),
      mutation('m-skipped'),
      mutation('m-error'),
    ];
    const outcomes = [
      outcome('m-applied', 'applied'),
      outcome('m-conflict', 'conflict', { message: 'version conflict' }),
      outcome('m-skipped', 'skipped', { reason: 'project_mismatch' }),
      outcome('m-error', 'error', { message: 'boom' }),
    ];

    const { settled, conflicted, retained } = gateMutationsByOutcomes(
      mutations,
      outcomes
    );

    // Conflicted mutations are no longer settled for deletion
    // (fix-cross-context-data-loss 7.1): they come back in their own
    // partition so the caller flags and retains them.
    expect(settled.map((m) => m.clientMutationId)).toEqual([
      'm-applied',
      'm-skipped',
    ]);
    expect(conflicted.map((m) => m.clientMutationId)).toEqual(['m-conflict']);
    expect(retained.map((m) => m.clientMutationId)).toEqual(['m-error']);
  });

  it('matches outcomes by clientMutationId regardless of order', () => {
    const mutations = [mutation('m-1'), mutation('m-2'), mutation('m-3')];
    // Deliberately shuffled and reversed relative to the submissions.
    const outcomes = [
      outcome('m-3', 'error', { message: 'boom' }),
      outcome('m-1', 'applied'),
      outcome('m-2', 'skipped', { reason: 'invalid_mutation' }),
    ];

    const { settled, retained } = gateMutationsByOutcomes(mutations, outcomes);

    expect(settled.map((m) => m.clientMutationId)).toEqual(['m-1', 'm-2']);
    expect(retained.map((m) => m.clientMutationId)).toEqual(['m-3']);
  });

  it('never settles the wrong mutation when ids do not line up', () => {
    const mutations = [mutation('m-1')];
    // An outcome for a different mutation must not settle m-1.
    const outcomes = [outcome('m-other', 'applied')];

    const { settled, retained } = gateMutationsByOutcomes(mutations, outcomes);

    expect(settled).toEqual([]);
    expect(retained.map((m) => m.clientMutationId)).toEqual(['m-1']);
  });

  it('retains and warns for mutations with a missing outcome entry', () => {
    const mutations = [mutation('m-1'), mutation('m-2')];
    const outcomes = [outcome('m-2', 'applied')];

    const { settled, retained } = gateMutationsByOutcomes(mutations, outcomes);

    expect(settled.map((m) => m.clientMutationId)).toEqual(['m-2']);
    expect(retained.map((m) => m.clientMutationId)).toEqual(['m-1']);
    expect(consoleSpies.warn).toHaveBeenCalledWith(
      expect.stringContaining('no outcome reported for mutation m-1')
    );
  });

  it('treats a missing outcomes array as all-retained (older server)', () => {
    const mutations = [mutation('m-1'), mutation('m-2')];

    const { settled, retained } = gateMutationsByOutcomes(mutations, undefined);

    expect(settled).toEqual([]);
    expect(retained.map((m) => m.clientMutationId)).toEqual(['m-1', 'm-2']);
  });

  it('logs skipped outcomes with the id and reason, errors with id and message', () => {
    const mutations = [mutation('m-skip'), mutation('m-err')];
    const outcomes = [
      outcome('m-skip', 'skipped', { reason: 'missing_base_version' }),
      outcome('m-err', 'error', { message: 'storage full' }),
    ];

    gateMutationsByOutcomes(mutations, outcomes);

    expect(consoleSpies.warn).toHaveBeenCalledWith(
      expect.stringContaining('m-skip')
    );
    expect(consoleSpies.warn).toHaveBeenCalledWith(
      expect.stringContaining('missing_base_version')
    );
    expect(consoleSpies.error).toHaveBeenCalledWith(
      expect.stringContaining('m-err')
    );
    expect(consoleSpies.error).toHaveBeenCalledWith(
      expect.stringContaining('storage full')
    );
    // Errors are never dropped silently, so they must not be logged as warns.
    expect(consoleSpies.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('m-err')
    );
  });

  it('conservatively retains mutations with an unknown outcome status', () => {
    const mutations = [mutation('m-1')];
    const outcomes = [
      // Simulates a newer server reporting a status this client doesn't know.
      {
        clientMutationId: 'm-1',
        status: 'mysterious',
      } as unknown as SyncMutationOutcome,
    ];

    const { settled, retained } = gateMutationsByOutcomes(mutations, outcomes);

    expect(settled).toEqual([]);
    expect(retained.map((m) => m.clientMutationId)).toEqual(['m-1']);
    expect(consoleSpies.warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown outcome')
    );
  });
});
