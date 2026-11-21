import { db, schema } from '@/db';
import { hasLlm } from '@/lib/anthropic';
import { getFreshness, loadCatalog } from '@/lib/catalog';
import { usable } from '@/lib/recipe-core';
import { STORES } from '@/lib/types';
import type { MetaResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  const ingredients = db.select({ id: schema.ingredients.id, name: schema.ingredients.name, category: schema.ingredients.category })
    .from(schema.ingredients).orderBy(schema.ingredients.name).all();
  const catalog = loadCatalog(STORES);
  return Response.json({ ingredients: ingredients.map((i) => ({ ...i, usable: usable(catalog.get(i.id)) })), freshness: getFreshness(), hasLlm: hasLlm() } satisfies MetaResponse);
}
