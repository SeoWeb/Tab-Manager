// Task 5.4 — quota commit-path tests against real D1
// (openspec/cleanup-and-regression-tests → "Quota breaches commit nothing").
//
// QUOTA PATHS UNDER TEST (file:line of each cap check)
// ----------------------------------------------------
//   project cap  checkProjectQuota  src/lib/quotas.ts:116  (read-check form)
//                + the guarded INSERT ... SELECT ... WHERE (count) < limit
//                  built by createProject       src/lib/crud.ts:51
//                  → two-phase commit via enforceCount quotas.ts:72
//                  (phase 2 dependents: owner membership, version seed,
//                   change-log row — crud.ts:74-93)
//   member cap   checkMemberQuota  src/lib/quotas.ts:143
//                + guarded invitation INSERT  createInvitation invitations.ts:43
//                + guarded membership INSERT  acceptInvitation invitations.ts:160
//                  (phase 2 dependent: the invitation's accepted_at UPDATE,
//                   invitations.ts:181-185 — MUST NOT run when the guard trips)
//   entity cap   headroom read     getEntityQuotaHeadroom quotas.ts:184
//                + per-create guard (total + ? <= max) built in sync.ts:126-141,
//                  embedded in the boundary create's INSERT
//                  (sync.ts:236-246), two-phase commit sync.ts:323-404;
//                  overflow → structured 403 quotaExceeded sync.ts:402-404
//
// ASSERTED CONTRACT (spec scenario "Quota breaches commit nothing")
// -----------------------------------------------------------------
//   * every breach is a STRUCTURED 403 — never a 500 (the message is the
//     quotaExceeded copy, not internalError's "Internal server error");
//   * a rejected invitation-accept does NOT burn the invitation: accepted_at
//     stays NULL and the SAME invitation still accepts once capacity exists;
//   * no phantom changelog rows and no dependent rows on the rejected path
//     (no orphaned memberships, no version bumps, no entity rows);
//   * partial capacity: with exactly one slot left, one operation succeeds
//     (durably, with its full dependent set) and the NEXT one is the 403.
//
// All scenarios run through the REAL handler entry points (createProject,
// createInvitation, acceptInvitation, syncProject) with per-suite var
// overrides layered via makeTestEnv — the same env object shape production
// code reads, so the cap checks and their guarded SQL are the shipped ones.

import { describe, it, expect, beforeAll } from 'vitest';
import { requireWorkersRuntime, makeTestEnv } from './harness';
import { createProject } from '../../crud';
import { createInvitation, acceptInvitation } from '../../invitations';
import { syncProject } from '../../sync';
import type { Env, Project, SyncResponse } from '../../../types';
import {
  CANONICAL_ENTITY_IDS,
  changelogFor,
  countLiveEntities,
  fetchRow,
  getMembers,
  versionOf,
} from './fixtures';
import {
  makeMutation,
} from './fixtures-idor';
import {
  ENTITY_CAP,
  ENTITY_CAP_FULL_CREATE_ID,
  ENTITY_CAP_FULL_OWNER_ID,
  ENTITY_CAP_FULL_PROJECT,
  ENTITY_CAP_FULL_UPDATE_TARGET,
  ENTITY_CAP_PART_CREATE_A,
  ENTITY_CAP_PART_CREATE_B,
  ENTITY_CAP_PART_OWNER_ID,
  ENTITY_CAP_PART_PROJECT,
  MEMBER_CAP,
  MEMBER_CAP_FULL_ACCEPTOR,
  MEMBER_CAP_FULL_INVITE_CODE,
  MEMBER_CAP_FULL_OWNER_ID,
  MEMBER_CAP_FULL_PROJECT,
  MEMBER_CAP_PART_ACCEPTOR_A,
  MEMBER_CAP_PART_ACCEPTOR_B,
  MEMBER_CAP_PART_INVITE_A_CODE,
  MEMBER_CAP_PART_INVITE_B_CODE,
  MEMBER_CAP_PART_OWNER_ID,
  MEMBER_CAP_PART_PROJECT,
  PROJECT_CAP,
  PROJECT_CAP_OWNER_ID,
  invitationRow,
  countAllSyncChanges,
  countOwnedProjects,
  countProjectInvitations,
  countProjectMembers,
  countUserMemberships,
  memberRole,
  seedQuotaWorld,
} from './fixtures-quota';

// --- the loud-skip guard (module scope, before any binding access) ----------
const runtimeAvailable = requireWorkersRuntime('quota commit paths (task 5.4)');
const d = runtimeAvailable ? describe : describe.skip;

d('quota commit paths — project cap / member cap / entity cap (real D1)', () => {
  // One env per cap scenario; all share the worker's D1 binding, so writes
  // land in the same isolated per-file database.
  let projectCapEnv: Env; // QUOTA_MAX_PROJECTS_PER_USER = 2
  let memberCapEnv: Env; // QUOTA_MAX_MEMBERS_PER_PROJECT = 3
  let memberCapEnvRaised: Env; // same, cap raised 3 → 4 (retryability probe)
  let entityCapEnv: Env; // QUOTA_MAX_ENTITIES_PER_PROJECT = 3

  beforeAll(async () => {
    [projectCapEnv, memberCapEnv, memberCapEnvRaised, entityCapEnv] =
      await Promise.all([
        makeTestEnv({ QUOTA_MAX_PROJECTS_PER_USER: String(PROJECT_CAP) }),
        makeTestEnv({ QUOTA_MAX_MEMBERS_PER_PROJECT: String(MEMBER_CAP) }),
        makeTestEnv({
          QUOTA_MAX_MEMBERS_PER_PROJECT: String(MEMBER_CAP + 1),
        }),
        makeTestEnv({ QUOTA_MAX_ENTITIES_PER_PROJECT: String(ENTITY_CAP) }),
      ]);
    await seedQuotaWorld(projectCapEnv.D1_DATABASE);
  });

  const db = () => projectCapEnv.D1_DATABASE;

  // -----------------------------------------------------------------------
  // Project cap — POST /projects → createProject (crud.ts:22)
  // -----------------------------------------------------------------------

  describe('project cap', () => {
    it('partial capacity: the create one slot under the cap commits WITH its full dependent set', async () => {
      const res = await createProject(
        projectCapEnv,
        { id: PROJECT_CAP_OWNER_ID },
        { name: 'Project-Cap Second' }
      );
      expect(res.status).toBe(201); // NOT a 500 — in-quota create succeeds
      const project = (await res.json()) as Project;
      expect(project.id).toBeTruthy();

      // Phase-2 dependents all committed: owner membership, version seed,
      // changelog row.
      expect(await getMembers(db(), project.id)).toEqual([
        { userId: PROJECT_CAP_OWNER_ID, role: 'owner' },
      ]);
      expect(
        await versionOf(db(), project.id, 'project', project.id)
      ).toBe(1);
      const log = await changelogFor(db(), project.id);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        entity_type: 'project',
        entity_id: project.id,
        operation: 'create',
        actor_id: PROJECT_CAP_OWNER_ID,
      });
    });

    it('breach: at the cap the create is a structured 403 and commits NOTHING (no orphan membership, no phantom changelog)', async () => {
      const ownedBefore = await countOwnedProjects(db(), PROJECT_CAP_OWNER_ID);
      const membershipsBefore = await countUserMemberships(
        db(),
        PROJECT_CAP_OWNER_ID
      );
      const changelogBefore = await countAllSyncChanges(db());

      const res = await createProject(
        projectCapEnv,
        { id: PROJECT_CAP_OWNER_ID },
        { name: 'Project-Cap Third' }
      );

      // 403, not 500 — and the message is the quota copy, not internalError's.
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { message?: string } };
      expect(body.error?.message).toBe(
        `You have reached the maximum of ${PROJECT_CAP} projects`
      );

      // Zero state change: no project row, no orphaned phase-2 membership,
      // no phantom changelog/version rows anywhere.
      expect(await countOwnedProjects(db(), PROJECT_CAP_OWNER_ID)).toBe(
        ownedBefore
      );
      expect(await countUserMemberships(db(), PROJECT_CAP_OWNER_ID)).toBe(
        membershipsBefore
      );
      expect(await countAllSyncChanges(db())).toBe(changelogBefore);
    });
  });

  // -----------------------------------------------------------------------
  // Member cap — invitations (invitations.ts:11 create / :81 accept)
  // -----------------------------------------------------------------------

  describe('member cap', () => {
    it('breach: createInvitation at the cap is a structured 403 and inserts NO invitation row', async () => {
      const before = await countProjectInvitations(
        db(),
        MEMBER_CAP_FULL_PROJECT
      );
      const res = await createInvitation(
        memberCapEnv,
        { id: MEMBER_CAP_FULL_OWNER_ID },
        MEMBER_CAP_FULL_PROJECT,
        { role: 'editor' }
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { message?: string } };
      expect(body.error?.message).toBe(
        `This project has reached the maximum of ${MEMBER_CAP} members`
      );
      expect(
        await countProjectInvitations(db(), MEMBER_CAP_FULL_PROJECT)
      ).toBe(before);
    });

    it('breach: acceptInvitation at the cap is a structured 403 and does NOT burn the invitation', async () => {
      const membersBefore = await countProjectMembers(
        db(),
        MEMBER_CAP_FULL_PROJECT
      );

      const res = await acceptInvitation(
        memberCapEnv,
        { ...MEMBER_CAP_FULL_ACCEPTOR },
        MEMBER_CAP_FULL_INVITE_CODE
      );

      // 403, not 500, with the quota message.
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { message?: string } };
      expect(body.error?.message).toBe(
        `This project has reached the maximum of ${MEMBER_CAP} members`
      );

      // The invitation is UNBURNED: still pending, still retryable.
      const invite = await invitationRow(db(), MEMBER_CAP_FULL_INVITE_CODE);
      expect(invite).toBeDefined();
      expect(invite?.['accepted_at']).toBeNull();

      // No membership row appeared (phase-1 guard tripped, phase-2 never ran).
      expect(
        await memberRole(db(), MEMBER_CAP_FULL_PROJECT, MEMBER_CAP_FULL_ACCEPTOR.id)
      ).toBeUndefined();
      expect(await countProjectMembers(db(), MEMBER_CAP_FULL_PROJECT)).toBe(
        membersBefore
      );
    });

    it('the 403-rejected invitation is still retryable once capacity frees up (unburned, not burned-then-refunded)', async () => {
      // SAME invitation, SAME project, cap raised 3 → 4 in the env only.
      const res = await acceptInvitation(
        memberCapEnvRaised,
        { ...MEMBER_CAP_FULL_ACCEPTOR },
        MEMBER_CAP_FULL_INVITE_CODE
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        project_id: string;
        role: string;
        accepted?: boolean;
      };
      expect(body.project_id).toBe(MEMBER_CAP_FULL_PROJECT);
      expect(body.accepted).toBe(true);

      // NOW (and only now) the invitation is burned and the member exists.
      const invite = await invitationRow(db(), MEMBER_CAP_FULL_INVITE_CODE);
      expect(invite?.['accepted_at']).not.toBeNull();
      expect(
        await memberRole(db(), MEMBER_CAP_FULL_PROJECT, MEMBER_CAP_FULL_ACCEPTOR.id)
      ).toBe('editor');
    });

    it('partial capacity: with one member slot left the first accept succeeds and burns only its own invitation', async () => {
      const res = await acceptInvitation(
        memberCapEnv,
        { ...MEMBER_CAP_PART_ACCEPTOR_A },
        MEMBER_CAP_PART_INVITE_A_CODE
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { accepted?: boolean; role: string };
      expect(body.accepted).toBe(true);

      expect(
        await memberRole(
          db(),
          MEMBER_CAP_PART_PROJECT,
          MEMBER_CAP_PART_ACCEPTOR_A.id
        )
      ).toBe('editor');
      const inviteA = await invitationRow(
        db(),
        MEMBER_CAP_PART_INVITE_A_CODE
      );
      expect(inviteA?.['accepted_at']).not.toBeNull();
      expect(await countProjectMembers(db(), MEMBER_CAP_PART_PROJECT)).toBe(
        MEMBER_CAP
      );
    });

    it('partial capacity: the NEXT accept — at the now-full cap — is a 403 and leaves its invitation unburned', async () => {
      const res = await acceptInvitation(
        memberCapEnv,
        { ...MEMBER_CAP_PART_ACCEPTOR_B },
        MEMBER_CAP_PART_INVITE_B_CODE
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { message?: string } };
      expect(body.error?.message).toBe(
        `This project has reached the maximum of ${MEMBER_CAP} members`
      );

      const inviteB = await invitationRow(db(), MEMBER_CAP_PART_INVITE_B_CODE);
      expect(inviteB?.['accepted_at']).toBeNull();
      expect(
        await memberRole(
          db(),
          MEMBER_CAP_PART_PROJECT,
          MEMBER_CAP_PART_ACCEPTOR_B.id
        )
      ).toBeUndefined();
      expect(await countProjectMembers(db(), MEMBER_CAP_PART_PROJECT)).toBe(
        MEMBER_CAP
      );
    });
  });

  // -----------------------------------------------------------------------
  // Entity cap — sync create path (sync.ts:126-404)
  // -----------------------------------------------------------------------

  describe('entity cap', () => {
    it('breach: a create against a full project is a structured 403 with NO entity row, NO version bump, NO changelog row', async () => {
      const mutation = makeMutation({
        projectId: ENTITY_CAP_FULL_PROJECT,
        entityType: 'collection',
        entityId: ENTITY_CAP_FULL_CREATE_ID,
        operation: 'create',
        patch: { name: 'Should never exist' },
        label: 'quota-entity-full-create',
      });

      const res = await syncProject(
        entityCapEnv,
        { id: ENTITY_CAP_FULL_OWNER_ID },
        ENTITY_CAP_FULL_PROJECT,
        { mutations: [mutation] }
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { message?: string } };
      expect(body.error?.message).toBe(
        `This project has reached the maximum of ${ENTITY_CAP} entities`
      );

      // No dependent rows anywhere: the blocked create leaves no trace.
      expect(await countLiveEntities(db(), ENTITY_CAP_FULL_PROJECT)).toBe(
        ENTITY_CAP
      );
      expect(
        await fetchRow(db(), 'collections', ENTITY_CAP_FULL_CREATE_ID)
      ).toBeUndefined();
      expect(
        await versionOf(
          db(),
          ENTITY_CAP_FULL_PROJECT,
          'collection',
          ENTITY_CAP_FULL_CREATE_ID
        )
      ).toBeUndefined();
      expect(await changelogFor(db(), ENTITY_CAP_FULL_PROJECT)).toEqual([]);
    });

    it('at the cap, edits still commit — the cap gates creates, not updates', async () => {
      const mutation = makeMutation({
        projectId: ENTITY_CAP_FULL_PROJECT,
        entityType: 'collection',
        entityId: ENTITY_CAP_FULL_UPDATE_TARGET,
        operation: 'update',
        patch: { name: 'Renamed under full cap' },
        baseVersion: 1,
        label: 'quota-entity-full-update',
      });

      const res = await syncProject(
        entityCapEnv,
        { id: ENTITY_CAP_FULL_OWNER_ID },
        ENTITY_CAP_FULL_PROJECT,
        { mutations: [mutation] }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SyncResponse;
      expect(body.outcomes[0]).toEqual({
        clientMutationId: mutation.clientMutationId,
        status: 'applied',
      });

      const row = await fetchRow(
        db(),
        'collections',
        ENTITY_CAP_FULL_UPDATE_TARGET
      );
      expect(row?.['name']).toBe('Renamed under full cap');
      expect(
        await versionOf(
          db(),
          ENTITY_CAP_FULL_PROJECT,
          'collection',
          ENTITY_CAP_FULL_UPDATE_TARGET
        )
      ).toBe(2);

      // Exactly one changelog row in this project — the update, no phantoms.
      const log = await changelogFor(db(), ENTITY_CAP_FULL_PROJECT);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        entity_id: ENTITY_CAP_FULL_UPDATE_TARGET,
        operation: 'update',
      });
    });

    it('partial capacity: of two creates against one remaining slot, the first commits durably and the overflow is refused with a 403', async () => {
      const createA = makeMutation({
        projectId: ENTITY_CAP_PART_PROJECT,
        entityType: 'collection',
        entityId: ENTITY_CAP_PART_CREATE_A,
        operation: 'create',
        patch: { name: 'Fits in the last slot' },
        label: 'quota-entity-part-create-a',
      });
      const createB = makeMutation({
        projectId: ENTITY_CAP_PART_PROJECT,
        entityType: 'link',
        entityId: ENTITY_CAP_PART_CREATE_B,
        operation: 'create',
        patch: { url: 'https://example.com/qc-part-l1' },
        label: 'quota-entity-part-create-b',
      });

      const res = await syncProject(
        entityCapEnv,
        { id: ENTITY_CAP_PART_OWNER_ID },
        ENTITY_CAP_PART_PROJECT,
        { mutations: [createA, createB] }
      );

      // The overflow refuses the REQUEST (403) — but the in-capacity create
      // is already committed; the client keeps B queued and retries later.
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { message?: string } };
      expect(body.error?.message).toBe(
        `This project has reached the maximum of ${ENTITY_CAP} entities`
      );

      // A committed with its full dependent set (row + version + changelog).
      const rowA = await fetchRow(db(), 'collections', ENTITY_CAP_PART_CREATE_A);
      expect(rowA).toBeDefined();
      expect(rowA?.['deleted_at']).toBeNull();
      expect(
        await versionOf(
          db(),
          ENTITY_CAP_PART_PROJECT,
          'collection',
          ENTITY_CAP_PART_CREATE_A
        )
      ).toBe(1);

      // B left NO trace: no row, no version, no changelog entry.
      expect(
        await fetchRow(db(), 'links', ENTITY_CAP_PART_CREATE_B)
      ).toBeUndefined();
      expect(
        await versionOf(
          db(),
          ENTITY_CAP_PART_PROJECT,
          'link',
          ENTITY_CAP_PART_CREATE_B
        )
      ).toBeUndefined();

      // Exactly one changelog row — A's create. No phantom row for B.
      const log = await changelogFor(db(), ENTITY_CAP_PART_PROJECT);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        entity_id: ENTITY_CAP_PART_CREATE_A,
        operation: 'create',
        actor_id: ENTITY_CAP_PART_OWNER_ID,
      });

      expect(await countLiveEntities(db(), ENTITY_CAP_PART_PROJECT)).toBe(
        ENTITY_CAP
      );
    });
  });

  // -----------------------------------------------------------------------
  // Sanity: the canonical entity ids stay untouched by the quota scenarios
  // (guards against accidental cross-suite coupling inside this file).
  // -----------------------------------------------------------------------

  it('sanity: canonical world rows are absent here (per-file isolation, no cross-file coupling)', async () => {
    expect(
      await fetchRow(db(), 'collections', CANONICAL_ENTITY_IDS.collection)
    ).toBeUndefined();
  });
});
