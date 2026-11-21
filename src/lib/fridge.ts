'use client';

import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './assistant';
import { dateOfDay } from './hybridlog';
import { fitsSettings, recipeOrigin } from './recipe-core';
import { DAY_LABEL, DEFAULT_SETTINGS, MEALS, MEAL_LABEL, kindOfMeal, type MealType, type RecipeKind, type RecipeListItem, type Settings } from './types';

/** Staples that are at home anyway; they do not make a recipe a "fridge" recipe. */
const STAPLES = new Set(DEFAULT_SETTINGS.pantry);
const LIMIT: Record<RecipeKind, number> = { main: 90, breakfast: 35, snack: 25 };

export interface WeekSlot { day: number; meal: MealType }
export interface WeekChoice { day: number; meal: MealType; recipe_id: number; reason: string; alternatives: number[] }
export interface WeekProposal { summary: string; slots: WeekChoice[] }

/** Meals the week has according to the per-day settings. */
export const weekSlots = (settings: Settings): WeekSlot[] =>
  settings.dayMeals.flatMap((meals, day) => MEALS.filter((m) => meals.includes(m)).map((meal) => ({ day, meal })));

/** Ingredients of a recipe that are at home (staples like salt or oil do not count). */
export const fromFridge = (recipe: RecipeListItem, home: Set<string>): string[] =>
  recipe.ingredients.filter((i) => home.has(i.id) && !STAPLES.has(i.id)).map((i) => i.name);

/**
 * Recipes the AI may plan with: fitting the household and chosen sources, ranked by how much of the fridge they use,
 * then by price. Kept short per meal kind so the request stays small.
 */
export function fridgeCandidates(recipes: RecipeListItem[], settings: Settings, kinds: Set<RecipeKind>): RecipeListItem[] {
  const home = new Set(settings.pantry);
  const out: RecipeListItem[] = [];
  for (const kind of kinds) {
    const pool = recipes.filter((r) => r.kind === kind && r.feedback >= 0 && fitsSettings(r, settings) && settings.origins.includes(recipeOrigin(r)));
    pool.sort((a, b) => fromFridge(b, home).length - fromFridge(a, home).length || b.feedback - a.feedback || a.cost - b.cost);
    out.push(...pool.slice(0, LIMIT[kind]));
  }
  return out;
}

export async function planFromFridge(args: { recipes: RecipeListItem[]; settings: Settings; fridgeNames: string[]; note: string; wish: string }): Promise<WeekProposal> {
  const { settings } = args;
  const slots = weekSlots(settings);
  const kinds = new Set(slots.map((s) => kindOfMeal(s.meal)));
  const home = new Set(settings.pantry);
  const candidates = fridgeCandidates(args.recipes, settings, kinds);
  const body = {
    week_start: dateOfDay(0),
    fridge: args.fridgeNames.slice(0, 150),
    fridge_note: args.note.slice(0, 1500),
    wish: args.wish.slice(0, 500),
    household: {
      people: settings.people, diet: settings.diet, lactose_free: settings.lactoseFree, gluten_free: settings.glutenFree,
      allergens: settings.allergens, budget_week: settings.budget, max_repeats: settings.maxRepeats,
    },
    slots: slots.map((s) => ({ day: s.day, day_label: DAY_LABEL[s.day], meal: s.meal, meal_label: MEAL_LABEL[s.meal], kind: kindOfMeal(s.meal) })),
    candidates: candidates.map((r) => ({
      id: r.id, kind: r.kind, name: r.name, kcal: r.kcal, protein: r.protein, cost: r.cost, prep_minutes: r.prepMinutes,
      uses: fromFridge(r, home).slice(0, 30),
      other: r.ingredients.filter((i) => !home.has(i.id)).map((i) => i.name).slice(0, 30),
    })),
  };
  const { data, error } = await supabase().functions.invoke<WeekProposal & { error?: string }>('week-planner', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detail = await error.context.json().catch(() => null) as { error?: string } | null;
      throw new Error(detail?.error ?? `Chyba ${error.context.status}`);
    }
    throw new Error(error.message);
  }
  if (!data || !Array.isArray(data.slots)) throw new Error(data?.error ?? 'Prázdna odpoveď.');
  return { summary: data.summary ?? '', slots: data.slots };
}
