/**
 * CSV export helpers shared by every page (U-10).
 * Text cells that start with = + - @ (or TAB/CR) get a leading quote so Excel/Sheets never run them as a
 * formula. Real numbers are written as they are (a negative number must stay a number).
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, header: string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): void {
  const blob = new Blob(['﻿', toCsv(header, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
