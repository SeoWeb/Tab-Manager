import { describe, it, expect } from 'vitest';
import {
  buildPresenceTags,
  parsePresenceFromTags,
  presenceSnapshot,
  type PresenceUser,
} from '../realtime';

const u1Tags = buildPresenceTags({
  userId: 'u1',
  displayName: 'Alice',
  role: 'owner',
  clientId: 'c1',
});
const u2Tags = buildPresenceTags({
  userId: 'u2',
  displayName: 'Bob',
  role: 'viewer',
  clientId: 'c2',
});

describe('realtime presence helpers', () => {
  describe('buildPresenceTags / parsePresenceFromTags round-trip', () => {
    it('round-trips a plain ASCII identity', () => {
      const tags = buildPresenceTags({
        userId: 'user-1',
        displayName: 'Alice',
        role: 'owner',
        clientId: 'ext-abc',
      });

      const info = parsePresenceFromTags(tags);
      expect(info).toEqual({
        userId: 'user-1',
        displayName: 'Alice',
        role: 'owner',
        clientId: 'ext-abc',
      });
    });

    it('survives display names with spaces, non-ASCII, and awkward chars', () => {
      const tags = buildPresenceTags({
        userId: 'user-2',
        displayName: 'José O’Neill: admin',
        role: 'editor',
        clientId: 'ext-xyz',
      });

      const info = parsePresenceFromTags(tags);
      expect(info?.displayName).toBe('José O’Neill: admin');
      expect(info?.userId).toBe('user-2');
      expect(info?.role).toBe('editor');
    });

    it('returns null when no user tag is present', () => {
      expect(parsePresenceFromTags(['role:viewer'])).toBeNull();
      expect(parsePresenceFromTags([])).toBeNull();
      // @ts-expect-error -- guard against non-array input at runtime
      expect(parsePresenceFromTags(null)).toBeNull();
    });
  });

  describe('presenceSnapshot', () => {
    it('builds a roster from per-socket tag arrays', () => {
      expect(presenceSnapshot([u1Tags, u2Tags])).toEqual<PresenceUser[]>([
        { userId: 'u1', displayName: 'Alice', role: 'owner' },
        { userId: 'u2', displayName: 'Bob', role: 'viewer' },
      ]);
    });

    it('collapses a user connected from multiple sockets into one entry', () => {
      const c1 = buildPresenceTags({
        userId: 'u1',
        displayName: 'Alice',
        role: 'owner',
        clientId: 'c1',
      });
      const c2 = buildPresenceTags({
        userId: 'u1',
        displayName: 'Alice',
        role: 'owner',
        clientId: 'c2',
      });
      const snapshot = presenceSnapshot([c1, c2]);
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].userId).toBe('u1');
    });

    it('skips sockets whose tags lack a user id', () => {
      expect(presenceSnapshot([u1Tags, ['role:viewer']])).toEqual<
        PresenceUser[]
      >([{ userId: 'u1', displayName: 'Alice', role: 'owner' }]);
    });

    it('returns an empty roster for an empty set', () => {
      expect(presenceSnapshot([])).toEqual([]);
    });

    it('attaches the editing field when provided', () => {
      const snapshot = presenceSnapshot([u1Tags], {
        u1: { entityId: 'task-1', field: 'title' },
      });
      expect(snapshot[0].editing).toEqual({
        entityId: 'task-1',
        field: 'title',
      });
    });

    it('omits editing when the user is not editing anything', () => {
      const snapshot = presenceSnapshot([u1Tags], {});
      expect(snapshot[0].editing).toBeUndefined();
    });
  });
});
