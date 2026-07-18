import { applyRemoteChanges, change, EMPTY } from './applyChanges.shared';
import type { Note } from '@/stores/types';

describe('applyRemoteChanges — field-level conflict detection', () => {
  const noteWithLocalEdit = (): Note => ({
    id: 'note-1',
    title: 'My local title',
    content: 'my local content',
    color: '#fff',
    isPinned: false,
    projectId: 'proj-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  it('keeps the local value and records a conflict when a remote change touches a pending local field', () => {
    const result = applyRemoteChanges(
      { ...EMPTY, notes: [noteWithLocalEdit()] },
      [
        change({
          operation: 'update',
          entity_type: 'note',
          entity_id: 'note-1',
          project_id: 'proj-1',
          patch: {
            title: 'remote title',
            payload: { content: 'remote content', color: '#000' },
          },
        }),
      ],
      'ext-me',
      // We have pending local edits to title + content (but not color).
      { 'note-1': ['title', 'content'] }
    );

    expect(result.conflicts).toHaveLength(2);
    const titles = result.conflicts.map((c) => c.field).sort();
    expect(titles).toEqual(['content', 'title']);
    expect(result.notes[0].title).toBe('My local title');
    expect(result.notes[0].content).toBe('my local content');
    // Color had no pending local edit, so it merges normally.
    expect(result.notes[0].color).toBe('#000');
  });

  it('does not flag a conflict when the remote value equals the local pending edit', () => {
    const result = applyRemoteChanges(
      { ...EMPTY, notes: [noteWithLocalEdit()] },
      [
        change({
          operation: 'update',
          entity_type: 'note',
          entity_id: 'note-1',
          project_id: 'proj-1',
          patch: { title: 'My local title', payload: {} },
        }),
      ],
      'ext-me',
      { 'note-1': ['title'] }
    );

    expect(result.conflicts).toHaveLength(0);
    expect(result.notes[0].title).toBe('My local title');
  });

  it('does not flag a conflict for a field with no pending local edit', () => {
    const result = applyRemoteChanges(
      { ...EMPTY, notes: [noteWithLocalEdit()] },
      [
        change({
          operation: 'update',
          entity_type: 'note',
          entity_id: 'note-1',
          project_id: 'proj-1',
          patch: { title: 'remote title', payload: {} },
        }),
      ],
      'ext-me',
      {} // nothing pending
    );

    expect(result.conflicts).toHaveLength(0);
    expect(result.notes[0].title).toBe('remote title');
  });
});
