import type { CloudRole } from './types';

/**
 * Client-side role helpers for cloud collaboration (Phase 4).
 *
 * These power UI affordances only — which controls are shown/enabled. The
 * backend is the real authorization boundary: every mutating route re-checks
 * membership and minimum role, so a UI mistake can never grant access. Treat
 * these as "what do we offer the user", not "what do we permit".
 *
 * A missing role (`null`/`undefined`) means the project is local-only or its
 * role is unknown. Local-first: such projects get full control, so the helpers
 * return `true` for every capability. Only a *known* low role (e.g. `viewer`)
 * restricts the UI.
 */

export const CLOUD_ROLE_RANK: Record<CloudRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

/** All roles, highest first. Useful for <Select> option ordering. */
export const CLOUD_ROLES: CloudRole[] = ['owner', 'admin', 'editor', 'viewer'];

/**
 * True when `role` meets or exceeds `minimum`. A missing role is treated as
 * full access (local-first) — see module docs.
 */
export function roleAtLeast(
  role: CloudRole | null | undefined,
  minimum: CloudRole
): boolean {
  if (!role) return true;
  return CLOUD_ROLE_RANK[role] >= CLOUD_ROLE_RANK[minimum];
}

/** Can create/edit/delete project entities (collections, links, …). */
export function canEdit(role: CloudRole | null | undefined): boolean {
  return roleAtLeast(role, 'editor');
}

/** Can manage members and invitations (role changes, invites). */
export function canManageMembers(role: CloudRole | null | undefined): boolean {
  return roleAtLeast(role, 'admin');
}

/** Can delete the project. */
export function canDeleteProject(role: CloudRole | null | undefined): boolean {
  return roleAtLeast(role, 'admin');
}

/** True only for the project owner. */
export function isOwner(role: CloudRole | null | undefined): boolean {
  return role === 'owner';
}
