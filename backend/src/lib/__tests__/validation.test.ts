import { describe, it, expect } from 'vitest';
import { createProject, updateProject, deleteProject } from '../crud';
import { createInvitation } from '../invitations';
import { requestLoginCode, verifyLoginCode } from '../login';
import {
  fieldErrorSummary,
  parseBody,
  invitationCreateSchema,
  loginRequestSchema,
  loginVerifySchema,
  projectCreateSchema,
  projectUpdateSchema,
  syncPayloadSchema,
} from '../validation';
import type { Env } from '../../types';

// ---------------------------------------------------------------------------
// Schema-level tests: bounds + parseBody field summaries
// ---------------------------------------------------------------------------

describe('projectCreateSchema', () => {
  it('accepts a valid body and trims the name', () => {
    const parsed = parseBody(projectCreateSchema, {
      name: '  My Project  ',
      description: 'desc',
      color: '#ff0000',
      icon: 'tab',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.name).toBe('My Project');
    }
  });

  it('rejects a whitespace-only name', () => {
    const parsed = parseBody(projectCreateSchema, { name: '   ' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details.name).toBeDefined();
  });

  it('rejects a name over 200 characters', () => {
    const parsed = parseBody(projectCreateSchema, {
      name: 'x'.repeat(201),
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details.name).toMatch(/200/);
  });

  it('rejects a description over 2000 characters', () => {
    const parsed = parseBody(projectCreateSchema, {
      name: 'ok',
      description: 'x'.repeat(2001),
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details.description).toMatch(/2000/);
  });

  it('rejects a color over 64 characters', () => {
    const parsed = parseBody(projectCreateSchema, {
      name: 'ok',
      color: 'c'.repeat(65),
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details.color).toMatch(/64/);
  });

  it('rejects wrong types instead of coercing them to null', () => {
    const parsed = parseBody(projectCreateSchema, {
      name: 'ok',
      description: 42,
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details.description).toBeDefined();
  });

  it('allows absent optional fields (undefined, not null)', () => {
    const parsed = parseBody(projectCreateSchema, { name: 'ok' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.description ?? null).toBeNull();
    }
  });
});

describe('projectUpdateSchema', () => {
  it('accepts a partial patch with the same bounds as create', () => {
    expect(parseBody(projectUpdateSchema, { name: 'New' }).ok).toBe(true);
    expect(
      parseBody(projectUpdateSchema, { description: null as string | null }).ok
    ).toBe(true);
  });

  it('rejects an empty patch (at least one field required)', () => {
    const parsed = parseBody(projectUpdateSchema, {});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details._).toBeDefined();
  });

  it('rejects a whitespace-only name symmetrically with create', () => {
    const parsed = parseBody(projectUpdateSchema, { name: ' \t ' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details.name).toBeDefined();
  });

  it('rejects an oversized name like create', () => {
    const parsed = parseBody(projectUpdateSchema, { name: 'x'.repeat(201) });
    expect(parsed.ok).toBe(false);
  });
});

describe('invitationCreateSchema', () => {
  it('defaults expiresInDays to 7 and role to editor', () => {
    const parsed = parseBody(invitationCreateSchema, {});
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.expiresInDays).toBe(7);
      expect(parsed.data.role).toBe('editor');
    }
  });

  it('coerces a numeric-string expiresInDays', () => {
    const parsed = parseBody(invitationCreateSchema, { expiresInDays: '5' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.expiresInDays).toBe(5);
  });

  it('rejects a negative expiresInDays', () => {
    const parsed = parseBody(invitationCreateSchema, { expiresInDays: -3 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details.expiresInDays).toBeDefined();
  });

  it('rejects an absurd expiresInDays above the 30-day window', () => {
    const parsed = parseBody(invitationCreateSchema, { expiresInDays: 3650 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details.expiresInDays).toMatch(/30/);
  });

  it('rejects a non-integer expiresInDays', () => {
    const parsed = parseBody(invitationCreateSchema, { expiresInDays: 2.5 });
    expect(parsed.ok).toBe(false);
  });

  it('rejects an unknown role', () => {
    const parsed = parseBody(invitationCreateSchema, { role: 'superuser' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details.role).toBeDefined();
  });
});

describe('loginRequestSchema / loginVerifySchema', () => {
  it('accepts and normalizes a valid email', () => {
    const parsed = parseBody(loginRequestSchema, {
      email: '  User@Example.COM ',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.email).toBe('user@example.com');
  });

  it('rejects a malformed email with a field summary', () => {
    const parsed = parseBody(loginRequestSchema, { email: 'not-an-email' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details.email).toBeDefined();
  });

  it('rejects a missing email', () => {
    const parsed = parseBody(loginRequestSchema, {});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details.email).toBeDefined();
  });

  it('rejects a wrong-type email', () => {
    const parsed = parseBody(loginRequestSchema, { email: 123 });
    expect(parsed.ok).toBe(false);
  });

  it('rejects a code that is not 8 digits', () => {
    for (const code of ['123', '123456789', 'abcdefgh', 12345678]) {
      const parsed = parseBody(loginVerifySchema, {
        email: 'user@example.com',
        code,
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.details.code).toBeDefined();
    }
  });

  it('accepts a valid 8-digit code', () => {
    const parsed = parseBody(loginVerifySchema, {
      email: 'user@example.com',
      code: ' 12345678 ',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.code).toBe('12345678');
  });
});

describe('syncPayloadSchema (envelope)', () => {
  const baseMutation = { clientMutationId: 'cm-1' };

  it('accepts an empty envelope', () => {
    expect(parseBody(syncPayloadSchema, {}).ok).toBe(true);
    expect(parseBody(syncPayloadSchema, { lastCursor: 5 }).ok).toBe(true);
    expect(parseBody(syncPayloadSchema, { lastCursor: null }).ok).toBe(true);
  });

  it('keeps unknown mutation fields (loose per-mutation validation)', () => {
    const parsed = parseBody(syncPayloadSchema, {
      mutations: [
        {
          clientMutationId: 'cm-1',
          entityType: 'task',
          entityId: 'e1',
          patch: { title: 't' },
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const first = parsed.data.mutations?.[0] as Record<string, unknown>;
      expect(first.entityType).toBe('task');
      expect(first.patch).toEqual({ title: 't' });
    }
  });

  it('rejects a mutation without a clientMutationId', () => {
    const parsed = parseBody(syncPayloadSchema, {
      mutations: [{ entityType: 'task' }],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details['mutations.0.clientMutationId']).toBeDefined();
  });

  it('rejects a mutations array over the absolute 500 bound', () => {
    const mutations = Array.from({ length: 501 }, (_, i) => ({
      ...baseMutation,
      clientMutationId: `cm-${i}`,
    }));
    const parsed = parseBody(syncPayloadSchema, { mutations });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.details.mutations).toMatch(/500/);
  });

  it('rejects a non-array mutations field', () => {
    const parsed = parseBody(syncPayloadSchema, { mutations: 'nope' });
    expect(parsed.ok).toBe(false);
  });
});

describe('parseBody / fieldErrorSummary', () => {
  it('reports the first issue per field', () => {
    const result = projectCreateSchema.safeParse({
      name: '',
      description: 'x'.repeat(3000),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const summary = fieldErrorSummary(result.error);
      expect(Object.keys(summary).sort()).toEqual(['description', 'name']);
      expect(summary.name).toBeDefined();
      expect(summary.description).toMatch(/2000/);
    }
  });

  it('keys object-level issues as _', () => {
    const result = projectUpdateSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const summary = fieldErrorSummary(result.error);
      expect(Object.keys(summary)).toEqual(['_']);
    }
  });

  it('never throws on non-object input', () => {
    for (const body of [null, 'str', 42, [], undefined]) {
      expect(() => parseBody(projectCreateSchema, body)).not.toThrow();
      expect(parseBody(projectCreateSchema, body).ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Handler-level wiring tests (thin in-memory D1 mock, harness-style)
// ---------------------------------------------------------------------------

interface MemberRow {
  project_id: string;
  user_id: string;
  role: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface CrudDb {
  projects: ProjectRow[];
  members: MemberRow[];
}

/**
 * Minimal D1 mock covering only the SQL shapes the crud/invitation/login
 * handlers issue. Records every bound statement so tests can assert what was
 * written. `failBatchWith` simulates an infrastructure (D1) failure.
 */
function makeCrudEnv(
  db: CrudDb,
  opts: { failBatchWith?: Error } = {}
): { env: Env; statements: { sql: string; params: unknown[] }[] } {
  const statements: { sql: string; params: unknown[] }[] = [];

  function exec(sql: string, params: unknown[]): { meta: { changes: number } } {
    if (/INSERT INTO projects\b/.test(sql)) {
      // Guarded create: params [id, name, description, color, icon, ownerId,
      // createdAt, updatedAt, ownerId, maxProjects].
      const [id, name, , , , ownerId, createdAt, updatedAt, , max] =
        params as [string, string, string, string, string, string, string, string, string, number];
      const live = db.projects.filter(
        (p) => p.owner_id === ownerId && p.deleted_at === null
      ).length;
      if (live >= max) return { meta: { changes: 0 } };
      db.projects.push({
        id,
        name,
        description: params[2] as string,
        color: params[3] as string,
        icon: params[4] as string,
        owner_id: ownerId,
        created_at: createdAt,
        updated_at: updatedAt,
        deleted_at: null,
      });
      return { meta: { changes: 1 } };
    }
    if (/UPDATE projects\s+SET deleted_at/.test(sql)) {
      const id = params[2] as string;
      const target = db.projects.find(
        (p) => p.id === id && p.deleted_at === null
      );
      if (!target) return { meta: { changes: 0 } };
      target.deleted_at = params[0] as string;
      return { meta: { changes: 1 } };
    }
    if (/UPDATE projects\s+SET name/.test(sql)) {
      const [name, description, color, icon, updatedAt, id] = params as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      const target = db.projects.find(
        (p) => p.id === id && p.deleted_at === null
      );
      if (!target) return { meta: { changes: 0 } };
      target.name = name;
      target.description = description;
      target.color = color;
      target.icon = icon;
      target.updated_at = updatedAt;
      return { meta: { changes: 1 } };
    }
    if (/INSERT INTO project_members/.test(sql)) {
      const [, projectId, userId, role] = params as [string, string, string, string];
      db.members.push({ project_id: projectId, user_id: userId, role });
      return { meta: { changes: 1 } };
    }
    // Version bumps and change-log rows are irrelevant to these tests.
    return { meta: { changes: 1 } };
  }

  function first(sql: string, params: unknown[]): unknown {
    if (/FROM project_members pm\s+JOIN users u/.test(sql)) {
      const [projectId, userId] = params as [string, string];
      const member = db.members.find(
        (m) => m.project_id === projectId && m.user_id === userId
      );
      if (!member) return null;
      return {
        id: `pm-${userId}`,
        project_id: projectId,
        user_id: userId,
        role: member.role,
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
        email: `${userId}@example.com`,
        display_name: null,
      };
    }
    if (/SELECT COUNT\(\*\) AS n FROM project_members/.test(sql)) {
      const projectId = params[0] as string;
      return {
        n: db.members.filter((m) => m.project_id === projectId).length,
      };
    }
    if (/FROM projects WHERE id = \? AND deleted_at IS NULL/.test(sql)) {
      const id = params[0] as string;
      return (
        db.projects.find((p) => p.id === id && p.deleted_at === null) ?? null
      );
    }
    // getLatestChange / sync_changes reads: no changes recorded.
    return null;
  }

  const database = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          statements.push({ sql, params });
          return {
            async first() {
              return first(sql, params);
            },
            async all() {
              return { results: [] };
            },
            async run() {
              if (opts.failBatchWith) throw opts.failBatchWith;
              return exec(sql, params);
            },
            __exec: () => exec(sql, params),
          };
        },
      };
    },
    async batch(stmts: { __exec: () => { meta: { changes: number } } }[]) {
      if (opts.failBatchWith) throw opts.failBatchWith;
      return stmts.map((s) => s.__exec());
    },
  };

  return { env: { D1_DATABASE: database } as unknown as Env, statements };
}

describe('createProject validation wiring', () => {
  it('returns 400 with a field summary for an oversized name, before any write', async () => {
    const { env, statements } = makeCrudEnv({ projects: [], members: [] });
    const response = await createProject(
      env,
      { id: 'u1' },
      { name: 'x'.repeat(201) }
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { message: string; details: Record<string, string> };
    };
    expect(body.error.message).toBe('Invalid request');
    expect(body.error.details.name).toBeDefined();
    expect(statements).toHaveLength(0);
  });

  it('stores the trimmed name and 201s on success', async () => {
    const { env } = makeCrudEnv({ projects: [], members: [] });
    const response = await createProject(
      env,
      { id: 'u1' },
      { name: '  Padded Name  ' }
    );

    expect(response.status).toBe(201);
    const project = (await response.json()) as { name: string };
    expect(project.name).toBe('Padded Name');
  });
});

describe('updateProject validation wiring (symmetric with create)', () => {
  const db = (): CrudDb => ({
    projects: [
      {
        id: 'p1',
        name: 'Original',
        description: null,
        color: null,
        icon: null,
        owner_id: 'u1',
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
        deleted_at: null,
      },
    ],
    members: [{ project_id: 'p1', user_id: 'u2', role: 'admin' }],
  });

  it('rejects a whitespace-only name with 400 and writes nothing', async () => {
    const crud = makeCrudEnv(db());
    const response = await updateProject(
      crud.env,
      { id: 'u2' },
      'p1',
      { name: '   ' }
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { details: Record<string, string> };
    };
    expect(body.error.details.name).toBeDefined();
    const writes = crud.statements.filter((s) =>
      /UPDATE projects\s+SET name/.test(s.sql)
    );
    expect(writes).toHaveLength(0);
  });

  it('applies the TRIMMED name on update', async () => {
    const crud = makeCrudEnv(db());
    const response = await updateProject(
      crud.env,
      { id: 'u2' },
      'p1',
      { name: '  Updated Name  ' }
    );

    expect(response.status).toBe(200);
    const project = (await response.json()) as { name: string };
    expect(project.name).toBe('Updated Name');
    const write = crud.statements.find((s) =>
      /UPDATE projects\s+SET name/.test(s.sql)
    );
    expect(write?.params[0]).toBe('Updated Name');
  });

  it('rejects an oversized description with 400', async () => {
    const { env } = makeCrudEnv(db());
    const response = await updateProject(
      env,
      { id: 'u2' },
      'p1',
      { description: 'x'.repeat(2001) }
    );
    expect(response.status).toBe(400);
  });
});

describe('deleteProject privilege (owner-only)', () => {
  const dbWith = (role: string): CrudDb => ({
    projects: [
      {
        id: 'p1',
        name: 'Project',
        description: null,
        color: null,
        icon: null,
        owner_id: 'u1',
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
        deleted_at: null,
      },
    ],
    members: [{ project_id: 'p1', user_id: 'u2', role }],
  });

  it('403s for an admin (non-owner)', async () => {
    const { env } = makeCrudEnv(dbWith('admin'));
    const response = await deleteProject(env, { id: 'u2' }, 'p1');

    expect(response.status).toBe(403);
    const body = (await response.json()) as {
      error: { message: string };
    };
    expect(body.error.message).toMatch(/owner/);
  });

  it('succeeds for the owner (single member)', async () => {
    const crud = makeCrudEnv(dbWith('owner'));
    const response = await deleteProject(crud.env, { id: 'u2' }, 'p1');

    expect(response.status).toBe(200);
    const body = (await response.json()) as { deleted: boolean; id: string };
    expect(body.deleted).toBe(true);
    expect(body.id).toBe('p1');
    expect(
      crud.statements.some((s) =>
        /UPDATE projects\s+SET deleted_at/.test(s.sql)
      )
    ).toBe(true);
  });
});

describe('createInvitation validation wiring', () => {
  const envFor = () =>
    makeCrudEnv({
      projects: [],
      members: [{ project_id: 'p1', user_id: 'u1', role: 'admin' }],
    });

  it('rejects an absurd expiresInDays with 400 and a field summary', async () => {
    const { env } = envFor();
    const response = await createInvitation(
      env,
      { id: 'u1' },
      'p1',
      { role: 'editor', expiresInDays: 31 }
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { message: string; details: Record<string, string> };
    };
    expect(body.error.message).toBe('Invalid request');
    expect(body.error.details.expiresInDays).toMatch(/30/);
  });

  it('defaults to 7 days when expiresInDays is absent', async () => {
    const { env } = envFor();
    const response = await createInvitation(
      env,
      { id: 'u1' },
      'p1',
      { role: 'editor' }
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { expires_at: string };
    const days = Math.round(
      (new Date(body.expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    );
    expect(days).toBe(7);
  });
});

describe('login endpoints validation wiring', () => {
  const post = (path: string, body: unknown): Request =>
    new Request(`https://backend.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('request-code returns 400 with an email field summary', async () => {
    const { env } = makeCrudEnv({ projects: [], members: [] });
    const response = await requestLoginCode(
      post('/auth/request-code', { email: 'nope' }),
      env
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { message: string; details: Record<string, string> };
    };
    expect(body.error.message).toBe('Invalid request');
    expect(body.error.details.email).toBeDefined();
  });

  it('verify returns 400 with a code field summary for a short code', async () => {
    const { env } = makeCrudEnv({ projects: [], members: [] });
    const response = await verifyLoginCode(
      post('/auth/verify', { email: 'user@example.com', code: '12' }),
      env
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { details: Record<string, string> };
    };
    expect(body.error.details.code).toBeDefined();
  });
});
