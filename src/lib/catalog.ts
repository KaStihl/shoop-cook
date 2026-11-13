import { and, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { buildCatalog, type Catalog } from './catalog-core';
import type { Freshness, Store } from './types';

const STALE_DAYS = 8;

export { buildCart, type Catalog, type CatalogEntry, type Offer } from './catalog-core';

/** Live offers per canonical ingredient for the selected stores, read from the database. */
export function loadCatalog(stores: Store[]): Catalog {
  const products = stores.length
    ? db.select().from(schema.products).where(and(isNotNull(schema.products.ingredientId), inArray(schema.products.store, stores))).all()
    : [];
  return buildCatalog(db.select().from(schema.ingredients).all(), products, stores);
}

export function getFreshness(): Freshness {
  const row = db.select({ last: sql<string | null>`max(${schema.products.scrapedAt})`, count: sql<number>`count(*)` }).from(schema.products).get();
  const live = db.select({ count: sql<number>`count(*)` }).from(schema.refreshLog).where(inArray(schema.refreshLog.status, ['ok', 'import'])).get();
  const lastUpdate = row?.last ?? null;
  return {
    lastUpdate,
    stale: !lastUpdate || Date.now() - new Date(lastUpdate).getTime() > STALE_DAYS * 86400000,
    seedOnly: (row?.count ?? 0) > 0 && (live?.count ?? 0) === 0,
    productCount: row?.count ?? 0,
  };
}
