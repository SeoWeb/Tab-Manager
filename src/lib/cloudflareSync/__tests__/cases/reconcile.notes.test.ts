import { diffSnapshot } from '../../reconcile';
import { note, emptyServer, snapJson, T0, T1, T2 } from './reconcile.shared';

describe('diffSnapshot — notes', () => {
  it('creates / updates / deletes / pushes a note', () => {
    const server = emptyServer();
    server.notes = [
      snapJson(
        'n-missing',
        T2.toISOString(),
        '{"content":"x","color":"#fff","isPinned":false}'
      ),
      snapJson(
        'n-newer',
        T2.toISOString(),
        '{"content":"x","color":"#fff","isPinned":false}'
      ),
      snapJson(
        'n-older',
        T0.toISOString(),
        '{"content":"x","color":"#fff","isPinned":false}'
      ),
      snapJson(
        'n-deleted',
        T2.toISOString(),
        '{"content":"x","color":"#fff","isPinned":false}',
        {
          deleted_at: T2.toISOString(),
        }
      ),
    ];
    const result = diffSnapshot({
      collections: [],
      tasks: [],
      notes: [
        note('n-newer', T1),
        note('n-older', T2),
        note('n-deleted', T1),
        note('n-local', T2),
      ],
      todos: [],
      server,
    });
    const create = result.pulls.filter((p) => p.operation === 'create');
    const update = result.pulls.filter((p) => p.operation === 'update');
    const del = result.pulls.filter((p) => p.operation === 'delete');
    expect(create.map((p) => p.entity_id)).toEqual(['n-missing']);
    expect(update.map((p) => p.entity_id)).toEqual(['n-newer']);
    expect(del.map((p) => p.entity_id)).toEqual(['n-deleted']);
    // n-older (local newer) + n-local (no server row) are pushes.
    expect(result.pushes).toHaveLength(2);
    expect(result.pushes.map((p) => p.entityId).sort()).toEqual([
      'n-local',
      'n-older',
    ]);
  });
});
