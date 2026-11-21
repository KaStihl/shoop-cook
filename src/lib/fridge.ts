'use client';

import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './assistant';
import { api } from './client';
import { dateOfDay } from './hybridlog';
import { DAY_LABEL, MEALS, MEAL_LABEL, kindOfMeal, type MealType, type MetaResponse, type RecipeKind, type RecipeListItem, type Settings } from './types';

export interface WeekSlot { day: number; meal: MealType }
/** A recipe the AI invented: ingredients are canonical ids with grams per portion. */
export interface IdeaRecipe {
  key: string;
  kind: RecipeKind;
  name: string;
  prep_minutes: number;
  ingredients: { id: string; grams: number }[];
  steps: string[];
  uses: string[];
}
export interface IdeaSlot { day: number; meal: MealType; recipe: string; alternatives: string[]; /** Kept when ideas are made again. */ locked?: boolean }
export interface WeekProposal { summary: string; recipes: IdeaRecipe[]; slots: IdeaSlot[] }

/** Meals the week has according to the per-day settings. */
export const weekSlots = (settings: Settings): WeekSlot[] =>
  settings.dayMeals.flatMap((meals, day) => MEALS.filter((m) => meals.includes(m)).map((meal) => ({ day, meal })));

/** Asks the HybridLog coach (week-planner edge function) to invent recipes for the week from what is at home. */
export async function inventWeek(args: {
  settings: Settings; ingredients: MetaResponse['ingredients']; recipes: RecipeListItem[]; note: string; wish: string;
  /** Meals to invent; defaults to the whole week. */
  only?: WeekSlot[];
  /** Meals that stay (locked by the user), so the new ideas fit around them. */
  keep?: { slot: WeekSlot; recipe: IdeaRecipe }[];
}): Promise<WeekProposal> {
  const { settings } = args;
  const targets = args.only ?? weekSlots(settings);
  const names = new Map(args.ingredients.map((i) => [i.id, i.name]));
  const body = {
    week_start: dateOfDay(0),
    fridge: settings.pantry.map((id) => names.get(id) ?? id).slice(0, 150),
    fridge_note: args.note.slice(0, 1500),
    wish: args.wish.slice(0, 500),
    household: {
      people: settings.people, diet: settings.diet, lactose_free: settings.lactoseFree, gluten_free: settings.glutenFree,
      allergens: settings.allergens, budget_week: settings.budget, max_repeats: settings.maxRepeats, max_prep_minutes: Math.round(settings.maxPrep),
    },
    slots: targets.map((s) => ({ day: s.day, day_label: DAY_LABEL[s.day], meal: s.meal, meal_label: MEAL_LABEL[s.meal], kind: kindOfMeal(s.meal) })),
    // Only ingredients with a price and nutrition data, so every invented recipe can be costed and bought.
    ingredients: args.ingredients.filter((i) => i.usable !== false).map((i) => ({ id: i.id, name: i.name })),
    // Own recipes already in the app; the AI should come up with something else.
    avoid_names: args.recipes.filter((r) => r.source === 'own').map((r) => r.name).slice(0, 60),
    keep: (args.keep ?? []).slice(0, 35).map(({ slot, recipe }) => ({
      day_label: DAY_LABEL[slot.day], meal_label: MEAL_LABEL[slot.meal], name: recipe.name,
      ingredients: recipe.ingredients.map((i) => names.get(i.id) ?? i.id).slice(0, 15),
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
  if (!data || !Array.isArray(data.slots) || !Array.isArray(data.recipes)) throw new Error(data?.error ?? 'Prázdna odpoveď.');
  // Keys are unique per answer only; a round prefix keeps them apart when the answer is merged into earlier ideas.
  const round = Date.now().toString(36);
  const key = (k: string) => `${round}-${k}`;
  return {
    summary: data.summary ?? '',
    recipes: data.recipes.map((r) => ({ ...r, key: key(r.key) })),
    slots: data.slots.map((s) => ({ ...s, recipe: key(s.recipe), alternatives: s.alternatives.map(key) })),
  };
}

/** Puts freshly invented meals into an existing proposal; other meals stay, unused recipes are dropped. */
export function mergeProposal(previous: WeekProposal | null, next: WeekProposal, replaced: WeekSlot[]): WeekProposal {
  if (!previous) return next;
  const isReplaced = (s: { day: number; meal: MealType }) => replaced.some((r) => r.day === s.day && r.meal === s.meal);
  const slots = [...previous.slots.filter((s) => !isReplaced(s)), ...next.slots.filter(isReplaced)];
  const used = new Set(slots.flatMap((s) => [s.recipe, ...s.alternatives]));
  const recipes = [...previous.recipes, ...next.recipes].filter((r) => used.has(r.key));
  return { summary: next.summary || previous.summary, recipes, slots };
}

/**
 * Saves the invented recipes the week actually uses as the user's own recipes (so the planner can cost them and put
 * the missing ingredients into the cart) and returns their library ids by idea key.
 */
export async function saveIdeas(ideas: IdeaRecipe[]): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  const failures: string[] = [];
  for (const idea of ideas) {
    try {
      await api('/api/recipes', {
        method: 'POST',
        body: JSON.stringify({
          action: 'own', kind: idea.kind,
          recipe: {
            name: idea.name, kind: idea.kind, portions: 1, prepMinutes: idea.prep_minutes, ingredients: '', mapped: idea.ingredients,
            steps: [...idea.steps, 'Nápad AI z Chladničky (JedloKôš).'].join('\n'),
          },
        }),
      });
    } catch (e) {
      // A recipe of the same name saved earlier is reused below; anything else is reported.
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes('už máte uložený')) failures.push(`${idea.name}: ${message}`);
    }
  }
  const library = await api<RecipeListItem[]>('/api/recipes');
  for (const idea of ideas) {
    const found = library.find((r) => r.source === 'own' && r.kind === idea.kind && r.name.toLowerCase() === cap(idea.name.trim()).toLowerCase());
    if (found) ids.set(idea.key, found.id);
  }
  if (!ids.size && failures.length) throw new Error(failures.join(' · '));
  return ids;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
