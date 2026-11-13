import { ALLERGENS, DEFAULT_SETTINGS, MEALS, STORES, type Settings } from './types';

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const subset = <T extends string>(value: unknown, allowed: readonly T[], fallback: T[]): T[] =>
  Array.isArray(value) ? allowed.filter((a) => value.includes(a)) : fallback;
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/** Merges untrusted input (localStorage, request body) with defaults and clamps every field. */
export function sanitizeSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    people: Math.round(clamp(s.people, 1, 8, d.people)),
    budget: clamp(s.budget, 10, 1000, d.budget),
    kcal: clamp(s.kcal, 1200, 4500, d.kcal),
    protein: clamp(s.protein, 30, 300, d.protein),
    carbs: clamp(s.carbs, 20, 700, d.carbs),
    fat: clamp(s.fat, 20, 250, d.fat),
    diet: oneOf(s.diet, ['all', 'pescatarian', 'vegetarian', 'vegan'] as const, d.diet),
    lactoseFree: Boolean(s.lactoseFree),
    glutenFree: Boolean(s.glutenFree),
    allergens: subset(s.allergens, ALLERGENS, d.allergens as (typeof ALLERGENS)[number][]),
    maxPrep: clamp(s.maxPrep, 10, 180, d.maxPrep),
    meals: subset(s.meals, MEALS, d.meals),
    maxRepeats: Math.round(clamp(s.maxRepeats, 1, 7, d.maxRepeats)),
    batch: s.batch === undefined ? d.batch : Boolean(s.batch),
    pantry: Array.isArray(s.pantry) ? s.pantry.filter((p): p is string => typeof p === 'string').slice(0, 200) : d.pantry,
    stores: subset(s.stores, STORES, d.stores),
    cartMode: oneOf(s.cartMode, ['split', 'single'] as const, d.cartMode),
    dealMode: oneOf(s.dealMode, ['off', 'prefer', 'only'] as const, d.dealMode),
    dealWeight: clamp(s.dealWeight, 0, 1, d.dealWeight),
  };
}
