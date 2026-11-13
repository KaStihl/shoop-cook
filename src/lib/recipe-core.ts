import type { IngredientDiet } from './canonical';
import type { Catalog, CatalogEntry } from './catalog-core';
import { round2 } from './strings';
import type { Diet, Macros, RecipeKind, RecipeListItem, Settings } from './types';

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
    if (facts) out.push({ recipe: { ...row, kind: row.kind as RecipeKind }, facts });
  }
  return out;
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
  }));
}
