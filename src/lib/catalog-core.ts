import type { IngredientDiet, Role } from './canonical';
import { round2, today } from './strings';
import type { Cart, CartLine, Macros, Store } from './types';

/** The columns of an ingredient the catalog needs; database rows and the static JSON export both satisfy it. */
export interface IngredientRow {
  id: string;
  name: string;
  category: string;
  role: string;
  diet: string;
  allergens: string[];
  lactoseFree: boolean;
  glutenFree: boolean;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  baselinePrice: number | null;
  baselinePack: number;
  pieceGrams: number | null;
}

export interface ProductRow {
  store: string;
  name: string;
  packQty: number | null;
  packUnit: string | null;
  loose: boolean;
  price: number;
  dealPrice: number | null;
  validFrom: string | null;
  validTo: string | null;
  ingredientId: string | null;
}

export interface Offer {
  store: Store | 'odhad';
  productName: string;
  packGrams: number;
  loose: boolean;
  price: number;
  regularPrice: number;
  isDeal: boolean;
  unitPrice: number;
  estimate: boolean;
}

export interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  role: Role;
  diet: IngredientDiet;
  allergens: string[];
  lactoseFree: boolean;
  glutenFree: boolean;
  liquid: boolean;
  macros: Macros | null;
  offers: Offer[];
  unitPrice: number | null;
  hasDeal: boolean;
}

export type Catalog = Map<string, CatalogEntry>;

/** Live offers per canonical ingredient for the selected stores; the baseline price book fills the gaps. */
export function buildCatalog(ingredients: IngredientRow[], products: ProductRow[], stores: Store[]): Catalog {
  const day = today();
  const catalog: Catalog = new Map();
  const baselines = new Map<string, { price: number | null; pieceGrams: number | null }>();
  for (const row of ingredients) {
    baselines.set(row.id, { price: row.baselinePrice, pieceGrams: row.pieceGrams });
    catalog.set(row.id, {
      id: row.id, name: row.name, category: row.category, role: row.role as Role, diet: row.diet as IngredientDiet,
      allergens: row.allergens, lactoseFree: row.lactoseFree, glutenFree: row.glutenFree,
      liquid: row.role === 'milk' || /olej|mlieko|omáčka|smotana/.test(row.name),
      macros: row.kcal === null || row.protein === null || row.carbs === null || row.fat === null
        ? null : { kcal: row.kcal, protein: row.protein, carbs: row.carbs, fat: row.fat },
      offers: row.baselinePrice
        ? [{
            store: 'odhad', productName: row.name, packGrams: row.baselinePack, loose: false, estimate: true, isDeal: false,
            price: round2((row.baselinePrice * row.baselinePack) / 1000), regularPrice: round2((row.baselinePrice * row.baselinePack) / 1000),
            unitPrice: row.baselinePrice,
          }]
        : [],
      unitPrice: null,
      hasDeal: false,
    });
  }

  for (const product of products) {
    if (!product.ingredientId || !stores.includes(product.store as Store)) continue;
    const entry = catalog.get(product.ingredientId as string);
    const base = baselines.get(product.ingredientId as string);
    if (!entry || !base || !product.packQty) continue;
    if ((product.validTo && product.validTo < day) || (product.validFrom && product.validFrom > day)) continue;
    const packGrams = product.packUnit === 'ks' ? (base.pieceGrams ? product.packQty * base.pieceGrams : 0) : product.packQty;
    if (packGrams <= 0) continue;
    const price = product.dealPrice ?? product.price;
    const unitPrice = (price / packGrams) * 1000;
    // Guards against mis-mapped products (spice sachets, multipacks) distorting the plan.
    if (base.price && (unitPrice > base.price * 6 || unitPrice < base.price / 6)) continue;
    if (entry.offers[0]?.estimate) entry.offers = [];
    entry.offers.push({
      store: product.store as Store, productName: product.name, packGrams, loose: product.loose, price,
      regularPrice: product.price, isDeal: product.dealPrice !== null, unitPrice, estimate: false,
    });
  }
  for (const entry of catalog.values()) {
    entry.unitPrice = entry.offers.length ? Math.min(...entry.offers.map((o) => o.unitPrice)) : null;
    entry.hasDeal = entry.offers.some((o) => o.isDeal);
  }
  return catalog;
}

/** Aggregated needs (grams per ingredient) -> cheapest real packages across the catalog's stores. */
export function buildCart(needs: Map<string, number>, catalog: Catalog, pantry: Set<string>): Cart {
  const lines: CartLine[] = [];
  for (const [id, grams] of needs) {
    const entry = catalog.get(id);
    if (!entry || pantry.has(id) || grams <= 0) continue;
    let best: { offer: Offer; packs: number; total: number } | null = null;
    for (const offer of entry.offers) {
      const packs = offer.loose ? Math.ceil(grams / 50) * 0.05 : Math.ceil(grams / offer.packGrams - 1e-9);
      const total = packs * offer.price;
      if (!best || total < best.total) best = { offer, packs, total };
    }
    if (!best) continue;
    const { offer, packs, total } = best;
    lines.push({
      ingredientId: id, name: entry.name, category: entry.category, store: offer.store, productName: offer.productName,
      neededGrams: Math.round(grams), packGrams: offer.packGrams, packs: round2(packs), loose: offer.loose,
      unitPrice: round2(offer.unitPrice), lineTotal: round2(total), savings: round2(packs * (offer.regularPrice - offer.price)),
      isDeal: offer.isDeal, estimate: offer.estimate, leftoverGrams: Math.max(0, Math.round(packs * offer.packGrams - grams)),
      liquid: entry.liquid,
    });
  }
  lines.sort((a, b) => a.store.localeCompare(b.store) || a.category.localeCompare(b.category, 'sk') || a.name.localeCompare(b.name, 'sk'));
  const sum = (pick: (l: CartLine) => number) => round2(lines.reduce((acc, l) => acc + pick(l), 0));
  return { lines, total: sum((l) => l.lineTotal), savings: sum((l) => l.savings), estimateTotal: sum((l) => (l.estimate ? l.lineTotal : 0)) };
}
