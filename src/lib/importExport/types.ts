// Export/import bundle types for per-project data portability.

import type { Project, Collection, Link } from '@/types';
import type { AdvancedTask, LegacyTask } from '@/types/tasks';
import type { Note } from '@/stores/types';

/** Which sections the user chose to include in an export. */
export interface ExportSelection {
  /** Collections and their embedded links. Links always travel with collections. */
  collections: boolean;
  tasks: boolean;
  todos: boolean;
  notes: boolean;
}

/** The serialized, file-ready representation of a single project export. */
export interface ExportBundle {
  /** Schema version for forward/backward compatibility of the file format. */
  version: 1;
  /** ISO timestamp of when the export was created. */
  exportedAt: string;
  /** The owning project, including its embedded collections + links. */
  project: Project;
  /** Advanced tasks scoped to the project. */
  tasks: AdvancedTask[];
  /** Legacy todos scoped to the project. */
  todos: LegacyTask[];
  /** Notes scoped to the project. */
  notes: Note[];
}

/** Result of a dry-run import preview: per-section merge outcome counts. */
export interface ImportPreview {
  project: {
    exists: boolean;
    name: string;
  };
  collections: { added: number; updated: number; skipped: number };
  links: { added: number; updated: number; skipped: number };
  tasks: { added: number; updated: number; skipped: number };
  todos: { added: number; updated: number; skipped: number };
  notes: { added: number; updated: number; skipped: number };
  /** Total entities that would be added/updated (imported). */
  totalAdded: number;
  totalUpdated: number;
  totalSkipped: number;
}

export type ExportFormat = 'json' | 'csv' | 'html';

/** Re-export the underlying entity types for convenience in this module. */
export type { Project, Collection, Link, AdvancedTask, LegacyTask, Note };
