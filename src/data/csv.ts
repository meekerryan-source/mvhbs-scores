import { parse } from 'csv-parse/sync';

/** CSV text → array of rows (arrays of strings). */
export function parseCsvRows(text: string): string[][] {
  return parse(text, { relax_column_count: true, skip_empty_lines: false, bom: true }) as string[][];
}

/** CSV text → header-keyed records. Header cells are trimmed. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];
  const hdr = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const o: Record<string, string> = {};
    hdr.forEach((h, i) => { if (h && !(h in o)) o[h] = r[i] ?? ''; });
    return o;
  });
}

/** One CSV line → cells (handles quoted commas and doubled quotes). Same semantics as the sheet's splitCSV_. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === ',') { out.push(cur); cur = ''; }
    else if (c === '"') inQ = true;
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map(r => r.map(v => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(','))
    .join('\n') + '\n';
}
