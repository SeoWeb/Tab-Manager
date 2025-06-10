import { AppState, Note } from '../types';

export const createNoteActions = (
  set: (fn: (state: AppState) => AppState) => void
) => ({
  // Add a new note
  addNote: (title: string, content: string, color: string = '#ffffff') =>
    set((state: AppState) => {
      const newNote: Note = {
        id: crypto.randomUUID(),
        title: title.trim() || 'Untitled',
        content: content.trim(),
        color,
        createdAt: new Date(),
        updatedAt: new Date(),
        isPinned: false,
      };

      return {
        ...state,
        notes: [newNote, ...state.notes],
      };
    }),

  // Update an existing note
  updateNote: (id: string, updates: Partial<Omit<Note, 'id' | 'createdAt'>>) =>
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
    })),

  // Delete a note
  deleteNote: (id: string) =>
    set((state: AppState) => ({
      ...state,
      notes: state.notes.filter((note) => note.id !== id),
    })),

  // Toggle pin status of a note
  togglePinNote: (id: string) =>
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
    })),

  // Duplicate a note
  duplicateNote: (id: string) =>
    set((state: AppState) => {
      const originalNote = state.notes.find((note) => note.id === id);
      if (!originalNote) return state;

      const duplicatedNote: Note = {
        ...originalNote,
        id: crypto.randomUUID(),
        title: `${originalNote.title} (Copy)`,
        createdAt: new Date(),
        updatedAt: new Date(),
        isPinned: false,
      };

      return {
        ...state,
        notes: [duplicatedNote, ...state.notes],
      };
    }),
});
