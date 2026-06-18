import { describe, it, expect } from 'vitest';
import { describeMoveFanOut } from '../sync';

/**
 * describeMoveFanOut is the pure decision behind cross-project task/note/todo
 * moves: the change log is partitioned by project_id, so a move must emit rows
 * in both the old and new projects' logs. This covers the decision logic; the
 * D1 wiring around it mirrors the existing single-row path.
 */
describe('describeMoveFanOut', () => {
  const patch = { title: 't', payload: { title: 't' } };

  it('returns null for a same-project update (no move)', () => {
    expect(
      describeMoveFanOut('task', 'update', 'proj-a', {
        projectId: 'proj-a',
        patch,
      })
    ).toBeNull();
  });

  it('returns null for create or delete, even when the project differs', () => {
    expect(
      describeMoveFanOut('task', 'create', 'proj-a', {
        projectId: 'proj-b',
        patch,
      })
    ).toBeNull();
    expect(
      describeMoveFanOut('task', 'delete', 'proj-a', {
        projectId: 'proj-b',
        patch,
      })
    ).toBeNull();
  });

  it('returns null for collections and links (not JSON entities)', () => {
    expect(
      describeMoveFanOut('collection', 'update', 'proj-a', {
        projectId: 'proj-b',
        patch,
      })
    ).toBeNull();
    expect(
      describeMoveFanOut('link', 'update', 'proj-a', {
        projectId: 'proj-b',
        patch,
      })
    ).toBeNull();
  });

  it('returns null when the entity has no existing project', () => {
    expect(
      describeMoveFanOut('task', 'update', null, {
        projectId: 'proj-b',
        patch,
      })
    ).toBeNull();
  });

  it('fans out a create to the new project and a delete to the old on a task move', () => {
    expect(
      describeMoveFanOut('task', 'update', 'proj-a', {
        projectId: 'proj-b',
        patch,
      })
    ).toEqual([
      { projectId: 'proj-b', operation: 'create', patch },
      { projectId: 'proj-a', operation: 'delete', patch: {} },
    ]);
  });

  it('treats note and todo moves the same as task', () => {
    for (const entityType of ['note', 'todo'] as const) {
      expect(
        describeMoveFanOut(entityType, 'update', 'old', {
          projectId: 'new',
          patch,
        })
      ).toEqual([
        { projectId: 'new', operation: 'create', patch },
        { projectId: 'old', operation: 'delete', patch: {} },
      ]);
    }
  });
});
