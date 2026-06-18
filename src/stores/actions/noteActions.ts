import { AppState, Note } from '../types';
import { enqueueCloudChange } from '@/lib/cloudflareSync/orchestrator';
import { buildNotePatch } from '@/lib/cloudflareSync/entityPatches';

export const createNoteActions = (
  set: (fn: (state: AppState) => AppState) => void,
  get: () => AppState
) => ({
  // Add a new note
  addNote: (title: string, content: string, color: string = '#ffffff') => {
    const state = get();
    const newNote: Note = {
      id: crypto.randomUUID(),
      title: title.trim() || 'Untitled',
      content: content.trim(),
      color,
      createdAt: new Date(),
      updatedAt: new Date(),
      isPinned: false,
      // Strict per-project: every new note belongs to the active project.
      projectId: state.activeProjectId ?? state.projects[0]?.id,
    };

    set((state: AppState) => ({
      ...state,
      notes: [newNote, ...state.notes],
    }));

    // Enqueue a note create for cloud projects. enqueueCloudChange is a no-op
    // unless cloud sync is enabled AND the owning project is cloud-enabled.
    if (newNote.projectId) {
      void enqueueCloudChange({
        projectId: newNote.projectId,
        entityType: 'note',
        entityId: newNote.id,
        operation: 'create',
        patch: buildNotePatch(newNote),
      });
    }
  },

  // Update an existing note
  updateNote: (
    id: string,
    updates: Partial<Omit<Note, 'id' | 'createdAt'>>
  ) => {
    set((state: AppState) => ({
      ...state,
      notes: state.notes.map((note) =>
        note.id === id
          ? {
              ...note,
              ...updates,
              updatedAt: new Date(),
            }
          : note
      ),
    }));

    // Enqueue the note's full current payload. The backend replaces
    // payload_json wholesale on update, so a partial patch would clobber the
    // other fields; reading the merged note avoids that.
    const updated = get().notes.find((n) => n.id === id);
    if (updated?.projectId) {
      void enqueueCloudChange({
        projectId: updated.projectId,
        entityType: 'note',
        entityId: id,
        operation: 'update',
        patch: buildNotePatch(updated),
      });
    }
  },

  // Delete a note
  deleteNote: (id: string) => {
    // Capture the owning project before removal so the cloud delete can be
    // enqueued (the note is gone from state once `set` runs).
    const note = get().notes.find((n) => n.id === id);

    set((state: AppState) => ({
      ...state,
      notes: state.notes.filter((n) => n.id !== id),
    }));

    if (note?.projectId) {
      void enqueueCloudChange({
        projectId: note.projectId,
        entityType: 'note',
        entityId: id,
        operation: 'delete',
        patch: {},
      });
    }
  },

  // Toggle pin status of a note. isPinned rides in the note payload, so the
  // toggle enqueues an update like any other note edit.
  togglePinNote: (id: string) => {
    set((state: AppState) => ({
      ...state,
      notes: state.notes.map((note) =>
        note.id === id
          ? {
              ...note,
              isPinned: !note.isPinned,
              updatedAt: new Date(),
            }
          : note
      ),
    }));

    const updated = get().notes.find((n) => n.id === id);
    if (updated?.projectId) {
      void enqueueCloudChange({
        projectId: updated.projectId,
        entityType: 'note',
        entityId: id,
        operation: 'update',
        patch: buildNotePatch(updated),
      });
    }
  },

  // Duplicate a note. The copy inherits the original's projectId and syncs as a
  // new note create.
  duplicateNote: (id: string) => {
    const duplicatedId = crypto.randomUUID();
    set((state: AppState) => {
      const originalNote = state.notes.find((note) => note.id === id);
      if (!originalNote) return state;

      const duplicatedNote: Note = {
        ...originalNote,
        id: duplicatedId,
        title: `${originalNote.title} (Copy)`,
        createdAt: new Date(),
        updatedAt: new Date(),
        isPinned: false,
      };

      return {
        ...state,
        notes: [duplicatedNote, ...state.notes],
      };
    });

    const duplicated = get().notes.find((n) => n.id === duplicatedId);
    if (duplicated?.projectId) {
      void enqueueCloudChange({
        projectId: duplicated.projectId,
        entityType: 'note',
        entityId: duplicatedId,
        operation: 'create',
        patch: buildNotePatch(duplicated),
      });
    }
  },
});
