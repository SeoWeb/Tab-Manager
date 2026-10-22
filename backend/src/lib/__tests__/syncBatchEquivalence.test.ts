import { describe, it, expect } from 'vitest';
import { syncProject } from '../sync';
import type { Env, SyncMutation, SyncMutationOutcome } from '../../types';
import type { DB, Row } from './cases/harness';
import { makeEnv, baseDb, versionOf, NOW } from './cases/harness';

/**
 * Batched-apply equivalence harness (change `scale-sync-backend`, spec
 * "Bounded round-trips per sync"):
 *
 * - the SAME synthetic 200-mutation sync (independent updates, distinct
 *   entities, valid baseVersions) is applied twice on two identical seeded
 *   databases — once with `SYNC_SERIAL_MODE=1`, once through the batched
 *   path — and must produce (a) identical outcome arrays and (b) an
 *   identical database end-state;
 * - the batched run must stay within 100 D1 round-trips, EXCLUDING the
 *   quota-guard reads (the entity-count read does not even run here — the
 *   request carries no creates — and the counter skips its SQL shape should
 *   one be added);
 * - a stale `baseVersion` inside a batched group conflicts THAT mutation
 *   only, leaves no changelog row / version bump for it, and unrelated
 *   mutations in the same request still apply.
 */

/** 200 entities: 40 per type, all live in p1 at version 2. */
const ENTITY_COUNT = 200;

function entityFor(i: number): {
  entityType: SyncMutation['entityType'];
  id: string;
} {
  const kind = i % 5;
  const id = `${['col', 'lnk', 'tsk', 'nt', 'td'][kind]}-${String(i).padStart(3, '0')}`;
  const entityType = (['collection', 'link', 'task', 'note', 'todo'] as const)[
    kind
  ];
  return { entityType, id };
}

function seededDb(): DB {
  const db = baseDb();
  db.project_members = [{ project_id: 'p1', user_id: 'u1', role: 'editor' }];
  for (let i = 0; i < ENTITY_COUNT; i++) {
    const { entityType, id } = entityFor(i);
    if (entityType === 'collection') {
      db.collections.push({
        id,
        project_id: 'p1',
        name: `Name ${i}`,
        deleted_at: null,
      });
    } else if (entityType === 'link') {
      db.links.push({
        id,
        project_id: 'p1',
        collection_id: null,
        url: `https://example.com/${i}`,
        title: `Link ${i}`,
        fav_icon_url: null,
        notes: null,
        tags_json: null,
        order_index: null,
        bookmark_id: null,
        deleted_at: null,
      });
    } else {
      const table = entityType === 'task' ? db.tasks : entityType === 'note' ? db.notes : db.todos;
      (table as Row[]).push({
        id,
        project_id: 'p1',
        collection_id: null,
        title: `Title ${i}`,
        payload_json: '{}',
        order_index: null,
        deleted_at: null,
      });
    }
    db.entity_versions.push({
      project_id: 'p1',
      entity_type: entityType,
      entity_id: id,
      version: 2,
      updated_at: NOW,
    });
  }
  return db;
}

/** The 200 independent update mutations (baseVersion 2 — the seeded version). */
function buildMutations(): SyncMutation[] {
  const mutations: SyncMutation[] = [];
  for (let i = 0; i < ENTITY_COUNT; i++) {
    const { entityType, id } = entityFor(i);
    mutations.push({
      clientMutationId: `cm-eq-${String(i).padStart(3, '0')}`,
      projectId: 'p1',
      clientId: 'client-1',
      createdAt: NOW,
      entityType,
      entityId: id,
      operation: 'update',
      baseVersion: 2,
      patch:
        entityType === 'collection'
          ? { name: `Batch ${i}` }
          : { title: `Batch ${i}` },
    });
  }
  return mutations;
}

/**
 * Wrap a harness env with a round-trip counting proxy: every solo statement
 * execution (first/all/run) and every batch call is counted. The entity-quota
 * COUNT read is excluded from the counter — the spec's budget explicitly
 * excludes quota-guard round-trips.
 */
function envCountingRoundTrips(
  base: Env
): { env: Env; counts: { batches: number; solo: number } } {
  const d1 = base.D1_DATABASE;
  const counts = { batches: 0, solo: 0 };
  const env = {
    ...base,
    D1_DATABASE: {
      prepare: (sql: string) => {
        const stmt = d1.prepare(sql);
        return {
          bind: (...params: unknown[]) => {
            const bound = stmt.bind(...params) as unknown as {
              first: () => Promise<unknown>;
              all: () => Promise<unknown>;
              run: () => Promise<unknown>;
              __exec: () => unknown;
            };
            const isQuotaGuardRead =
              /SELECT\s+\(SELECT COUNT\(\*\) FROM collections/.test(sql);
            return {
              first: async () => {
                if (!isQuotaGuardRead) counts.solo += 1;
                return bound.first();
              },
              all: async () => {
                if (!isQuotaGuardRead) counts.solo += 1;
                return bound.all();
              },
              run: async () => {
                if (!isQuotaGuardRead) counts.solo += 1;
                return bound.run();
              },
              __exec: () => bound.__exec(),
            };
          },
        };
      },
      batch: (stmts: Parameters<typeof d1.batch>[0]) => {
        counts.batches += 1;
        return d1.batch(stmts);
      },
    },
  } as unknown as Env;
  return { env, counts };
}

interface SyncResponseBody {
  cursor: number;
  changes: {
    entity_id: string;
    operation: string;
    client_mutation_id: string | null;
  }[];
  conflicts: unknown[];
  outcomes: SyncMutationOutcome[];
}

async function runSync(
  vars: Record<string, string>,
  mutations: SyncMutation[]
): Promise<{
  db: DB;
  body: SyncResponseBody;
  counts: { batches: number; solo: number };
}> {
  const db = seededDb();
  const { env, counts } = envCountingRoundTrips(makeEnv(db, vars));
  const response = await syncProject(
    env,
    { id: 'u1' },
    'p1',
    { lastCursor: null, mutations }
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as SyncResponseBody;
  return { db, body, counts };
}

function fieldOf(db: DB, entityType: string, id: string): unknown {
  if (entityType === 'collection')
    return db.collections.find((r) => r.id === id)?.name;
  if (entityType === 'link') return db.links.find((r) => r.id === id)?.title;
  const table =
    entityType === 'task' ? db.tasks : entityType === 'note' ? db.notes : db.todos;
  return (table as Row[]).find((r) => r.id === id)?.title;
}

/** Deterministic end-state fingerprint: per-entity version + merged field. */
function entityState(db: DB, mutations: SyncMutation[]) {
  return mutations.map((m) => ({
    id: m.entityId,
    version: versionOf(db, m.entityId),
    field: fieldOf(db, m.entityType, m.entityId),
  }));
}

/** Deterministic changelog fingerprint (ids/timestamps differ per run). */
function changelogFingerprint(db: DB) {
  return db.sync_changes.map((c) => ({
    entity_id: c.entity_id,
    operation: c.operation,
    client_mutation_id: c.client_mutation_id,
  }));
}

describe('batched apply is outcome- and state-equivalent to serial mode', () => {
  it('200 independent updates: identical outcomes, identical end-state, ≤100 round-trips batched', async () => {
    const mutations = buildMutations();

    const serial = await runSync({ SYNC_SERIAL_MODE: '1' }, mutations);
    const batched = await runSync({}, mutations);

    // (a) Identical outcome arrays: same length, per-index status match.
    expect(batched.body.outcomes).toHaveLength(ENTITY_COUNT);
    expect(serial.body.outcomes).toHaveLength(ENTITY_COUNT);
    expect(batched.body.outcomes).toEqual(serial.body.outcomes);
    expect(batched.body.outcomes.every((o) => o.status === 'applied')).toBe(
      true
    );
    expect(batched.body.conflicts).toEqual(serial.body.conflicts);

    // (b) Identical DB end-state: versions and merged entity fields.
    expect(entityState(batched.db, mutations)).toEqual(
      entityState(serial.db, mutations)
    );
    expect(
      entityState(batched.db, mutations).every(
        (s) => s.version === 3 && String(s.field).startsWith('Batch ')
      )
    ).toBe(true);
    // One changelog row per mutation in both, same content and order.
    expect(changelogFingerprint(batched.db)).toEqual(
      changelogFingerprint(serial.db)
    );
    expect(changelogFingerprint(batched.db)).toHaveLength(ENTITY_COUNT);

    // (c) Round-trips: batched ≤ 100 (quota-guard reads excluded; this
    // request carries no creates, so no quota-guard read even runs).
    const serialTotal = serial.counts.batches + serial.counts.solo;
    const batchedTotal = batched.counts.batches + batched.counts.solo;
    // eslint-disable-next-line no-console
    console.log(
      `[syncBatchEquivalence] 200-update sync round-trips — serial: ${serialTotal} (${serial.counts.batches} batches + ${serial.counts.solo} solo), batched: ${batchedTotal} (${batched.counts.batches} batches + ${batched.counts.solo} solo)`
    );
    expect(batchedTotal).toBeLessThanOrEqual(100);
    expect(batchedTotal).toBeLessThan(serialTotal);
  });

  it('mixed creates + independent updates stay equivalent and within budget', async () => {
    const creates: SyncMutation[] = [0, 1, 2].map((i) => ({
      clientMutationId: `cm-create-${i}`,
      projectId: 'p1',
      clientId: 'client-1',
      createdAt: NOW,
      entityType: 'task',
      entityId: `fresh-${i}`,
      operation: 'create',
      patch: { title: `Fresh ${i}` },
    }));
    // Updates on PRE-EXISTING entities (independent of the creates above —
    // updates on entities created in the same request are dependent by
    // definition and covered by the classification test below).
    const updates = buildMutations().slice(0, 20);
    const mutations = [...creates, ...updates];

    const serial = await runSync(
      { SYNC_SERIAL_MODE: '1', QUOTA_MAX_SYNC_MUTATIONS_PER_REQUEST: '500' },
      mutations
    );
    const batched = await runSync(
      { QUOTA_MAX_SYNC_MUTATIONS_PER_REQUEST: '500' },
      mutations
    );

    expect(batched.body.outcomes).toEqual(serial.body.outcomes);
    expect(batched.body.outcomes.every((o) => o.status === 'applied')).toBe(
      true
    );
    expect(entityState(batched.db, mutations)).toEqual(
      entityState(serial.db, mutations)
    );
    expect(changelogFingerprint(batched.db)).toEqual(
      changelogFingerprint(serial.db)
    );

    const serialTotal = serial.counts.batches + serial.counts.solo;
    const batchedTotal = batched.counts.batches + batched.counts.solo;
    // eslint-disable-next-line no-console
    console.log(
      `[syncBatchEquivalence] 3-create + 20-update sync round-trips — serial: ${serialTotal}, batched: ${batchedTotal}`
    );
    expect(batchedTotal).toBeLessThanOrEqual(100);
    // Created entities start a fresh version history at 1.
    for (const c of creates) expect(versionOf(batched.db, c.entityId)).toBe(1);
  });
});

describe('CAS conflict inside a batched group (§ Conflicts still detected under batching)', () => {
  it('one stale baseVersion conflicts exactly that mutation; unrelated mutations apply; no changelog/version rows for the conflict', async () => {
    const mutations = buildMutations().slice(0, 6);
    const staleIndex = 2; // a task (tsk-002)
    mutations[staleIndex] = {
      ...mutations[staleIndex]!,
      baseVersion: 1, // seeded version is 2
      patch: { title: 'loses the race' },
    };

    const { db, body } = await runSync({}, mutations);

    expect(body.outcomes).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      if (i === staleIndex) continue;
      expect(body.outcomes[i]?.status).toBe('applied');
    }
    expect(body.outcomes[staleIndex]).toMatchObject({
      clientMutationId: 'cm-eq-002',
      status: 'conflict',
      message: 'Entity version conflict',
    });
    // Exactly one top-level conflict, for that mutation — carrying the
    // authoritative in-batch current version.
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0]).toMatchObject({
      clientMutationId: 'cm-eq-002',
      message: 'Entity version conflict',
      currentVersion: 2,
      expectedVersion: 1,
    });

    // The conflicted mutation wrote NOTHING: field unchanged, version
    // unchanged, no changelog row for its clientMutationId.
    const stale = mutations[staleIndex]!;
    expect(fieldOf(db, stale.entityType, stale.entityId)).toBe('Title 2');
    expect(versionOf(db, stale.entityId)).toBe(2);
    expect(
      db.sync_changes.filter(
        (c) => c.client_mutation_id === 'cm-eq-002'
      )
    ).toHaveLength(0);

    // The unrelated mutations in the same batch applied fully.
    for (let i = 0; i < 6; i++) {
      if (i === staleIndex) continue;
      const m = mutations[i]!;
      expect(fieldOf(db, m.entityType, m.entityId)).toBe(`Batch ${i}`);
      expect(versionOf(db, m.entityId)).toBe(3);
      expect(
        db.sync_changes.filter(
          (c) => c.client_mutation_id === m.clientMutationId
        )
      ).toHaveLength(1);
    }
  });

  it('a not-found entity inside a batched group conflicts alone, zero writes for it', async () => {
    const mutations = buildMutations().slice(0, 4);
    mutations[1] = {
      ...mutations[1]!,
      entityId: 'ghost-entity',
      patch: { title: 'ghost' },
    };

    const { db, body } = await runSync({}, mutations);

    expect(body.outcomes[1]).toMatchObject({
      clientMutationId: mutations[1]!.clientMutationId,
      status: 'conflict',
      message: 'Entity not found or already deleted',
    });
    for (const i of [0, 2, 3]) {
      expect(body.outcomes[i]?.status).toBe('applied');
    }
    expect(versionOf(db, 'ghost-entity')).toBeUndefined();
  });

  it('an update without baseVersion is skipped (missing_base_version) while its batch applies', async () => {
    const mutations = buildMutations().slice(0, 4);
    mutations[3] = {
      ...mutations[3]!,
      baseVersion: undefined,
      patch: { title: 'no basis' },
    } as SyncMutation;

    const { db, body } = await runSync({}, mutations);

    expect(body.outcomes[3]).toEqual({
      clientMutationId: mutations[3]!.clientMutationId,
      status: 'skipped',
      reason: 'missing_base_version',
    });
    for (const i of [0, 1, 2]) {
      expect(body.outcomes[i]?.status).toBe('applied');
    }
    expect(fieldOf(db, mutations[3]!.entityType, mutations[3]!.entityId)).toBe(
      'Title 3'
    );
    expect(versionOf(db, mutations[3]!.entityId)).toBe(2);
  });

  it('a replayed clientMutationId inside a batched group is an idempotent applied with nothing written', async () => {
    // Two syncs against the SAME database: the second request re-submits
    // mutation 0 (same clientMutationId) among a fresh mutation.
    const db = seededDb();
    const env = makeEnv(db);
    const first = buildMutations().slice(0, 3);
    const firstResponse = await syncProject(env, { id: 'u1' }, 'p1', {
      lastCursor: null,
      mutations: first,
    });
    const firstBody = (await firstResponse.json()) as SyncResponseBody;
    expect(firstBody.outcomes.every((o) => o.status === 'applied')).toBe(true);
    expect(db.sync_changes).toHaveLength(3);

    const replay = first[0]!;
    const fresh = { ...buildMutations()[4]!, clientMutationId: 'cm-second-wave' };
    const secondResponse = await syncProject(env, { id: 'u1' }, 'p1', {
      lastCursor: null,
      mutations: [replay, fresh],
    });
    const secondBody = (await secondResponse.json()) as SyncResponseBody;
    expect(secondBody.outcomes.map((o) => o.status)).toEqual([
      'applied',
      'applied',
    ]);
    // Nothing was written for the replay: exactly ONE changelog row carries
    // its clientMutationId (from the first sync), and the fresh mutation
    // added the only new row.
    expect(
      db.sync_changes.filter((c) => c.client_mutation_id === replay.clientMutationId)
    ).toHaveLength(1);
    expect(db.sync_changes).toHaveLength(4);
    expect(fieldOf(db, replay.entityType, replay.entityId)).toBe('Batch 0');
    expect(versionOf(db, replay.entityId)).toBe(3);
    // The fresh mutation in the same batch still applied fully.
    expect(fieldOf(db, fresh.entityType, fresh.entityId)).toBe('Batch 4');
    expect(versionOf(db, fresh.entityId)).toBe(3);
  });
});

describe('dependency classification routes same-entity mutations through the serial path', () => {
  it('update-then-delete of the same entity applies in submission order', async () => {
    const db = seededDb();
    const env = makeEnv(db);
    const response = await syncProject(env, { id: 'u1' }, 'p1', {
      lastCursor: null,
      mutations: [
        {
          clientMutationId: 'cm-upd',
          projectId: 'p1',
          clientId: 'client-1',
          createdAt: NOW,
          entityType: 'task',
          entityId: 'tsk-002',
          operation: 'update',
          baseVersion: 2,
          patch: { title: 'before the delete' },
        },
        {
          clientMutationId: 'cm-del',
          projectId: 'p1',
          clientId: 'client-1',
          createdAt: NOW,
          entityType: 'task',
          entityId: 'tsk-002',
          operation: 'delete',
          baseVersion: 3, // the version the update in this request produced
          patch: {},
        },
      ],
    });

    const body = (await response.json()) as SyncResponseBody;
    expect(body.outcomes.map((o) => o.status)).toEqual(['applied', 'applied']);
    // Applied in order: the update's changelog row precedes the delete's.
    expect(db.sync_changes.map((c) => c.operation)).toEqual([
      'update',
      'delete',
    ]);
    expect(versionOf(db, 'tsk-002')).toBe(4);
    expect(db.tasks.find((t) => t.id === 'tsk-002')?.title).toBe(
      'before the delete'
    );
    expect(db.tasks.find((t) => t.id === 'tsk-002')?.deleted_at).not.toBeNull();
  });

  it('a stale delete following an update of the same entity conflicts on the bumped version', async () => {
    const db = seededDb();
    const env = makeEnv(db);
    const response = await syncProject(env, { id: 'u1' }, 'p1', {
      lastCursor: null,
      mutations: [
        {
          clientMutationId: 'cm-upd',
          projectId: 'p1',
          clientId: 'client-1',
          createdAt: NOW,
          entityType: 'task',
          entityId: 'tsk-002',
          operation: 'update',
          baseVersion: 2,
          patch: { title: 'bumped to 3' },
        },
        {
          clientMutationId: 'cm-del',
          projectId: 'p1',
          clientId: 'client-1',
          createdAt: NOW,
          entityType: 'task',
          entityId: 'tsk-002',
          operation: 'delete',
          baseVersion: 2, // stale: the update in this request already consumed it
          patch: {},
        },
      ],
    });

    const body = (await response.json()) as SyncResponseBody;
    expect(body.outcomes.map((o) => o.status)).toEqual(['applied', 'conflict']);
    expect(body.outcomes[1]?.message).toBe('Entity version conflict');
    // The update stands; the entity survives with the bumped version.
    expect(db.tasks.find((t) => t.id === 'tsk-002')?.deleted_at).toBeNull();
    expect(versionOf(db, 'tsk-002')).toBe(3);
  });

  it('an update on an entity created earlier in the SAME request applies after the create', async () => {
    const db = seededDb();
    const env = makeEnv(db);
    const response = await syncProject(env, { id: 'u1' }, 'p1', {
      lastCursor: null,
      mutations: [
        {
          clientMutationId: 'cm-create',
          projectId: 'p1',
          clientId: 'client-1',
          createdAt: NOW,
          entityType: 'task',
          entityId: 't-fresh',
          operation: 'create',
          patch: { title: 'created' },
        },
        {
          clientMutationId: 'cm-update',
          projectId: 'p1',
          clientId: 'client-1',
          createdAt: NOW,
          entityType: 'task',
          entityId: 't-fresh',
          operation: 'update',
          baseVersion: 1, // the version the create in this request produced
          patch: { title: 'updated right after' },
        },
      ],
    });

    const body = (await response.json()) as SyncResponseBody;
    expect(body.outcomes.map((o) => o.status)).toEqual(['applied', 'applied']);
    expect(db.tasks.find((t) => t.id === 't-fresh')?.title).toBe(
      'updated right after'
    );
    expect(versionOf(db, 't-fresh')).toBe(2);
    expect(db.sync_changes.map((c) => c.operation)).toEqual([
      'create',
      'update',
    ]);
  });

  it('a replay that races past the pre-read inside a batched group (UNIQUE violation) falls back to serial and stays equivalent', async () => {
    // Two DIFFERENT entities share one clientMutationId and the dedupe
    // pre-read is hidden, simulating a replay that races past the pre-check:
    // the batched write hits the migration-0004 UNIQUE index, the chunk rolls
    // back, and the engine falls back to the serial path — where the racing
    // mutation maps to an idempotent applied with nothing written.
    const run = async (mode: Record<string, string>) => {
      const db = seededDb();
      const base = makeEnv(db, mode);
      const d1 = base.D1_DATABASE;
      const env = {
        ...base,
        D1_DATABASE: {
          prepare: (sql: string) => {
            if (
              /SELECT id FROM sync_changes WHERE project_id = \? AND client_mutation_id = \?/.test(
                sql
              )
            ) {
              return {
                bind: () => ({
                  first: async () => null,
                  all: async () => ({ results: [] }),
                  run: async () => ({ meta: { changes: 0 } }),
                  __exec: () => ({ meta: { changes: 0 } }),
                }),
              };
            }
            return d1.prepare(sql);
          },
          batch: (stmts: Parameters<typeof d1.batch>[0]) => d1.batch(stmts),
        },
      } as unknown as Env;

      const mutations: SyncMutation[] = [
        { ...buildMutations()[0]!, clientMutationId: 'cm-shared' }, // col-000
        { ...buildMutations()[2]!, clientMutationId: 'cm-shared' }, // tsk-002
      ];
      const response = await syncProject(env, { id: 'u1' }, 'p1', {
        lastCursor: null,
        mutations,
      });
      expect(response.status).toBe(200);
      return { db, body: (await response.json()) as SyncResponseBody };
    };

    const serial = await run({ SYNC_SERIAL_MODE: '1' });
    const batched = await run({});

    // Both modes: the first mutation commits, the racing duplicate is an
    // idempotent success that wrote nothing.
    expect(batched.body.outcomes).toEqual(serial.body.outcomes);
    expect(batched.body.outcomes.map((o) => o.status)).toEqual([
      'applied',
      'applied',
    ]);
    expect(batched.db.collections.find((c) => c.id === 'col-000')?.name).toBe(
      'Batch 0'
    );
    expect(batched.db.tasks.find((t) => t.id === 'tsk-002')?.title).toBe(
      'Title 2'
    );
    expect(versionOf(batched.db, 'tsk-002')).toBe(2);
    // Exactly one changelog row for the shared id, in both modes.
    expect(
      batched.db.sync_changes.filter((c) => c.client_mutation_id === 'cm-shared')
    ).toHaveLength(1);
    expect(
      serial.db.sync_changes.filter((c) => c.client_mutation_id === 'cm-shared')
    ).toHaveLength(1);
  });

  it('SYNC_SERIAL_MODE=1 answers a mixed request identically to the batched path', async () => {
    const mutations: SyncMutation[] = [
      ...buildMutations().slice(0, 5),
      {
        ...buildMutations()[6]!,
        baseVersion: 1, // stale → conflict in both modes
      },
    ];

    const serial = await runSync({ SYNC_SERIAL_MODE: '1' }, mutations);
    const batched = await runSync({}, mutations);

    expect(batched.body.outcomes).toEqual(serial.body.outcomes);
    expect(batched.body.outcomes).toHaveLength(6);
    expect(batched.body.outcomes[5]?.status).toBe('conflict');
    expect(batched.body.outcomes[5]?.message).toBe(
      'Entity version conflict'
    );
    for (const i of [0, 1, 2, 3, 4]) {
      expect(batched.body.outcomes[i]?.status).toBe('applied');
    }
    expect(entityState(batched.db, mutations)).toEqual(
      entityState(serial.db, mutations)
    );
    expect(changelogFingerprint(batched.db)).toEqual(
      changelogFingerprint(serial.db)
    );
  });
});
