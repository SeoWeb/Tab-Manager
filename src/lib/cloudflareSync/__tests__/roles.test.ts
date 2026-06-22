import {
  roleAtLeast,
  canEdit,
  canManageMembers,
  canDeleteProject,
  isOwner,
  CLOUD_ROLE_RANK,
  CLOUD_ROLES,
} from '../roles';
import type { CloudRole } from '../types';

describe('cloud sync role helpers', () => {
  describe('roleAtLeast', () => {
    it('treats a missing role as full access (local-first)', () => {
      expect(roleAtLeast(null, 'owner')).toBe(true);
      expect(roleAtLeast(undefined, 'admin')).toBe(true);
    });

    it.each<[CloudRole, CloudRole, boolean]>([
      ['viewer', 'viewer', true],
      ['viewer', 'editor', false],
      ['viewer', 'admin', false],
      ['viewer', 'owner', false],
      ['editor', 'editor', true],
      ['editor', 'admin', false],
      ['admin', 'admin', true],
      ['admin', 'owner', false],
      ['owner', 'owner', true],
    ])('role %s vs minimum %s -> %s', (role, min, expected) => {
      expect(roleAtLeast(role, min)).toBe(expected);
    });
  });

  describe('canEdit', () => {
    it('allows editor and above, plus missing roles', () => {
      expect(canEdit(null)).toBe(true);
      expect(canEdit('viewer')).toBe(false);
      expect(canEdit('editor')).toBe(true);
      expect(canEdit('admin')).toBe(true);
      expect(canEdit('owner')).toBe(true);
    });

    it('always allows when cloudEnabled is false', () => {
      expect(canEdit('viewer', false)).toBe(true);
    });
  });

  describe('canManageMembers', () => {
    it('allows admin and above only', () => {
      expect(canManageMembers('viewer')).toBe(false);
      expect(canManageMembers('editor')).toBe(false);
      expect(canManageMembers('admin')).toBe(true);
      expect(canManageMembers('owner')).toBe(true);
    });

    it('always allows when cloudEnabled is false', () => {
      expect(canManageMembers('viewer', false)).toBe(true);
    });
  });

  describe('canDeleteProject', () => {
    it('allows admin and above only', () => {
      expect(canDeleteProject('viewer')).toBe(false);
      expect(canDeleteProject('editor')).toBe(false);
      expect(canDeleteProject('admin')).toBe(true);
      expect(canDeleteProject('owner')).toBe(true);
    });

    it('always allows when cloudEnabled is false', () => {
      expect(canDeleteProject('viewer', false)).toBe(true);
    });
  });

  describe('isOwner', () => {
    it('is true only for owner', () => {
      // A missing role is NOT automatically an owner — only a known owner role
      // unlocks owner-only actions like removing members.
      expect(isOwner(null)).toBe(false);
      expect(isOwner('admin')).toBe(false);
      expect(isOwner('owner')).toBe(true);
    });

    it('always allows when cloudEnabled is false', () => {
      expect(isOwner('viewer', false)).toBe(true);
    });
  });

  it('ranks roles viewer < editor < admin < owner', () => {
    expect(CLOUD_ROLE_RANK.viewer).toBeLessThan(CLOUD_ROLE_RANK.editor);
    expect(CLOUD_ROLE_RANK.editor).toBeLessThan(CLOUD_ROLE_RANK.admin);
    expect(CLOUD_ROLE_RANK.admin).toBeLessThan(CLOUD_ROLE_RANK.owner);
  });

  it('exports all four roles, highest first', () => {
    expect(CLOUD_ROLES).toEqual(['owner', 'admin', 'editor', 'viewer']);
  });
});
