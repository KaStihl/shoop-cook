import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { mapByRules } from './canonical';
import { norm, parsePack, round2, sha } from './text';
import type { Store } from './types';

export interface RawProduct {
  store: Store;
  name: string;
  brand?: string | null;
  ean?: string | null;
  packText?: string | null;
  /** Regular shelf price for one pack. */
  price: number;
  /** Discounted price when the product is on a deal. */
  dealPrice?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  category?: string | null;
  image?: string | null;
  sourceUrl: string;
}

export interface IngestResult {
  total: number;
  created: number;
  changed: number;
}

/** Upserts products by store + EAN (or name hash) and appends price history whenever a price changes. */
export function upsertProducts(items: RawProduct[], scrapedAt = new Date().toISOString()): IngestResult {
  const result: IngestResult = { total: 0, created: 0, changed: 0 };
  const seen = new Set<string>();
  db.transaction((tx) => {
    for (const item of items) {
      const name = item.name.replace(/\s+/g, ' ').trim();
      if (!name || !Number.isFinite(item.price) || item.price <= 0) continue;
      const key = `${item.store}:${item.ean || sha(`${norm(name)}|${norm(item.packText ?? '')}`)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pack = parsePack(item.packText, name);
      const dealPrice = item.dealPrice && item.dealPrice < item.price ? round2(item.dealPrice) : null;
      const effective = dealPrice ?? item.price;
      const existing = tx.select().from(schema.products).where(eq(schema.products.key, key)).get();
      const keepMapping = existing && (existing.mappingSource === 'llm' || existing.mappingSource === 'manual');
      const ruleId = keepMapping ? null : mapByRules(name);
      const row = {
        key,
        hash: sha(`${norm(name)}|${norm(item.brand ?? '')}`),
        store: item.store,
        name,
        searchName: norm(`${name} ${item.brand ?? ''}`),
        brand: item.brand || null,
        ean: item.ean || null,
        packText: item.packText || null,
        packQty: pack.qty,
        packUnit: pack.unit,
        loose: pack.loose,
        price: round2(item.price),
        dealPrice,
        unitPrice: pack.qty && pack.unit !== 'ks' ? round2((effective / pack.qty) * 1000) : null,
        validFrom: item.validFrom?.slice(0, 10) || null,
        validTo: item.validTo?.slice(0, 10) || null,
        category: item.category || null,
        image: item.image || null,
        sourceUrl: item.sourceUrl,
        scrapedAt,
        ingredientId: keepMapping ? existing.ingredientId : ruleId,
        mappingSource: keepMapping ? existing.mappingSource : ruleId ? 'rule' : null,
      };
      result.total++;
      if (!existing) {
        const inserted = tx.insert(schema.products).values(row).returning({ id: schema.products.id }).get();
        tx.insert(schema.priceHistory).values({ productId: inserted.id, price: row.price, dealPrice, recordedAt: scrapedAt }).run();
        result.created++;
        continue;
      }
      tx.update(schema.products).set(row).where(eq(schema.products.id, existing.id)).run();
      if (existing.price !== row.price || existing.dealPrice !== dealPrice) {
        tx.insert(schema.priceHistory).values({ productId: existing.id, price: row.price, dealPrice, recordedAt: scrapedAt }).run();
        result.changed++;
      }
    }
  });
  return result;
}
