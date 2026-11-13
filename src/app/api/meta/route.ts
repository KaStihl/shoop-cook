import { db, schema } from '@/db';
import { hasLlm } from '@/lib/anthropic';
import { getFreshness } from '@/lib/catalog';
import type { MetaResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  const ingredients = db.select({ id: schema.ingredients.id, name: schema.ingredients.name, category: schema.ingredients.category })
    .from(schema.ingredients).orderBy(schema.ingredients.name).all();
  return Response.json({ ingredients, freshness: getFreshness(), hasLlm: hasLlm() } satisfies MetaResponse);
}
