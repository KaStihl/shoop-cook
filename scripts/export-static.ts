import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db';
import { getFreshness } from '@/lib/catalog';
import type { StaticCatalog, StaticDeal } from '@/lib/static-backend';
import type { Store } from '@/lib/types';

// Usage: npm run export   (writes public/data/*.json and a database snapshot for the static GitHub Pages build)
const dir = join(process.cwd(), 'public', 'data');
mkdirSync(dir, { recursive: true });
const p = schema.products;

const catalog: StaticCatalog = {
  generatedAt: new Date().toISOString(),
  freshness: getFreshness(),
  ingredients: db.select().from(schema.ingredients).all().map((row) => ({
    id: row.id, name: row.name, category: row.category, role: row.role, diet: row.diet, allergens: row.allergens, lactoseFree: row.lactoseFree,
    glutenFree: row.glutenFree, kcal: row.kcal, protein: row.protein, carbs: row.carbs, fat: row.fat, baselinePrice: row.baselinePrice,
    baselinePack: row.baselinePack, pieceGrams: row.pieceGrams,
  })),
  products: db.select({
    store: p.store, name: p.name, packQty: p.packQty, packUnit: p.packUnit, loose: p.loose, price: p.price, dealPrice: p.dealPrice,
    validFrom: p.validFrom, validTo: p.validTo, ingredientId: p.ingredientId,
  }).from(p).where(isNotNull(p.ingredientId)).all(),
  // Likes and bans are personal, so the published library carries none.
  recipes: db.select().from(schema.recipes).all().map((row) => ({
    id: row.id, name: row.name, kind: row.kind, ingredients: row.ingredients, steps: row.steps, prepMinutes: row.prepMinutes, tags: row.tags, source: row.source, feedback: 0,
  })),
};

const deals: StaticDeal[] = db.select({
  id: p.id, store: p.store, name: p.name, brand: p.brand, packText: p.packText, price: p.price, dealPrice: p.dealPrice, unitPrice: p.unitPrice,
  validFrom: p.validFrom, validTo: p.validTo, category: p.category, image: p.image, sourceUrl: p.sourceUrl, ingredient: schema.ingredients.name,
}).from(p).leftJoin(schema.ingredients, eq(p.ingredientId, schema.ingredients.id)).all()
  .map((row) => ({ ...row, store: row.store as Store, mapped: row.ingredient !== null }));

writeFileSync(join(dir, 'catalog.json'), JSON.stringify(catalog));
writeFileSync(join(dir, 'deals.json'), JSON.stringify(deals));
// The published database copy is what the next scheduled run starts from, so recipes and mappings survive between runs.
const snapshot = join(dir, 'jedlokos.db');
rmSync(snapshot, { force: true });
db.run(`VACUUM INTO '${snapshot.replace(/\\/g, '/').replace(/'/g, "''")}'`);
console.log(`Export: ${catalog.ingredients.length} surovín, ${catalog.products.length} zaradených produktov, ${catalog.recipes.length} receptov, ${deals.length} položiek ponuky.`);
