import { createHash } from 'node:crypto';
import { norm } from './strings';

export * from './strings';

export const sha = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 16);

export interface Pack {
  qty: number | null;
  unit: 'g' | 'ml' | 'ks' | null;
  loose: boolean;
}

const FACTOR: Record<string, [number, 'g' | 'ml']> = {
  kg: [1000, 'g'], g: [1, 'g'], l: [1000, 'ml'], dl: [100, 'ml'], cl: [10, 'ml'], ml: [1, 'ml'],
};
const num = (s: string): number => Number(s.replace(',', '.'));

/** Parses pack size from texts such as "500 g", "6 x 1,5 l", "10 ks", "cena za 1 kg". */
export function parsePack(...texts: (string | null | undefined)[]): Pack {
  for (const raw of texts) {
    if (!raw) continue;
    const t = norm(raw);
    if (/(cena za|za) (1 )?kg|\/ ?kg|^kg$/.test(t)) return { qty: 1000, unit: 'g', loose: true };
    const multi = t.match(/(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|cl|ml)\b/);
    if (multi) {
      const [f, unit] = FACTOR[multi[3]];
      return { qty: Number(multi[1]) * num(multi[2]) * f, unit, loose: false };
    }
    const single = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|dl|cl|ml)\b/);
    if (single) {
      const [f, unit] = FACTOR[single[2]];
      return { qty: num(single[1]) * f, unit, loose: false };
    }
    const pieces = t.match(/(\d+)\s*(ks|kus)/);
    if (pieces) return { qty: Number(pieces[1]), unit: 'ks', loose: false };
  }
  return { qty: null, unit: null, loose: false };
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const sep = text.split('\n')[0].includes(';') ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return [];
  const keys = header.map((h) => norm(h).replace(/[^a-z_]/g, ''));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}
