import type { IngredientDiet } from './canonical';
import type { Catalog, CatalogEntry } from './catalog-core';
import { norm, round2 } from './strings';
import type { Diet, Macros, RecipeKind, RecipeListItem, RecipeOrigin, Settings } from './types';

/** Source group of a recipe: own, a known recipe site (from the source link in its steps), other web, or generated. */
export function recipeOrigin(recipe: { source: string; steps: string[] }): RecipeOrigin {
  if (recipe.source === 'own') return 'own';
  if (recipe.source === 'rule' || recipe.source === 'llm') return 'rule';
  if (recipe.source === 'yummybox') return 'yummybox';
  const link = recipe.steps.find((step) => step.startsWith('https://')) ?? '';
  if (/^https:\/\/(www\.)?billa\.sk\//.test(link)) return 'billa';
  if (/^https:\/\/([a-z]+\.)*varecha\.(pravda\.)?sk\//.test(link)) return 'varecha';
  if (/^https:\/\/(www\.)?yummybox\.sk\//.test(link)) return 'yummybox';
  return 'web';
}

export interface RecipeIngredient {
  id: string;
  grams: number;
}

export interface LibraryRecipe {
  id: number;
  name: string;
  kind: RecipeKind;
  ingredients: RecipeIngredient[];
  steps: string[];
  prepMinutes: number;
  tags: string[];
  source: string;
  feedback: number;
}

/** A stored recipe as the database and the static JSON export hold it. */
export interface RecipeRow extends Omit<LibraryRecipe, 'kind'> {
  kind: string;
}

export interface RecipeFacts extends Macros {
  diet: IngredientDiet;
  allergens: Set<string>;
  lactoseFree: boolean;
  glutenFree: boolean;
}

export interface Draft {
  name: string;
  kind: RecipeKind;
  ingredients: RecipeIngredient[];
  steps: string[];
  prepMinutes: number;
  source: 'llm' | 'rule' | 'yummybox' | 'web' | 'own';
}

export interface OwnRecipeInput {
  name: string;
  kind: RecipeKind;
  portions: number;
  prepMinutes: number;
  /** One ingredient per line, e.g. "500 g kuracie prsia". */
  ingredients: string;
  steps: string;
}

export const DIET_RANK: Record<IngredientDiet, number> = { vegan: 0, vegetarian: 1, fish: 2, meat: 3 };
export const DIET_LIMIT: Record<Diet, number> = { vegan: 0, vegetarian: 1, pescatarian: 2, all: 3 };
const DIET_TAG: Record<IngredientDiet, string> = { vegan: 'vegánske', vegetarian: 'vegetariánske', fish: 'ryba', meat: 'mäso' };
export const KCAL_RANGE: Record<RecipeKind, [number, number]> = { breakfast: [300, 650], main: [400, 850], snack: [100, 350] };

export const usable = (entry: CatalogEntry | undefined): entry is CatalogEntry => Boolean(entry && entry.macros && entry.offers.length);
export const round5 = (n: number): number => Math.max(5, Math.round(n / 5) * 5);
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Macros and dietary properties recomputed from the catalog; null when an ingredient lacks nutrition data. */
export function computeFacts(ingredients: RecipeIngredient[], catalog: Catalog): RecipeFacts | null {
  const facts: RecipeFacts = { kcal: 0, protein: 0, carbs: 0, fat: 0, diet: 'vegan', allergens: new Set(), lactoseFree: true, glutenFree: true };
  for (const { id, grams } of ingredients) {
    const entry = catalog.get(id);
    if (!entry?.macros) return null;
    const f = grams / 100;
    facts.kcal += entry.macros.kcal * f;
    facts.protein += entry.macros.protein * f;
    facts.carbs += entry.macros.carbs * f;
    facts.fat += entry.macros.fat * f;
    if (DIET_RANK[entry.diet] > DIET_RANK[facts.diet]) facts.diet = entry.diet;
    entry.allergens.forEach((a) => facts.allergens.add(a));
    facts.lactoseFree &&= entry.lactoseFree;
    facts.glutenFree &&= entry.glutenFree;
  }
  return facts;
}

/** Returns null when the recipe satisfies the user's constraints, otherwise the reason it does not. */
export function violation(facts: RecipeFacts, prepMinutes: number, settings: Settings): string | null {
  if (DIET_RANK[facts.diet] > DIET_LIMIT[settings.diet]) return 'nevyhovuje diéte';
  if (settings.lactoseFree && !facts.lactoseFree) return 'obsahuje laktózu';
  if (settings.glutenFree && !facts.glutenFree) return 'obsahuje lepok';
  const hit = settings.allergens.find((a) => facts.allergens.has(a));
  if (hit) return `obsahuje alergén ${hit}`;
  if (prepMinutes > settings.maxPrep) return `príprava ${prepMinutes} min presahuje limit`;
  return null;
}

export interface PreparedRecipe {
  name: string;
  kind: RecipeKind;
  ingredients: RecipeIngredient[];
  steps: string[];
  prepMinutes: number;
  tags: string[];
  source: Draft['source'];
}

/** "Code verifies": validates ingredients against the catalog, repairs portion size and derives tags. */
export function prepareRecipe(draft: Draft, catalog: Catalog): { recipe: PreparedRecipe; facts: RecipeFacts } | string {
  const merged = new Map<string, number>();
  for (const { id, grams } of draft.ingredients) merged.set(id, (merged.get(id) ?? 0) + grams);
  let ingredients = [...merged].map(([id, grams]) => ({ id, grams: Math.round(grams) }));
  if (ingredients.length < 2 || ingredients.length > 12) return 'recept musí mať 2 až 12 surovín';
  for (const { id, grams } of ingredients) {
    if (!usable(catalog.get(id))) return `surovina "${id}" nie je v ponuke`;
    if (!(grams >= 1 && grams <= 800)) return `nezmyselné množstvo pri "${id}"`;
  }
  let facts = computeFacts(ingredients, catalog) as RecipeFacts;
  const [min, max] = KCAL_RANGE[draft.kind];
  if (facts.kcal < min || facts.kcal > max) {
    if (facts.kcal <= 0) return 'recept nemá energetickú hodnotu';
    const factor = (min + max) / 2 / facts.kcal;
    ingredients = ingredients.map((ing) => ({ id: ing.id, grams: round5(ing.grams * factor) }));
    facts = computeFacts(ingredients, catalog) as RecipeFacts;
  }
  const prepMinutes = Math.min(180, Math.max(3, Math.round(draft.prepMinutes)));
  const tags = [DIET_TAG[facts.diet]];
  if (facts.lactoseFree) tags.push('bez laktózy');
  if (facts.glutenFree) tags.push('bez lepku');
  if (prepMinutes <= 20) tags.push('rýchle');
  if (facts.protein >= 30) tags.push('veľa bielkovín');
  return {
    facts,
    recipe: { name: cap(draft.name.trim()), kind: draft.kind, ingredients, steps: draft.steps.map((s) => s.trim()).filter(Boolean), prepMinutes, tags, source: draft.source },
  };
}

export const extrasNote = (unmatched: string[]): string[] =>
  (unmatched.length ? [`Navyše podľa receptu (nie je v košíku): ${unmatched.join('; ')}.`] : []);

/** Recipes whose every ingredient is available in the catalog, with their recomputed facts. */
export function libraryFrom(rows: RecipeRow[], catalog: Catalog): { recipe: LibraryRecipe; facts: RecipeFacts }[] {
  const out: { recipe: LibraryRecipe; facts: RecipeFacts }[] = [];
  for (const row of rows) {
    const facts = row.ingredients.every((ing) => usable(catalog.get(ing.id))) ? computeFacts(row.ingredients, catalog) : null;
    if (facts) out.push({ recipe: { ...row, kind: row.kind as RecipeKind }, facts: withTextDiet(facts, row) });
  }
  return out;
}

// Imported recipes often keep only part of their ingredients (bacon, ham or sausage may stay unrecognised), so the
// name and the note of unmatched ingredients also decide the diet: a dish that mentions meat or fish is never vegetarian.
const MEAT_WORDS = /\b(kurec|hovez|veprov|kachn|slanin|sunk|klobas|kurac|kurat|bravc|hovadz|telac|telec|mas[oa]\b|masom|masov|mlet[eyo]|salam|park[yo]|kacic|kacac|kacen|morcac|morcie|jahnac|steak|chorizo|pancett|prosciutt|bacon|ham\b|chicken|beef|pork|gyros|kebab|cevap|spek|hydin)/;
const FISH_WORDS = /\b(losos|tresk|tuniak|tunak|ryb|krevet|makrel|pstruh|sardin|ancovic|sled|kapor|tilapi|kalamar|calamar|musl|plod[yo] mora|morske plody)/;
function withTextDiet(facts: RecipeFacts, row: { name: string; steps: string[] }): RecipeFacts {
  const text = norm([row.name, ...row.steps.filter((s) => !s.startsWith('https://'))].join(' '));
  const diet = MEAT_WORDS.test(text) ? 'meat' : FISH_WORDS.test(text) ? 'fish' : null;
  return diet && DIET_RANK[diet] > DIET_RANK[facts.diet] ? { ...facts, diet } : facts;
}

/** Recipes with macros and today's cost per portion, as the Recepty screen lists them. */
export function toListItems(entries: { recipe: LibraryRecipe; facts: RecipeFacts }[], catalog: Catalog): RecipeListItem[] {
  return entries.map(({ recipe, facts }) => ({
    id: recipe.id, name: recipe.name, kind: recipe.kind, source: recipe.source, tags: recipe.tags, prepMinutes: recipe.prepMinutes, feedback: recipe.feedback,
    kcal: Math.round(facts.kcal), protein: Math.round(facts.protein), carbs: Math.round(facts.carbs), fat: Math.round(facts.fat),
    cost: round2(recipe.ingredients.reduce((acc, ing) => acc + (ing.grams / 1000) * (catalog.get(ing.id)?.unitPrice ?? 0), 0)),
    hasDeal: recipe.ingredients.some((ing) => catalog.get(ing.id)?.hasDeal),
    ingredients: recipe.ingredients.map((ing) => ({ id: ing.id, name: catalog.get(ing.id)?.name ?? ing.id, grams: ing.grams })),
    steps: recipe.steps,
    diet: facts.diet, allergens: [...facts.allergens], lactoseFree: facts.lactoseFree, glutenFree: facts.glutenFree,
  }));
}

/** Whether a library recipe fits the household's diet, allergens and prep limit (unknown facts count as fitting). */
export function fitsSettings(item: RecipeListItem, settings: Settings): boolean {
  if (!item.diet) return item.prepMinutes <= settings.maxPrep;
  const facts: RecipeFacts = {
    kcal: item.kcal, protein: item.protein, carbs: item.carbs, fat: item.fat, diet: item.diet,
    allergens: new Set(item.allergens ?? []), lactoseFree: item.lactoseFree ?? true, glutenFree: item.glutenFree ?? true,
  };
  return violation(facts, item.prepMinutes, settings) === null;
}
