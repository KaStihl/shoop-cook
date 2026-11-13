import { buildCatalog, type Catalog, type IngredientRow, type ProductRow } from './catalog-core';
import { parseIngredientLines } from './ingredients';
import { planWith } from './planner-core';
import { extrasNote, libraryFrom, prepareRecipe, toListItems, type OwnRecipeInput, type RecipeRow } from './recipe-core';
import { sanitizeSettings } from './settings';
import { norm, today } from './strings';
import { STORES, type DealItem, type Freshness, type MetaResponse, type PlanRequest, type RecipeKind, type Store } from './types';

/** Shape of public/data/catalog.json written by scripts/export-static.ts. */
export interface StaticCatalog {
  generatedAt: string;
  freshness: Freshness;
  ingredients: IngredientRow[];
  products: ProductRow[];
  recipes: RecipeRow[];
}

export interface StaticDeal extends DealItem {
  validFrom: string | null;
  mapped: boolean;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const LOCAL_ONLY = 'Táto funkcia je dostupná len v lokálnej verzii aplikácie (start.bat).';
const OWN_KEY = 'jedlokos.ownRecipes';
const FEEDBACK_KEY = 'jedlokos.feedback';
const STALE_DAYS = 8;
const PAGE = 48;

const cache = new Map<string, Promise<unknown>>();
function file<T>(name: string): Promise<T> {
  let pending = cache.get(name) as Promise<T> | undefined;
  if (!pending) {
    pending = fetch(`${BASE}/data/${name}`).then((response) => {
      if (!response.ok) throw new Error('Dáta sa nepodarilo načítať. Skúste stránku obnoviť.');
      return response.json() as Promise<T>;
    });
    pending.catch(() => cache.delete(name));
    cache.set(name, pending);
  }
  return pending;
}

function stored<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Library recipes plus the visitor's own ones; likes and bans live in this browser only. */
function recipeRows(data: StaticCatalog): RecipeRow[] {
  const feedback = stored<Record<string, number>>(FEEDBACK_KEY, {});
  return [...data.recipes, ...stored<RecipeRow[]>(OWN_KEY, [])].map((row) => ({ ...row, feedback: feedback[row.id] ?? 0 }));
}

const catalogFor = (data: StaticCatalog, stores: Store[]): Catalog => buildCatalog(data.ingredients, data.products, stores);

function freshness(data: StaticCatalog): Freshness {
  const { lastUpdate } = data.freshness;
  return { ...data.freshness, stale: !lastUpdate || Date.now() - new Date(lastUpdate).getTime() > STALE_DAYS * 86400000 };
}

function saveOwn(data: StaticCatalog, input: OwnRecipeInput, kind: RecipeKind): { name: string } {
  const catalog = catalogFor(data, STORES);
  const name = input.name.trim();
  if (name.length < 3) throw new Error('Zadajte názov receptu.');
  const lines = input.ingredients.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const { mapped, unmatched } = parseIngredientLines(lines, Math.max(1, Math.round(input.portions) || 1), catalog);
  if (mapped.length < 2) throw new Error(`Rozpoznané sú len ${mapped.length} z ${lines.length} surovín. Uveďte aspoň dve bežné suroviny s množstvom, napr. 500 g kuracie prsia.`);
  const steps = [...input.steps.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), ...extrasNote(unmatched)];
  const result = prepareRecipe({ name, kind, ingredients: mapped, steps, prepMinutes: input.prepMinutes || 30, source: 'own' }, catalog);
  if (typeof result === 'string') throw new Error(result);
  const own = stored<RecipeRow[]>(OWN_KEY, []);
  if (own.some((r) => r.name.toLowerCase() === result.recipe.name.toLowerCase())) throw new Error('Recept s týmto názvom už máte uložený.');
  // Own recipes get negative ids so they never collide with the published library.
  localStorage.setItem(OWN_KEY, JSON.stringify([...own, { ...result.recipe, id: Math.min(0, ...own.map((r) => r.id)) - 1, feedback: 0 }]));
  return { name: result.recipe.name };
}

async function deals(params: URLSearchParams): Promise<{ items: DealItem[]; total: number; pageSize: number }> {
  const all = await file<StaticDeal[]>('deals.json');
  const q = norm(params.get('q') ?? '');
  const store = params.get('store');
  const day = today();
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const rows = all.filter((p) => (!p.validTo || p.validTo >= day)
    && (!q || norm(`${p.name} ${p.brand ?? ''}`).includes(q))
    && (!STORES.includes(store as Store) || p.store === store)
    && (params.get('deals') !== '1' || p.dealPrice !== null)
    && (params.get('mapped') !== '1' || p.mapped));
  rows.sort((a, b) => Number(a.dealPrice === null) - Number(b.dealPrice === null) || Number(!a.mapped) - Number(!b.mapped) || a.name.localeCompare(b.name, 'sk'));
  return { items: rows.slice(offset, offset + PAGE), total: rows.length, pageSize: PAGE };
}

/** Answers the app's API calls in the browser from the exported JSON files; used by the static (GitHub Pages) build. */
export async function staticApi<T>(url: string, init?: RequestInit): Promise<T> {
  const target = new URL(url, 'http://static.local');
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  const route = `${init?.method ?? 'GET'} ${target.pathname}`;
  if (route === 'GET /api/deals') return (await deals(target.searchParams)) as T;

  const data = await file<StaticCatalog>('catalog.json');
  switch (route) {
    case 'GET /api/meta': {
      const ingredients = data.ingredients.map(({ id, name, category }) => ({ id, name, category })).sort((a, b) => a.name.localeCompare(b.name, 'sk'));
      return { ingredients, freshness: freshness(data), hasLlm: false } satisfies MetaResponse as T;
    }
    case 'POST /api/plan': {
      const request = body as unknown as PlanRequest;
      const rows = recipeRows(data);
      return planWith({ ...request, settings: sanitizeSettings(request.settings) }, {
        catalog: (stores) => catalogFor(data, stores), library: (catalog) => libraryFrom(rows, catalog), notes: [], stale: freshness(data).stale,
      }) as T;
    }
    case 'GET /api/recipes': {
      const catalog = catalogFor(data, STORES);
      return toListItems(libraryFrom(recipeRows(data), catalog), catalog) as T;
    }
    case 'POST /api/recipes': {
      const kind = (['breakfast', 'main', 'snack'] as const).find((k) => k === body.kind) ?? 'main';
      if (body.action === 'own' && body.recipe) return saveOwn(data, body.recipe as OwnRecipeInput, kind) as T;
      if (body.action === 'delete') {
        localStorage.setItem(OWN_KEY, JSON.stringify(stored<RecipeRow[]>(OWN_KEY, []).filter((r) => r.id !== body.id)));
        return { ok: true } as T;
      }
      throw new Error(`Načítanie receptu z URL nie je v online verzii dostupné. ${LOCAL_ONLY}`);
    }
    case 'POST /api/recipes/feedback': {
      localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ ...stored<Record<string, number>>(FEEDBACK_KEY, {}), [String(body.id)]: body.value }));
      return { ok: true } as T;
    }
    default:
      throw new Error(LOCAL_ONLY);
  }
}
