// Shared serialization helpers used by both import and export (CSV / HTML / JSON).

export const iso = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value ?? '');
};

export function csvCell(value: unknown): string {
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

export function toCsvRows(headers: string[], rows: unknown[][]): string {
  const head = headers.map(csvCell).join(',');
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  return `${head}\r\n${body}`;
}

export function escapeHtml(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function sanitize(name: string): string {
  return (name || 'project').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);
}
