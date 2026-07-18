// Smart, merge-only import of a previously exported project bundle.
//
// Import never deletes anything that isn't in the file. Entities are matched
// by `id` (update) and by content (skip duplicates), so re-importing the same
// project is idempotent and importing into another project won't create
// duplicates of content that already exists there.

import { useAppStore } from '@/stores/appStore';
import { validateBundle, type ParsedBundle } from './schema';
import type { Project, ImportPreview, ExportBundle } from './types';
import { computeImport, type ComputeResult } from './merge';

export interface ImportOptions {
  /** Merge into this existing project (when createNew is false). */
  targetProjectId: string | null;
  /** Create a new project for the import (or merge if its id already exists). */
  createNew: boolean;
}

/** Read and parse an uploaded JSON file into a validated bundle. */
export async function parseBundle(file: File): Promise<ParsedBundle | null> {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    return validateBundle(json);
  } catch (error) {
    console.error('Failed to parse import file:', error);
    return null;
  }
}

function buildPreview(
  bundle: ParsedBundle,
  result: ComputeResult
): ImportPreview {
  const state = useAppStore.getState();
  const target = state.projects.find((p) => p.id === result.effectiveTargetId);
  const totalAdded =
    result.counts.collections.added +
    result.counts.links.added +
    result.counts.tasks.added +
    result.counts.todos.added +
    result.counts.notes.added;
  const totalUpdated =
    result.counts.collections.updated +
    result.counts.links.updated +
    result.counts.tasks.updated +
    result.counts.todos.updated +
    result.counts.notes.updated;
  const totalSkipped =
    result.counts.collections.skipped +
    result.counts.links.skipped +
    result.counts.tasks.skipped +
    result.counts.todos.skipped +
    result.counts.notes.skipped;

  return {
    project: {
      exists: !!target,
      name: target ? target.name : bundle.project.name,
    },
    ...result.counts,
    totalAdded,
    totalUpdated,
    totalSkipped,
  };
}

/** Dry-run an import and report how many items would be added/updated/skipped. */
export function previewImport(
  bundle: ParsedBundle,
  options: ImportOptions
): ImportPreview {
  const result = computeImport(bundle, options);
  return buildPreview(bundle, result);
}

/** Apply an import, merging into the target without removing existing data. */
export function applyImport(
  bundle: ParsedBundle,
  options: ImportOptions
): ImportPreview {
  const result = computeImport(bundle, options);
  useAppStore.setState({
    projects: result.projects,
    tasks: result.tasks,
    todos: result.todos,
    notes: result.notes,
  });
  return buildPreview(bundle, result);
}

/** Convenience: build the list of existing projects for the target selector. */
export function getProjectChoices(): Pick<Project, 'id' | 'name'>[] {
  return useAppStore
    .getState()
    .projects.map((p) => ({ id: p.id, name: p.name }));
}

// Re-export type for callers.
export type { ExportBundle };
