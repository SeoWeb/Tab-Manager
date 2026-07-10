import { useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { sendEditingPresence } from './realtime';
import type { CloudPresenceUser } from './types';

/**
 * Returns the collaborator (other than the local user) currently editing the
 * given entity + field, or `undefined` if no one is. Drives the soft-lock UI so
 * two people don't edit the same field at once.
 */
export function useFieldEditor(
  entityId: string,
  field: string
): CloudPresenceUser | undefined {
  const myId = useAppStore((s) => s.cloudSync.account?.id);
  const presence = useAppStore((s) => s.cloudSync.onlinePresence);
  return presence.find(
    (u) =>
      u.userId !== myId &&
      u.editing?.entityId === entityId &&
      u.editing.field === field
  );
}

/** Convenience: is the given entity + field locked by another collaborator? */
export function useFieldLocked(entityId: string, field: string): boolean {
  return useFieldEditor(entityId, field) !== undefined;
}

/**
 * Wires a form field to realtime co-editing presence: broadcasts that we are
 * editing `(entityId, field)` on focus and clears it on blur. Also reports
 * whether a *different* collaborator is currently editing that field (soft
 * lock). No-ops when `entityId` is undefined (e.g. a brand-new entity).
 */
export function useFieldEditPresence(
  entityId: string | undefined,
  field: string
): {
  onFocus: () => void;
  onBlur: () => void;
  locked: boolean;
  editor?: CloudPresenceUser;
} {
  const editor = useFieldEditor(entityId ?? '', field);
  const onFocus = useCallback(() => {
    if (entityId) sendEditingPresence(entityId, field);
  }, [entityId, field]);
  const onBlur = useCallback(() => {
    if (entityId) sendEditingPresence(entityId, null);
  }, [entityId]);
  return { onFocus, onBlur, locked: !!editor, editor };
}
