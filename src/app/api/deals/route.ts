import { and, eq, gte, isNotNull, isNull, like, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { norm, today } from '@/lib/text';
import { STORES, type DealItem, type Store } from '@/lib/types';

export const dynamic = 'force-dynamic';
const PAGE = 48;

export function GET(request: Request): Response {
  const params = new URL(request.url).searchParams;
  const q = norm(params.get('q') ?? '');
  const store = params.get('store');
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const p = schema.products;
  const where = and(
    or(isNull(p.validTo), gte(p.validTo, today())),
    q ? like(p.searchName, `%${q.replace(/[%_]/g, '')}%`) : undefined,
    STORES.includes(store as Store) ? eq(p.store, store as Store) : undefined,
    params.get('deals') === '1' ? isNotNull(p.dealPrice) : undefined,
    params.get('mapped') === '1' ? isNotNull(p.ingredientId) : undefined,
  );
  const rows = db.select({
    id: p.id, store: p.store, name: p.name, brand: p.brand, packText: p.packText, price: p.price, dealPrice: p.dealPrice,
    unitPrice: p.unitPrice, validTo: p.validTo, category: p.category, image: p.image, sourceUrl: p.sourceUrl, ingredient: schema.ingredients.name,
  }).from(p).leftJoin(schema.ingredients, eq(p.ingredientId, schema.ingredients.id)).where(where)
    .orderBy(sql`${p.dealPrice} is null`, sql`${p.ingredientId} is null`, p.name).limit(PAGE).offset(offset).all();
  const total = db.select({ count: sql<number>`count(*)` }).from(p).where(where).get()?.count ?? 0;
  return Response.json({ items: rows as DealItem[], total, pageSize: PAGE });
}
