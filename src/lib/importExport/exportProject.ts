// Builds per-project export bundles and serializes them to JSON / CSV / HTML.

import { useAppStore } from '@/stores/appStore';
import type { ExportBundle, ExportSelection, ExportFormat } from './types';
import type { Collection, Link, AdvancedTask, LegacyTask, Note } from './types';

/** Read the current store and assemble a bundle for the given project. */
export function buildBundle(
  projectId: string,
  selection: ExportSelection
): ExportBundle | null {
  const state = useAppStore.getState();
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return null;

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    project: selection.collections ? project : { ...project, collections: [] },
    tasks: selection.tasks
      ? state.tasks.filter((t) => t.projectId === projectId)
      : [],
    todos: selection.todos
      ? state.todos.filter((t) => t.projectId === projectId)
      : [],
    notes: selection.notes
      ? state.notes.filter((n) => n.projectId === projectId)
      : [],
  };
}

const iso = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value ?? '');
};

/** Serialize a bundle to a pretty JSON string (Dates become ISO strings). */
export function toJson(bundle: ExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

// ---- CSV helpers -----------------------------------------------------------

function csvCell(value: unknown): string {
  if (value == null) return '';
  let str: string;
  if (value instanceof Date) str = value.toISOString();
  else if (Array.isArray(value)) str = value.join('; ');
  else str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvRows(headers: string[], rows: unknown[][]): string {
  const head = headers.map(csvCell).join(',');
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  return `${head}\r\n${body}`;
}

export interface ExportFile {
  filename: string;
  content: string;
  mime: string;
}

function sanitize(name: string): string {
  return (name || 'project').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);
}

/** Produce one or more flat CSV files (one per selected section). */
export function toCsv(
  bundle: ExportBundle,
  selection: ExportSelection
): ExportFile[] {
  const base = sanitize(bundle.project.name);
  const files: ExportFile[] = [];

  if (selection.collections) {
    const headers = [
      'collectionId',
      'collectionName',
      'linkId',
      'url',
      'title',
      'favIconUrl',
      'tags',
      'notes',
      'createdAt',
      'updatedAt',
    ];
    const rows: unknown[][] = [];
    for (const c of bundle.project.collections) {
      for (const l of c.links) {
        rows.push([
          c.id,
          c.name,
          l.id,
          l.url,
          l.title ?? '',
          l.favIconUrl ?? '',
          l.tags ?? [],
          l.notes ?? '',
          iso(l.createdAt),
          iso(l.updatedAt),
        ]);
      }
    }
    files.push({
      filename: `${base}_links.csv`,
      content: toCsvRows(headers, rows),
      mime: 'text/csv;charset=utf-8',
    });
  }

  if (selection.tasks) {
    const headers = [
      'id',
      'title',
      'description',
      'priority',
      'status',
      'category',
      'tags',
      'dueDate',
      'scheduledDate',
      'progress',
      'projectId',
      'collectionId',
      'completedAt',
      'isArchived',
      'isFavorite',
      'notes',
      'createdAt',
      'updatedAt',
    ];
    const rows = bundle.tasks.map((t: AdvancedTask) => [
      t.id,
      t.title,
      t.description ?? '',
      t.priority,
      t.status,
      t.category,
      t.tags,
      iso(t.dueDate),
      iso(t.scheduledDate),
      t.progress,
      t.projectId ?? '',
      t.collectionId ?? '',
      iso(t.completedAt),
      t.isArchived,
      t.isFavorite,
      t.notes,
      iso(t.createdAt),
      iso(t.updatedAt),
    ]);
    files.push({
      filename: `${base}_tasks.csv`,
      content: toCsvRows(headers, rows),
      mime: 'text/csv;charset=utf-8',
    });
  }

  if (selection.todos) {
    const headers = ['id', 'text', 'completed', 'category', 'projectId'];
    const rows = bundle.todos.map((t: LegacyTask) => [
      t.id,
      t.text,
      t.completed,
      t.category ?? '',
      t.projectId ?? '',
    ]);
    files.push({
      filename: `${base}_todos.csv`,
      content: toCsvRows(headers, rows),
      mime: 'text/csv;charset=utf-8',
    });
  }

  if (selection.notes) {
    const headers = [
      'id',
      'title',
      'content',
      'color',
      'isPinned',
      'projectId',
      'createdAt',
      'updatedAt',
    ];
    const rows = bundle.notes.map((n: Note) => [
      n.id,
      n.title,
      n.content,
      n.color,
      n.isPinned,
      n.projectId ?? '',
      iso(n.createdAt),
      iso(n.updatedAt),
    ]);
    files.push({
      filename: `${base}_notes.csv`,
      content: toCsvRows(headers, rows),
      mime: 'text/csv;charset=utf-8',
    });
  }

  return files;
}

// ---- HTML helpers ----------------------------------------------------------

function escapeHtml(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render a self-contained, read-only HTML report of the bundle. */
export function toHtml(
  bundle: ExportBundle,
  selection: ExportSelection
): string {
  const p = bundle.project;
  const sections: string[] = [];

  if (selection.collections) {
    const rows = p.collections
      .map((c: Collection) => {
        const linkRows = c.links
          .map(
            (l: Link) =>
              `<li><a href="${escapeHtml(l.url)}">${escapeHtml(
                l.title || l.url
              )}</a>${l.notes ? ` — ${escapeHtml(l.notes)}` : ''}</li>`
          )
          .join('');
        return `<div class="collection"><h3>${escapeHtml(c.name)}</h3><ul>${linkRows}</ul></div>`;
      })
      .join('');
    sections.push(`<section><h2>Collections &amp; Links</h2>${rows}</section>`);
  }

  if (selection.tasks) {
    const rows = bundle.tasks
      .map(
        (t) =>
          `<li><strong>${escapeHtml(t.title)}</strong> [${escapeHtml(
            t.status
          )}] — ${escapeHtml(t.description || '')}</li>`
      )
      .join('');
    sections.push(
      `<section><h2>Tasks (${bundle.tasks.length})</h2><ul>${rows}</ul></section>`
    );
  }

  if (selection.todos) {
    const rows = bundle.todos
      .map((t) => `<li>${t.completed ? '✓' : '☐'} ${escapeHtml(t.text)}</li>`)
      .join('');
    sections.push(
      `<section><h2>Todos (${bundle.todos.length})</h2><ul>${rows}</ul></section>`
    );
  }

  if (selection.notes) {
    const rows = bundle.notes
      .map(
        (n) =>
          `<div class="note"><h3>${escapeHtml(n.title)}</h3><div>${escapeHtml(
            n.content
          )}</div></div>`
      )
      .join('');
    sections.push(
      `<section><h2>Notes (${bundle.notes.length})</h2>${rows}</section>`
    );
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(p.name)} — Export</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #111; }
  h1 { border-bottom: 2px solid #ddd; padding-bottom: .3rem; }
  h2 { margin-top: 2rem; color: #2563eb; }
  .collection, .note { margin: .5rem 0 1rem 0; padding: .5rem; background: #f8fafc; border-radius: 6px; }
  a { color: #2563eb; }
  ul { margin: .25rem 0; }
</style>
</head>
<body>
<h1>${escapeHtml(p.name)}</h1>
<p>Exported ${escapeHtml(new Date(bundle.exportedAt).toLocaleString())}</p>
${sections.join('\n')}
</body>
</html>`;
}

/** Convert a bundle into the list of files to download for the chosen format. */
export function bundleToFiles(
  bundle: ExportBundle,
  format: ExportFormat,
  selection: ExportSelection
): ExportFile[] {
  const base = sanitize(bundle.project.name);
  if (format === 'json') {
    return [
      {
        filename: `${base}_export.json`,
        content: toJson(bundle),
        mime: 'application/json',
      },
    ];
  }
  if (format === 'html') {
    return [
      {
        filename: `${base}_export.html`,
        content: toHtml(bundle, selection),
        mime: 'text/html;charset=utf-8',
      },
    ];
  }
  return toCsv(bundle, selection);
}

/** Trigger a browser download for a single file (anchor-based, extension-safe). */
export function triggerDownload(file: ExportFile): void {
  try {
    const blob = new Blob([file.content], { type: file.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error('Failed to download file', error);
  }
}

/** Build and download a project export in the requested format. */
export function exportProject(
  projectId: string,
  format: ExportFormat,
  selection: ExportSelection
): boolean {
  if (
    !selection.collections &&
    !selection.tasks &&
    !selection.todos &&
    !selection.notes
  ) {
    return false;
  }
  const bundle = buildBundle(projectId, selection);
  if (!bundle) return false;
  const files = bundleToFiles(bundle, format, selection);
  files.forEach((f, i) => {
    if (files.length > 1) {
      setTimeout(() => triggerDownload(f), i * 250);
    } else {
      triggerDownload(f);
    }
  });
  return true;
}
