import { db, schema } from '@/db';
import { upsertProducts, type RawProduct } from '@/lib/ingest';
import { parseCsv } from '@/lib/text';
import { STORES, STORE_HOME as HOME, type Store } from '@/lib/types';

export const dynamic = 'force-dynamic';

const money = (value: unknown): number => Number(String(value ?? '').replace(',', '.').replace(/[^\d.]/g, ''));

/** Manual import (JSON array or CSV) for offers that cannot be crawled, e.g. copied from a leaflet. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { store?: Store; format?: 'json' | 'csv'; text?: string };
    if (!body.store || !STORES.includes(body.store) || !body.text?.trim()) throw new Error('Chýba obchod alebo dáta.');
    const store = body.store;
    const records = (body.format === 'csv' ? parseCsv(body.text) : JSON.parse(body.text)) as Record<string, unknown>[];
    if (!Array.isArray(records)) throw new Error('JSON musí byť pole produktov.');
    const text = (r: Record<string, unknown>, ...keys: string[]): string | null => {
      const hit = keys.map((k) => r[k]).find((v) => v !== undefined && v !== null && String(v).trim() !== '');
      return hit === undefined ? null : String(hit).trim();
    };
    const items: RawProduct[] = records.map((r) => ({
      store,
      name: text(r, 'name', 'nazov') ?? '',
      brand: text(r, 'brand', 'znacka'),
      ean: text(r, 'ean'),
      packText: text(r, 'pack', 'packText', 'pack_size', 'balenie'),
      price: money(r.price ?? r.cena),
      dealPrice: money(r.dealPrice ?? r.deal_price ?? r.akcia) || null,
      validFrom: text(r, 'validFrom', 'valid_from'),
      validTo: text(r, 'validTo', 'valid_to'),
      category: text(r, 'category', 'kategoria'),
      image: text(r, 'image'),
      sourceUrl: text(r, 'url', 'sourceUrl', 'source_url') ?? HOME[store],
    }));
    const now = new Date().toISOString();
    const result = upsertProducts(items, now);
    if (!result.total) throw new Error('V dátach sa nenašiel žiadny platný produkt (povinné sú stĺpce name a price).');
    db.insert(schema.refreshLog).values({
      store, startedAt: now, finishedAt: now, status: 'import', itemCount: result.total, newCount: result.created,
      message: `Import: ${result.total} položiek, ${result.created} nových`,
    }).run();
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Import zlyhal.' }, { status: 400 });
  }
}
