import { describe, it, expect } from 'vitest';
import {
  buildPresenceTags,
  parsePresenceFromTags,
  presenceSnapshot,
  type PresenceUser,
} from '../realtime';

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
      const tags = [
        buildPresenceTags({ userId: 'u1', displayName: 'Alice', role: 'owner', clientId: 'c1' }),
        buildPresenceTags({ userId: 'u2', displayName: 'Bob', role: 'viewer', clientId: 'c2' }),
      ];

      expect(presenceSnapshot(tags)).toEqual<PresenceUser[]>([
        { userId: 'u1', displayName: 'Alice', role: 'owner' },
        { userId: 'u2', displayName: 'Bob', role: 'viewer' },
      ]);
    });

    it('collapses a user connected from multiple sockets into one entry', () => {
      const tags = [
        buildPresenceTags({ userId: 'u1', displayName: 'Alice', role: 'owner', clientId: 'c1' }),
        buildPresenceTags({ userId: 'u1', displayName: 'Alice', role: 'owner', clientId: 'c2' }),
      ];

      const snapshot = presenceSnapshot(tags);
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].userId).toBe('u1');
    });

    it('skips sockets whose tags lack a user id', () => {
      const tags = [
        buildPresenceTags({ userId: 'u1', displayName: 'Alice', role: 'owner', clientId: 'c1' }),
        ['role:viewer'], // malformed / no user tag
      ];

      expect(presenceSnapshot(tags)).toEqual<PresenceUser[]>([
        { userId: 'u1', displayName: 'Alice', role: 'owner' },
      ]);
    });

    it('returns an empty roster for an empty set', () => {
      expect(presenceSnapshot([])).toEqual([]);
    });
  });
});
