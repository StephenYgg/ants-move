import { stripVTControlCharacters } from 'node:util';

import { table } from 'table';

function sanitizeTableCell(value: unknown): string {
  return stripVTControlCharacters(String(value))
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

export function renderSafeTable(rows: readonly (readonly unknown[])[]): string {
  return table(rows.map((row) => row.map(sanitizeTableCell)));
}
