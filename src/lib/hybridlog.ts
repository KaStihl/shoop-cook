import { MEAL_LABEL, type MealType, type PlanSlot } from './types';

/** HybridLog (the user's nutrition and training log) accepts planned meals through an `#import=` link. */
export const HYBRIDLOG_URL = 'https://hybridlog.pages.dev/';

const SLOT: Record<MealType, string> = { breakfast: 'breakfast', snack: 'snack', lunch: 'lunch', afternoon: 'snack_pm', dinner: 'dinner' };

export interface HybridMeal {
  date: string;
  slot: string;
  text: string;
  items: { name: string; grams: number | null; kcal: number; protein_g: number; carbs_g: number; fat_g: number }[];
}

/** ISO date of a plan day (0 = Monday) in the week that contains `base`, in local time. */
export function dateOfDay(day: number, base = new Date()): string {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() - ((base.getDay() + 6) % 7) + day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** One planned portion in HybridLog's meal shape: items carry their own macros, totals are recomputed there. */
export function toHybridMeal(slot: PlanSlot, date: string): HybridMeal {
  const detailed = slot.ingredients.every((ing) => typeof ing.kcal === 'number');
  return {
    date, slot: SLOT[slot.meal], text: slot.name,
    items: detailed
      ? slot.ingredients.map((ing) => ({ name: ing.name, grams: ing.grams, kcal: ing.kcal ?? 0, protein_g: ing.protein ?? 0, carbs_g: ing.carbs ?? 0, fat_g: ing.fat ?? 0 }))
      // Plans generated before per-ingredient macros existed are sent as one item with the meal's totals.
      : [{ name: slot.name, grams: null, kcal: slot.kcal, protein_g: slot.protein, carbs_g: slot.carbs, fat_g: slot.fat }],
  };
}

export function hybridLink(meals: HybridMeal[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, source: 'jedlokos', meals }));
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return `${HYBRIDLOG_URL}#import=${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** Plain-text version of the same meals, for pasting into HybridLog's text entry. */
export function hybridText(slots: PlanSlot[]): string {
  return slots.map((slot) => `${MEAL_LABEL[slot.meal]} – ${slot.name}: ${slot.ingredients.map((ing) => `${ing.name} ${ing.grams} g`).join(', ')} (${slot.kcal} kcal, B ${slot.protein} g, S ${slot.carbs} g, T ${slot.fat} g)`).join('\n');
}
