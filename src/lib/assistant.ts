'use client';

import { createClient, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { dateOfDay } from './hybridlog';
import { fitsSettings } from './recipe-core';
import { DAY_LABEL, MEAL_LABEL, kindOfMeal, type Plan, type PlanSlot, type RecipeListItem, type Settings } from './types';

/**
 * The AI helper runs as the `meal-assistant` edge function in HybridLog's Supabase project, so it reuses
 * HybridLog's account, athlete profile, Claude key (a server secret) and daily call cap.
 * URL and anon key are public by design (they ship in HybridLog's bundle too); data is protected by RLS.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xgvjeaymmmbffjltsgvi.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndmplYXltbW1iZmZqbHRzZ3ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNjI4OTcsImV4cCI6MjEwMjYzODg5N30.5AAImjIm5XBKCDHgH3cC8PUgcNTHxrI2oosvU5tlnOY';

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'jedlokos-auth' } });
  return client;
}

export interface ChatTurn { role: 'user' | 'assistant'; content: string }
export interface Suggestion { recipe_id: number; reason: string }
export interface AssistantReply { reply: string; suggestions: Suggestion[] }

const MAX_CANDIDATES = 60;

/**
 * Recipes the assistant may suggest for this meal: same kind, fitting the household, not disliked.
 * A mix of the cheapest, the most protein-dense and the liked ones keeps the list short but varied.
 */
export function candidatesFor(slot: PlanSlot, recipes: RecipeListItem[], settings: Settings): RecipeListItem[] {
  const kind = kindOfMeal(slot.meal);
  const pool = recipes.filter((r) => r.kind === kind && r.feedback >= 0 && r.id !== slot.recipeId && fitsSettings(r, settings));
  const picked = new Map<number, RecipeListItem>();
  const take = (list: RecipeListItem[], n: number) => list.slice(0, n).forEach((r) => picked.set(r.id, r));
  take(pool.filter((r) => r.feedback > 0), 15);
  take([...pool].sort((a, b) => a.cost - b.cost), 25);
  take([...pool].sort((a, b) => b.protein / Math.max(b.kcal, 1) - a.protein / Math.max(a.kcal, 1)), 25);
  take(pool.filter((r) => r.hasDeal), 15);
  return [...picked.values()].slice(0, MAX_CANDIDATES);
}

export async function askAssistant(args: {
  slot: PlanSlot; plan: Plan; settings: Settings; recipes: RecipeListItem[]; message: string; history: ChatTurn[];
}): Promise<AssistantReply> {
  const { slot, plan, settings } = args;
  const body = {
    date: dateOfDay(slot.day),
    day_label: DAY_LABEL[slot.day],
    meal_label: MEAL_LABEL[slot.meal],
    meal: {
      name: slot.name, kcal: slot.kcal, protein: slot.protein, carbs: slot.carbs, fat: slot.fat,
      cost: slot.cost, prep_minutes: slot.prepMinutes,
      ingredients: slot.ingredients.slice(0, 40).map((i) => ({ name: i.name, grams: i.grams })),
    },
    day_meals: plan.slots.filter((s) => s.day === slot.day && s.meal !== slot.meal)
      .map((s) => ({ meal_label: MEAL_LABEL[s.meal], name: s.name, kcal: s.kcal, protein: s.protein })),
    household: {
      people: plan.people ?? settings.people, diet: settings.diet, lactose_free: settings.lactoseFree, gluten_free: settings.glutenFree,
      allergens: settings.allergens, budget_week: plan.budget, cart_total: plan.cart.total,
    },
    candidates: candidatesFor(slot, args.recipes, settings).map((r) => ({
      id: r.id, name: r.name, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, cost: r.cost, prep_minutes: r.prepMinutes,
    })),
    message: args.message,
    history: args.history.slice(-10),
  };
  const { data, error } = await supabase().functions.invoke<AssistantReply & { error?: string }>('meal-assistant', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detail = await error.context.json().catch(() => null) as { error?: string } | null;
      throw new Error(detail?.error ?? `Chyba ${error.context.status}`);
    }
    throw new Error(error.message);
  }
  if (!data || typeof data.reply !== 'string') throw new Error(data?.error ?? 'Prázdna odpoveď.');
  return { reply: data.reply, suggestions: data.suggestions ?? [] };
}
