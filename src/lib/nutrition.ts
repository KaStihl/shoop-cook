import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { cacheGet, cacheSet, db, schema } from '@/db';
import type { Macros } from './types';

const OFF = 'https://world.openfoodfacts.org';
const HEADERS = { 'user-agent': 'JedloKos/1.0 (lokalna aplikacia)' };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Nutriments = Record<string, number | string | undefined>;

function toMacros(n: Nutriments | undefined): Macros | null {
  if (!n) return null;
  const macros = { kcal: Number(n['energy-kcal_100g']), protein: Number(n.proteins_100g), carbs: Number(n.carbohydrates_100g), fat: Number(n.fat_100g) };
  const values = Object.values(macros);
  if (values.some((v) => !Number.isFinite(v) || v < 0) || macros.kcal > 900 || macros.protein + macros.carbs + macros.fat > 101) return null;
  const atwater = macros.protein * 4 + macros.carbs * 4 + macros.fat * 9;
  return Math.abs(atwater - macros.kcal) > Math.max(40, macros.kcal * 0.25) ? null : macros;
}

async function cached(key: string, load: () => Promise<Macros | null>): Promise<Macros | null> {
  const hit = cacheGet<{ macros: Macros | null }>(key);
  if (hit) return hit.macros;
  const macros = await load();
  cacheSet(key, 'nutrition', { macros });
  return macros;
}

async function byEan(ean: string): Promise<Macros | null> {
  await sleep(700);
  const res = await fetch(`${OFF}/api/v2/product/${encodeURIComponent(ean)}.json?fields=nutriments`, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  return toMacros(((await res.json()) as { product?: { nutriments?: Nutriments } }).product?.nutriments);
}

async function byName(name: string): Promise<Macros | null> {
  await sleep(6500);
  const url = `${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(name)}&search_simple=1&action=process&json=1&page_size=5&fields=nutriments&cc=sk`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return null;
  const found = ((await res.json()) as { products?: { nutriments?: Nutriments }[] }).products ?? [];
  for (const product of found) {
    const macros = toMacros(product.nutriments);
    if (macros) return macros;
  }
  return null;
}

/**
 * Open Food Facts lookup per canonical ingredient: first by EAN of a mapped product, then by name.
 * Manual overrides are never touched; built-in values are replaced only by a plausible EAN match.
 */
export async function refreshNutrition(log: (line: string) => void, maxNameLookups = 6): Promise<number> {
  const targets = db.select().from(schema.ingredients).where(inArray(schema.ingredients.nutritionSource, ['none', 'builtin'])).all();
  let updated = 0;
  let nameLookups = 0;
  for (const ingredient of targets) {
    try {
      const eans = db.select({ ean: schema.products.ean }).from(schema.products)
        .where(and(eq(schema.products.ingredientId, ingredient.id), isNotNull(schema.products.ean))).limit(2).all();
      let macros: Macros | null = null;
      for (const { ean } of eans) {
        macros = ean ? await cached(`off:ean:${ean}`, () => byEan(ean)) : null;
        if (macros) break;
      }
      if (macros && ingredient.kcal !== null && Math.abs(macros.kcal - ingredient.kcal) > Math.max(30, ingredient.kcal * 0.4)) macros = null;
      if (!macros && ingredient.nutritionSource === 'none') {
        const key = `off:name:${ingredient.id}`;
        if (cacheGet(key) === undefined && nameLookups++ >= maxNameLookups) continue;
        macros = await cached(key, () => byName(ingredient.name));
      }
      if (!macros) continue;
      db.update(schema.ingredients).set({ ...macros, nutritionSource: 'off' }).where(eq(schema.ingredients.id, ingredient.id)).run();
      updated++;
    } catch (error) {
      log(`Open Food Facts (${ingredient.name}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (updated) log(`Open Food Facts: aktualizované nutričné hodnoty pre ${updated} surovín`);
  return updated;
}
