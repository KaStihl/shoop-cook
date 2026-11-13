import { desc, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { hasLlm } from '@/lib/anthropic';
import { getFreshness } from '@/lib/catalog';
import { refreshState } from '@/lib/refresh';
import { STORES } from '@/lib/types';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  const p = schema.products;
  const stores = STORES.map((store) => {
    const stats = db.select({
      total: sql<number>`count(*)`,
      deals: sql<number>`count(${p.dealPrice})`,
      mapped: sql<number>`count(${p.ingredientId})`,
      lastScrape: sql<string | null>`max(${p.scrapedAt})`,
    }).from(p).where(eq(p.store, store)).get();
    const last = db.select().from(schema.refreshLog).where(eq(schema.refreshLog.store, store)).orderBy(desc(schema.refreshLog.id)).limit(1).get();
    return { store, total: stats?.total ?? 0, deals: stats?.deals ?? 0, mapped: stats?.mapped ?? 0, lastScrape: stats?.lastScrape ?? null, last: last ?? null };
  });
  return Response.json({
    stores,
    unmapped: db.select({ count: sql<number>`count(*)` }).from(p).where(isNull(p.ingredientId)).get()?.count ?? 0,
    recipes: db.select({ count: sql<number>`count(*)` }).from(schema.recipes).get()?.count ?? 0,
    logs: db.select().from(schema.refreshLog).orderBy(desc(schema.refreshLog.id)).limit(10).all(),
    running: refreshState.running,
    lines: refreshState.lines.slice(-40),
    freshness: getFreshness(),
    hasLlm: hasLlm(),
  });
}
