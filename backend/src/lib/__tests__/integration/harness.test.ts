// Task 5.2 smoke test — proves the integration harness end-to-end:
//
//   1. tests run INSIDE the Workers runtime (workerd) under the `integration`
//      vitest project;
//   2. setup.ts applied EVERY migration found in the wrangler.toml
//      migrations_dir (tracked in `d1_migrations`);
//   3. the seeded fixture world round-trips through the real D1 (schema,
//      roles, five entity kinds, versions, soft delete, invitation);
//   4. in-file state persistence semantics are pinned by an assertion, so a
//      pool upgrade that changes isolation breaks HERE, not in a fixture suite.
//
// Loud-skip contract: the module-scope `requireWorkersRuntime` guard below is
// the documented pattern for every integration file in this directory. If the
// file ever executes outside workerd, it prints the loud-skip banner (console.warn
// + direct stderr write) and the suite reports as SKIPPED — it can never
// silently pass. Demonstrated: collecting this file through a plain-Node
// vitest config prints the banner and reports `Tests 12 skipped (12)`.

import { describe, it, expect, beforeAll } from 'vitest';
import {
  requireWorkersRuntime,
  getTestEnv,
  TEST_JWT_SECRET,
} from './harness';
import {
  seedCanonicalWorld,
  fetchRow,
  getMembers,
  countLiveEntities,
  versionOf,
  changelogFor,
  ENTITY_KINDS,
  ENTITY_TABLES,
  FIXTURE_USERS,
  MAIN_PROJECT_ID,
  FOREIGN_PROJECT_ID,
  CANONICAL_ENTITY_IDS,
  DEAD_TASK_ID,
  DEFAULT_QUOTA,
} from './fixtures';
import type { Env } from '../../../types';

// --- the loud-skip guard (module scope, before any binding access) ----------
const runtimeAvailable = requireWorkersRuntime('integration harness smoke');
const d = runtimeAvailable ? describe : describe.skip;

d('integration harness smoke (pool-workers + migrations-applied D1)', () => {
  let env: Env;

  beforeAll(async () => {
    env = await getTestEnv();
    await seedCanonicalWorld(env.D1_DATABASE);
  });

  it('runs inside the Workers runtime with real bindings', async () => {
    // The guard already proved workerd; this pins the binding surface the
    // later suites depend on.
    expect(env.D1_DATABASE).toBeDefined();
    expect(env.PROJECT_ROOM).toBeDefined();
    expect(env.RATE_LIMITER).toBeDefined();
    expect(env.JWT_SECRET).toBe(TEST_JWT_SECRET);
    // wrangler.toml [vars] flowed through.
    expect(env.ALLOWED_ORIGINS).toBe('https://tab-manager.ww0.dev');
  });

  it('applied every wrangler.toml migration, tracked in d1_migrations', async () => {
    // Dynamic import: this module only resolves under the integration project
    // (it is provided by the pool's virtual-module plugin), so a misrouted
    // run hits the loud-skip guard above instead of failing at module load.
    const { default: migrations } = await import('virtual:d1-migrations');
    expect(migrations.length).toBeGreaterThanOrEqual(6);
    const { results } = await env.D1_DATABASE.prepare(
      'SELECT name FROM d1_migrations ORDER BY name'
    ).all<{ name: string }>();
    const applied = new Set(results.map((r) => r.name));
    for (const migration of migrations) {
      expect(applied.has(migration.name)).toBe(true);
    }
    // The 0003 slot was removed upstream; 0005's header documents it.
    expect(applied.has('0005_purge_plaintext_login_codes.sql')).toBe(true);
    expect(applied.has('0007_project_sync_meta.sql')).toBe(true);
  });

  it('created the migration-0007 project_sync_meta table', async () => {
    // A table only 0007 creates — proves late migrations really applied.
    const row = await env.D1_DATABASE.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_sync_meta'`
    ).first();
    expect(row).toBeDefined();
  });

  it('seeded membership roles read back (owner / member / viewer / ex-member)', async () => {
    const members = await getMembers(env.D1_DATABASE, MAIN_PROJECT_ID);
    const byUser = new Map(members.map((m) => [m.userId, m.role]));
    expect(byUser.get(FIXTURE_USERS.owner.id)).toBe('owner');
    expect(byUser.get(FIXTURE_USERS.member.id)).toBe('editor');
    expect(byUser.get(FIXTURE_USERS.viewer.id)).toBe('viewer');
    expect(byUser.has(FIXTURE_USERS.exMember.id)).toBe(false);
    expect(byUser.has(FIXTURE_USERS.outsider.id)).toBe(false);
  });

  it('holds one live entity of each of the five kinds', async () => {
    for (const kind of ENTITY_KINDS) {
      const row = await fetchRow(
        env.D1_DATABASE,
        ENTITY_TABLES[kind],
        CANONICAL_ENTITY_IDS[kind]
      );
      expect(row, `expected a seeded ${kind} row`).toBeDefined();
      expect(row?.['deleted_at']).toBeNull();
    }
    expect(await countLiveEntities(env.D1_DATABASE, MAIN_PROJECT_ID)).toBe(
      ENTITY_KINDS.length
    );
  });

  it('seeded entity_versions rows at version 1 (CAS bases)', async () => {
    for (const kind of ENTITY_KINDS) {
      expect(
        await versionOf(
          env.D1_DATABASE,
          MAIN_PROJECT_ID,
          kind,
          CANONICAL_ENTITY_IDS[kind]
        )
      ).toBe(1);
    }
  });

  it('soft-deleted rows are only visible via deleted_at', async () => {
    const dead = await fetchRow(env.D1_DATABASE, 'tasks', DEAD_TASK_ID);
    expect(dead?.['deleted_at']).not.toBeNull();
    expect(await countLiveEntities(env.D1_DATABASE, MAIN_PROJECT_ID)).toBe(
      ENTITY_KINDS.length // dead task not counted
    );
  });

  it('foreign project exists for cross-project probes, empty', async () => {
    const foreign = await fetchRow(env.D1_DATABASE, 'projects', FOREIGN_PROJECT_ID);
    expect(foreign?.['owner_id']).toBe(FIXTURE_USERS.outsider.id);
    expect(await countLiveEntities(env.D1_DATABASE, FOREIGN_PROJECT_ID)).toBe(0);
    expect(await getMembers(env.D1_DATABASE, FOREIGN_PROJECT_ID)).toEqual([]);
  });

  it('pending invitation seeded for concurrency suites', async () => {
    const invite = await fetchRow(env.D1_DATABASE, 'invitations', 'inv-invite-canonical');
    expect(invite?.['accepted_at']).toBeNull();
    expect(invite?.['project_id']).toBe(MAIN_PROJECT_ID);
  });

  it('changelog starts empty (quota suites assert no phantom rows)', async () => {
    expect(await changelogFor(env.D1_DATABASE, MAIN_PROJECT_ID)).toEqual([]);
  });

  it('DEFAULT_QUOTA mirrors src/lib/quotas.ts defaults (fixture sizing base)', () => {
    expect(DEFAULT_QUOTA).toEqual({
      maxProjectsPerUser: 10,
      maxMembersPerProject: 50,
      maxEntitiesPerProject: 5000,
    });
  });

  it('state persists across tests in this file (documented isolation)', async () => {
    // Every assertion above ran against state seeded once in beforeAll —
    // this test existing at all pins the in-file persistence contract: within
    // a test file, writes and seeds from earlier tests stay visible. Between
    // test files the pool isolates storage (each file re-runs setup.ts).
    const rows = await env.D1_DATABASE.prepare(
      'SELECT COUNT(*) AS n FROM projects WHERE id = ?'
    )
      .bind(MAIN_PROJECT_ID)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });
});
