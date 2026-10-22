// Task 5.5 — concurrency races against REAL D1 (workerd), openspec change
// `cleanup-and-regression-tests`:
//
//   1. invitation-accept race      — two concurrent `acceptInvitation` calls
//                                    through the real handler
//                                    (src/lib/invitations.ts); pins that one
//                                    invitation produces exactly one membership
//                                    and one accepted_at write;
//   2. login-code verify races     — concurrent `verifyLoginCode` calls
//                                    (src/lib/login.ts): single-use consume,
//                                    atomic attempt counting, brute-force cap;
//   3. CAS version conflicts       — two concurrent `syncProject` updates built
//                                    from the same baseVersion
//                                    (src/lib/sync.ts → sync/batched.ts →
//                                    sync/mutations.ts commitEntityBatch).
//
// Suite-local fixtures live in fixtures-concurrency.ts; the shared
// `fixtures.ts` is treated as read-only per its header contract.
//
// EMAIL note: the login flow is driven by seeding `login_codes` rows directly
// (seedLoginCode → the production salted-SHA-256 verifier) and calling
// `verifyLoginCode` — requestLoginCode (the only EMAIL consumer) is never
// invoked, so no EMAIL binding mock is needed under `remoteBindings: false`.

import { describe, it, expect, beforeAll } from 'vitest';
import { requireWorkersRuntime, getTestEnv } from './harness';
import {
  changelogFor,
  fetchRow,
  getMembers,
  loginCodeAttempts,
  MAX_CODE_ATTEMPTS,
  seedLoginCode,
  versionOf,
} from './fixtures';
import {
  seedCasScene,
  seedInvitationRaceScene,
  seedRaceUsers,
  syncResponseBody,
  updateMutation,
  verifyLoginCodeRequest,
} from './fixtures-concurrency';
import { acceptInvitation } from '../../projects';
import { verifyLoginCode } from '../../login';
import { syncProject } from '../../sync';
import type { Env } from '../../../types';

// --- the loud-skip guard (module scope, before any binding access) ----------
const runtimeAvailable = requireWorkersRuntime('concurrency races (task 5.5)');
const d = runtimeAvailable ? describe : describe.skip;

/** Body of the structured error responses (src/lib/response.ts). */
interface ErrorBody {
  error: { message: string; details?: unknown };
}

async function errorBody(response: Response): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

d('concurrency races (task 5.5)', () => {
  let env: Env;

  beforeAll(async () => {
    env = await getTestEnv();
  });

  // -------------------------------------------------------------------------
  // 1. Invitation-accept race
  //
  // KNOWN BUGS FOUND BY THIS SUITE (report-only per the task's TEST-ONLY
  // contract — source is NOT fixed here):
  //
  //  (a) Same-user double accept — src/lib/invitations.ts `acceptInvitation`:
  //      both racing calls pass the pre-checks (invitation SELECT + member
  //      SELECT) before either guarded INSERT commits, and the loser's
  //      `INSERT INTO project_members` dies on the schema-level
  //      UNIQUE(project_id, user_id) constraint (0001_init.sql:31) with a RAW
  //      D1_ERROR — `enforceCount` (src/lib/quotas.ts:91) does not catch it, so
  //      the worker's top-level handler (src/index.ts:107-112) would answer a
  //      500 instead of an honest already-accepted/already-member response.
  //      Data stays CORRECT (exactly one membership, accepted_at written once)
  //      — only the loser's status is wrong.
  //
  //  (b) Two-user same-code race — the single-use guarantee of an invitation
  //      is NOT enforced under concurrency: the guarded INSERT only guards the
  //      member-count QUOTA (`WHERE (member count) < max`,
  //      src/lib/invitations.ts:160-177) — it never checks the invitation's
  //      accepted_at, and the dependent UPDATE
  //      (`UPDATE invitations SET accepted_at = ? WHERE id = ?`,
  //      src/lib/invitations.ts:182-185) is unconditional. Both racing accepts
  //      observe "unaccepted + not a member", BOTH inserts commit, and ONE
  //      invitation yields TWO memberships, both answered 200 {accepted:true}.
  //
  // Each bug has an `it.fails` tripwire below: it asserts the REQUIRED
  // semantics, so it PASSES while the bug exists (the assertion fails, the
  // `.fails` modifier inverts that) and goes RED the moment the handler is
  // fixed — at which point the tripwire must be flipped to a plain `it`.
  // -------------------------------------------------------------------------
  d('invitation-accept race', () => {
    it('same user accepting twice concurrently: membership + accepted_at written exactly once (data integrity)', async () => {
      const scene = await seedInvitationRaceScene(env.D1_DATABASE, {
        projectId: 'p-race-same-user',
        ownerId: 'u-race-same-owner',
        code: 'invite-race-same-user',
      });
      const racer = (await seedRaceUsers(
        env.D1_DATABASE,
        'u-race-same',
        1
      ))[0]!;

      const settled = await Promise.allSettled([
        acceptInvitation(env, racer, scene.invitation.code),
        acceptInvitation(env, racer, scene.invitation.code),
      ]);

      // Data integrity holds regardless of the interleaving: exactly ONE
      // membership row (the UNIQUE(project_id, user_id) constraint backstops
      // the guarded INSERT) and the invitation is accepted.
      const members = await getMembers(env.D1_DATABASE, scene.projectId);
      expect(
        members.filter((m) => m.userId === racer.id),
        'membership row created exactly once'
      ).toHaveLength(1);
      expect(members).toHaveLength(2); // owner + the racer
      const invite = await fetchRow(
        env.D1_DATABASE,
        'invitations',
        scene.invitation.id
      );
      expect(invite?.['accepted_at']).not.toBeNull();

      // At least one accept went through with a structured 200.
      const responses = settled.filter(
        (s): s is PromiseFulfilledResult<Response> => s.status === 'fulfilled'
      );
      expect(responses.length).toBeGreaterThanOrEqual(1);
      expect(responses.some((s) => s.value.status === 200)).toBe(true);

      // No phantom changelog: the invitation path never writes sync_changes.
      expect(await changelogFor(env.D1_DATABASE, scene.projectId)).toEqual([]);
    });

    it.fails('same user, concurrent accepts: the loser is an honest structured outcome, never a 500-class failure', async () => {
      // REQUIRED semantics (regression tripwire for KNOWN BUG (a) above):
      // every racing accept answers with a structured Response below 500 —
      // today the loser rejects with a raw D1 UNIQUE-constraint error, which
      // the worker would surface as a 500. When acceptInvitation is fixed,
      // this body will PASS and `it.fails` goes red — flip it to `it`.
      const scene = await seedInvitationRaceScene(env.D1_DATABASE, {
        projectId: 'p-race-same-user-honest',
        ownerId: 'u-race-same-honest-owner',
        code: 'invite-race-same-user-honest',
      });
      const racer = (
        await seedRaceUsers(env.D1_DATABASE, 'u-race-same-honest', 1)
      )[0]!;

      const settled = await Promise.allSettled([
        acceptInvitation(env, racer, scene.invitation.code),
        acceptInvitation(env, racer, scene.invitation.code),
      ]);

      for (const outcome of settled) {
        if (outcome.status === 'rejected') {
          throw new Error(
            `acceptInvitation threw instead of answering with a structured ` +
              `response (production would answer 500): ${String(outcome.reason)}`
          );
        }
        expect(outcome.value.status).toBeLessThan(500);
      }
    });

    it('two different users racing one code: the invitation still ends accepted exactly once, changelog untouched', async () => {
      const scene = await seedInvitationRaceScene(env.D1_DATABASE, {
        projectId: 'p-race-two-users',
        ownerId: 'u-race-two-owner',
        code: 'invite-race-two-users',
      });
      const racers = await seedRaceUsers(env.D1_DATABASE, 'u-race-two', 2);

      const [resA, resB] = (await Promise.allSettled([
        acceptInvitation(env, racers[0]!, scene.invitation.code),
        acceptInvitation(env, racers[1]!, scene.invitation.code),
      ])) as PromiseSettledResult<Response>[];

      // Both calls answer with real structured Responses (no exceptions).
      expect(resA.status).toBe('fulfilled');
      expect(resB.status).toBe('fulfilled');

      // The invitation row ends accepted.
      const invite = await fetchRow(
        env.D1_DATABASE,
        'invitations',
        scene.invitation.id
      );
      expect(invite?.['accepted_at']).not.toBeNull();

      // No phantom changelog: the invitation path never writes sync_changes.
      expect(await changelogFor(env.D1_DATABASE, scene.projectId)).toEqual([]);
    });

    it.fails('two different users racing one code: exactly ONE membership is created (invitation single-use)', async () => {
      // REQUIRED semantics (regression tripwire for KNOWN BUG (b) above):
      // one pending invitation yields at most one new membership, and the
      // loser gets an honest structured rejection. Today BOTH accepts commit
      // memberships (the guarded INSERT never re-checks accepted_at, and the
      // dependent UPDATE is unconditional). When acceptInvitation is fixed,
      // this body will PASS and `it.fails` goes red — flip it to `it`.
      const scene = await seedInvitationRaceScene(env.D1_DATABASE, {
        projectId: 'p-race-two-users-honest',
        ownerId: 'u-race-two-honest-owner',
        code: 'invite-race-two-users-honest',
      });
      const racers = await seedRaceUsers(
        env.D1_DATABASE,
        'u-race-two-honest',
        2
      );

      const settled = await Promise.allSettled([
        acceptInvitation(env, racers[0]!, scene.invitation.code),
        acceptInvitation(env, racers[1]!, scene.invitation.code),
      ]);

      const members = await getMembers(env.D1_DATABASE, scene.projectId);
      const newMembers = members.filter(
        (m) => m.userId === racers[0]!.id || m.userId === racers[1]!.id
      );
      expect(newMembers, 'one invitation → at most one membership').toHaveLength(
        1
      );

      // The winner is answered 200 {accepted: true}; the loser is answered
      // with a structured rejection — never a 500, never a success.
      const winners = settled.filter(
        (s): s is PromiseFulfilledResult<Response> =>
          s.status === 'fulfilled' && s.value.status === 200
      );
      expect(winners).toHaveLength(1);
      for (const outcome of settled) {
        if (outcome.status === 'rejected') {
          throw new Error(
            `acceptInvitation threw (production would answer 500): ${String(outcome.reason)}`
          );
        }
        expect(outcome.value.status).toBeLessThan(500);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Login-code concurrent verify + brute-force cap
  // -------------------------------------------------------------------------
  d('login-code verify + brute-force races', () => {
    it('N concurrent verifies of one valid code consume it exactly once', async () => {
      const email = 'race-verify@tabspace.test';
      const code = '11223344';
      await seedLoginCode(env.D1_DATABASE, { email, code });

      const N = 6;
      const responses = await Promise.all(
        Array.from({ length: N }, () =>
          verifyLoginCode(verifyLoginCodeRequest(email, code), env)
        )
      );

      const statuses = responses.map((r) => r.status).sort();
      expect(statuses, 'exactly one 200, the rest 401').toEqual([
        200, 401, 401, 401, 401, 401,
      ]);

      // The single 200 minted a token for the seeded identity.
      const winner = responses.find((r) => r.status === 200)!;
      const body = (await winner.json()) as {
        token: string;
        user: { email: string };
      };
      expect(body.token).toBeTruthy();
      expect(body.user.email).toBe(email);

      // Single-use consume: the row is GONE — the losers' attempts (their
      // conditional bump matches 0 rows after the winner's DELETE) must not
      // resurrect or leave a ghost row behind.
      expect(await loginCodeAttempts(env.D1_DATABASE, email)).toBeUndefined();
      const leftover = await env.D1_DATABASE.prepare(
        'SELECT COUNT(*) AS n FROM login_codes WHERE email = ?'
      )
        .bind(email)
        .first<{ n: number }>();
      expect(leftover?.n).toBe(0);

      // Every loser is an honest structured 401 (opaque by design).
      for (const response of responses) {
        if (response.status === 401) {
          const err = await errorBody(response);
          expect(err.error.message).toBeTruthy();
        }
      }
    });

    it('concurrent wrong guesses bump attempts atomically and stop exactly at the cap', async () => {
      const email = 'race-bruteforce@tabspace.test';
      const code = '55443322';
      await seedLoginCode(env.D1_DATABASE, { email, code });

      // More concurrent wrong guesses than the cap: the guarded
      // `attempts = attempts + 1 WHERE attempts < cap` UPDATE must commit
      // exactly MAX_CODE_ATTEMPTS times.
      const guesses = 8;
      const responses = await Promise.all(
        Array.from({ length: guesses }, (_, i) =>
          verifyLoginCode(
            verifyLoginCodeRequest(email, `0000000${i}`),
            env
          )
        )
      );

      // Every wrong guess is a structured 401; none consumed the code.
      expect(responses.map((r) => r.status)).toEqual(
        Array.from({ length: guesses }, () => 401)
      );
      const attempts = await loginCodeAttempts(env.D1_DATABASE, email);
      expect(
        attempts,
        'attempts stop exactly at MAX_CODE_ATTEMPTS, never past it'
      ).toBe(MAX_CODE_ATTEMPTS);
      const row = await env.D1_DATABASE
        .prepare('SELECT COUNT(*) AS n FROM login_codes WHERE email = ?')
        .bind(email)
        .first<{ n: number }>();
      expect(row?.n, 'a wrong guess never consumes the code').toBe(1);
    });

    it('once the cap trips, the CORRECT code is rejected too (interleaved wrong→right)', async () => {
      const email = 'race-cap-then-right@tabspace.test';
      const code = '87654321';
      await seedLoginCode(env.D1_DATABASE, { email, code });

      // MAX_CODE_ATTEMPTS wrong guesses, sequentially so the attempt count is
      // deterministic: each bumps attempts by exactly one.
      for (let i = 1; i <= MAX_CODE_ATTEMPTS; i++) {
        const wrong = await verifyLoginCode(
          verifyLoginCodeRequest(email, `1111111${i}`),
          env
        );
        expect(wrong.status).toBe(401);
        expect(
          await loginCodeAttempts(env.D1_DATABASE, email),
          `attempts reflects the real count after wrong guess ${i}`
        ).toBe(i);
      }

      // The cap has tripped: the RIGHT guess must now fail as well — the
      // consume DELETE re-checks `attempts < max` inside the same statement.
      const right = await verifyLoginCode(
        verifyLoginCodeRequest(email, code),
        env
      );
      expect(right.status).toBe(401);
      const err = await errorBody(right);
      expect(err.error.message).toBe(
        'Too many attempts. Please request a new code.'
      );

      // Locked, not consumed: the row survives with the capped count.
      expect(await loginCodeAttempts(env.D1_DATABASE, email)).toBe(MAX_CODE_ATTEMPTS);
      const row = await env.D1_DATABASE
        .prepare('SELECT COUNT(*) AS n FROM login_codes WHERE email = ?')
        .bind(email)
        .first<{ n: number }>();
      expect(row?.n).toBe(1);
    });

    it('within the cap the correct code still wins, and success BURNS the row (no reset)', async () => {
      const email = 'race-burn@tabspace.test';
      const code = '99887766';
      await seedLoginCode(env.D1_DATABASE, { email, code });

      // Two wrong guesses first — the code stays usable (attempts < cap).
      await verifyLoginCode(verifyLoginCodeRequest(email, '12121212'), env);
      await verifyLoginCode(verifyLoginCodeRequest(email, '34343434'), env);
      expect(await loginCodeAttempts(env.D1_DATABASE, email)).toBe(2);

      const right = await verifyLoginCode(
        verifyLoginCodeRequest(email, code),
        env
      );
      expect(right.status).toBe(200);

      // The real semantics are BURN (row deleted), not reset: single-use,
      // nothing left to verify or re-count.
      expect(await loginCodeAttempts(env.D1_DATABASE, email)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 3. CAS version conflicts through the real sync handler
  // -------------------------------------------------------------------------
  d('CAS version conflicts (sync update handler)', () => {
    it('two concurrent updates from the same base: one wins, the loser gets the version conflict and writes NOTHING', async () => {
      const scene = await seedCasScene(env.D1_DATABASE, {
        projectId: 'p-cas-race',
        taskId: 't-cas-race',
        baseVersion: 1,
      });
      const [owner, editor] = scene.writers;

      // Two racing clients built their updates from the SAME baseVersion 1.
      // Different fields, so the loser's write is distinguishable per-field.
      const mutA = updateMutation({
        projectId: scene.projectId,
        entityId: scene.task.id,
        baseVersion: scene.task.baseVersion,
        patch: { title: 'winner-or-loser A' },
      });
      const mutB = updateMutation({
        projectId: scene.projectId,
        entityId: scene.task.id,
        baseVersion: scene.task.baseVersion,
        patch: { payload: { raced: 'B' } },
      });

      const [resA, resB] = await Promise.all([
        syncProject(env, owner!, scene.projectId, { mutations: [mutA] }),
        syncProject(env, editor!, scene.projectId, { mutations: [mutB] }),
      ]);
      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      const bodyA = await syncResponseBody(resA);
      const bodyB = await syncResponseBody(resB);

      // Exactly one applied, one conflict — the CAS bump is the signal.
      const outcomes = [
        { body: bodyA, mut: mutA },
        { body: bodyB, mut: mutB },
      ];
      const applied = outcomes.filter(
        (o) => o.body.outcomes[0]?.status === 'applied'
      );
      const conflicted = outcomes.filter(
        (o) => o.body.outcomes[0]?.status === 'conflict'
      );
      expect(applied).toHaveLength(1);
      expect(conflicted).toHaveLength(1);

      // The conflict is the sync layer's structured version-conflict signal:
      // message + authoritative in-batch currentVersion + expectedVersion.
      const conflict = conflicted[0]!.body;
      expect(conflict.outcomes[0]!.message).toBe('Entity version conflict');
      expect(conflict.conflicts).toHaveLength(1);
      expect(conflict.conflicts[0]!.message).toBe('Entity version conflict');
      expect(conflict.conflicts[0]!.clientMutationId).toBe(
        conflicted[0]!.mut.clientMutationId
      );
      expect(conflict.conflicts[0]!.expectedVersion).toBe(
        scene.task.baseVersion
      );
      expect(conflict.conflicts[0]!.currentVersion).toBe(
        scene.task.baseVersion + 1
      );

      // Exactly ONE version bump happened, and the loser's write is fully
      // absent — no partial field writes, no changelog row for its mutation.
      expect(
        await versionOf(
          env.D1_DATABASE,
          scene.projectId,
          'task',
          scene.task.id
        )
      ).toBe(scene.task.baseVersion + 1);

      const changelog = await changelogFor(env.D1_DATABASE, scene.projectId);
      expect(changelog).toHaveLength(1);
      expect(changelog[0]!.client_mutation_id).toBe(
        applied[0]!.mut.clientMutationId
      );
      expect(changelog[0]!.operation).toBe('update');

      // Winner + fresh read converge: the winning patch is the one in the DB,
      // the loser's field still holds its ORIGINAL value.
      const row = await env.D1_DATABASE
        .prepare('SELECT title, payload_json FROM tasks WHERE id = ?')
        .bind(scene.task.id)
        .first<{ title: string; payload_json: string | null }>();
      const aWon = applied[0]!.mut.clientMutationId === mutA.clientMutationId;
      if (aWon) {
        expect(row?.title).toBe('winner-or-loser A');
        expect(row?.payload_json).toBe('{}'); // B's payload never landed
      } else {
        expect(row?.title).toBe('CAS task'); // A's title never landed
        expect(row?.payload_json).toBe(JSON.stringify({ raced: 'B' }));
      }
    });

    it('loser leaves no phantom version: a fresh-read update after the race applies cleanly', async () => {
      const scene = await seedCasScene(env.D1_DATABASE, {
        projectId: 'p-cas-race-converge',
        taskId: 't-cas-converge',
        baseVersion: 5,
      });

      // Force a resolved race sequentially: stale base loses.
      const stale = updateMutation({
        projectId: scene.projectId,
        entityId: scene.task.id,
        baseVersion: 4, // actual is 5
        patch: { title: 'stale write' },
      });
      const fresh = updateMutation({
        projectId: scene.projectId,
        entityId: scene.task.id,
        baseVersion: 5,
        patch: { title: 'fresh write' },
      });
      const [owner] = scene.writers;

      const staleRes = await syncProject(
        env,
        owner!,
        scene.projectId,
        { mutations: [stale] }
      );
      const staleBody = await syncResponseBody(staleRes);
      expect(staleBody.outcomes[0]!.status).toBe('conflict');
      expect(staleBody.conflicts[0]!.currentVersion).toBe(5);

      // Nothing moved: version still 5, and the fresh update on that basis
      // applies — proof the conflict committed zero state.
      expect(
        await versionOf(env.D1_DATABASE, scene.projectId, 'task', scene.task.id)
      ).toBe(5);
      const freshRes = await syncProject(
        env,
        owner!,
        scene.projectId,
        { mutations: [fresh] }
      );
      const freshBody = await syncResponseBody(freshRes);
      expect(freshBody.outcomes[0]!.status).toBe('applied');
      expect(
        await versionOf(env.D1_DATABASE, scene.projectId, 'task', scene.task.id)
      ).toBe(6);
      const row = await env.D1_DATABASE
        .prepare('SELECT title FROM tasks WHERE id = ?')
        .bind(scene.task.id)
        .first<{ title: string }>();
      expect(row?.title).toBe('fresh write');
      expect(await changelogFor(env.D1_DATABASE, scene.projectId)).toHaveLength(
        1
      );
    });

    it('happy path: sequential updates with fresh versions both land', async () => {
      const scene = await seedCasScene(env.D1_DATABASE, {
        projectId: 'p-cas-happy',
        taskId: 't-cas-happy',
        baseVersion: 1,
      });
      const [owner, editor] = scene.writers;

      const first = updateMutation({
        projectId: scene.projectId,
        entityId: scene.task.id,
        baseVersion: 1,
        patch: { title: 'first landed' },
      });
      const res1 = await syncProject(env, owner!, scene.projectId, {
        mutations: [first],
      });
      const body1 = await syncResponseBody(res1);
      expect(body1.outcomes[0]!.status).toBe('applied');
      expect(body1.outcomes[0]!.message).toBeUndefined();
      expect(body1.conflicts).toEqual([]);
      expect(
        await versionOf(env.D1_DATABASE, scene.projectId, 'task', scene.task.id)
      ).toBe(2);

      // The second client re-reads the fresh version (2) and lands on it.
      const second = updateMutation({
        projectId: scene.projectId,
        entityId: scene.task.id,
        baseVersion: 2,
        patch: { payload: { step: 2 } },
      });
      const res2 = await syncProject(env, editor!, scene.projectId, {
        mutations: [second],
      });
      const body2 = await syncResponseBody(res2);
      expect(body2.outcomes[0]!.status).toBe('applied');
      expect(
        await versionOf(env.D1_DATABASE, scene.projectId, 'task', scene.task.id)
      ).toBe(3);

      // Both writes durably landed, in order, each with exactly one changelog
      // row — and the second write preserved the first write's field.
      const row = await env.D1_DATABASE
        .prepare('SELECT title, payload_json FROM tasks WHERE id = ?')
        .bind(scene.task.id)
        .first<{ title: string; payload_json: string | null }>();
      expect(row?.title).toBe('first landed');
      expect(row?.payload_json).toBe(JSON.stringify({ step: 2 }));
      const changelog = await changelogFor(env.D1_DATABASE, scene.projectId);
      expect(changelog.map((c) => c.client_mutation_id)).toEqual([
        first.clientMutationId,
        second.clientMutationId,
      ]);
    });
  });
});
