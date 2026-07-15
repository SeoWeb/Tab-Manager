// Zod validation for imported export bundles. Dates are accepted as ISO
// strings or Date objects (files serialize Dates to ISO on export).

import { z } from 'zod';
import { cleanTasksData } from '@/lib/taskMigration';
import type { AdvancedTask, LegacyTask } from '@/types/tasks';
import type { Note } from '@/stores/types';

const dateSchema = z.union([z.string(), z.date()]).transform((v) => {
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date() : d;
});

const stringArraySchema = z
  .union([z.array(z.string()), z.unknown()])
  .transform((v) =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  );

const linkSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string().optional(),
  favIconUrl: z.string().optional(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
  tags: stringArraySchema.optional(),
  notes: z.string().optional(),
  order: z.number().optional(),
  bookmarkId: z.union([z.string(), z.null()]).optional(),
});

const collectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  links: z.array(linkSchema).default([]),
  createdAt: dateSchema,
  updatedAt: dateSchema,
  color: z.string().optional(),
  minimized: z.boolean().optional(),
  order: z.number().optional(),
  bookmarkFolderId: z.union([z.string(), z.null()]).optional(),
});

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  collections: z.array(collectionSchema).default([]),
  createdAt: dateSchema,
  updatedAt: dateSchema,
  icon: z.string().optional(),
  color: z.string().optional(),
  order: z.number().optional(),
  bookmarkFolderId: z.union([z.string(), z.null()]).optional(),
});

const noteSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  color: z.string(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
  isPinned: z.boolean(),
  projectId: z.string().optional(),
});

const legacyTaskSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  category: z.string().optional(),
  projectId: z.string().optional(),
});

export const exportBundleSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().optional(),
  project: projectSchema,
  tasks: z.array(z.unknown()).default([]),
  todos: z.array(legacyTaskSchema).default([]),
  notes: z.array(noteSchema).default([]),
});

export interface ParsedBundle {
  project: z.infer<typeof projectSchema>;
  tasks: AdvancedTask[];
  todos: LegacyTask[];
  notes: Note[];
}

/** Validate and sanitize an unknown parsed JSON value into a usable bundle. */
export function validateBundle(input: unknown): ParsedBundle | null {
  const result = exportBundleSchema.safeParse(input);
  if (!result.success) {
    console.warn('Invalid export bundle:', result.error.format());
    return null;
  }
  const data = result.data;
  const tasks = cleanTasksData(data.tasks) as AdvancedTask[];
  return {
    project: data.project,
    tasks,
    todos: data.todos as LegacyTask[],
    notes: data.notes as Note[],
  };
}
