export type Store = 'kaufland' | 'lidl';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type RecipeKind = 'breakfast' | 'main' | 'snack';
export type Diet = 'all' | 'pescatarian' | 'vegetarian' | 'vegan';
export type DealMode = 'off' | 'prefer' | 'only';

export const STORES: Store[] = ['kaufland', 'lidl'];
export const STORE_LABEL: Record<Store | 'odhad', string> = { kaufland: 'Kaufland', lidl: 'Lidl', odhad: 'Bežná cena (odhad)' };
export const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MEAL_LABEL: Record<MealType, string> = { breakfast: 'Raňajky', lunch: 'Obed', dinner: 'Večera', snack: 'Desiata' };
export const DAY_LABEL = ['Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota', 'Nedeľa'];
export const ALLERGENS = ['milk', 'gluten', 'egg', 'fish', 'nuts', 'soy'] as const;
export const ALLERGEN_LABEL: Record<string, string> = { milk: 'mlieko', gluten: 'lepok', egg: 'vajcia', fish: 'ryby', nuts: 'orechy', soy: 'sója' };

export interface Settings {
  people: number;
  budget: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  diet: Diet;
  lactoseFree: boolean;
  glutenFree: boolean;
  allergens: string[];
  maxPrep: number;
  meals: MealType[];
  maxRepeats: number;
  batch: boolean;
  pantry: string[];
  stores: Store[];
  dealMode: DealMode;
  dealWeight: number;
}

export const DEFAULT_SETTINGS: Settings = {
  people: 2,
  budget: 90,
  kcal: 2100,
  protein: 110,
  carbs: 240,
  fat: 70,
  diet: 'all',
  lactoseFree: false,
  glutenFree: false,
  allergens: [],
  maxPrep: 45,
  meals: ['breakfast', 'lunch', 'dinner'],
  maxRepeats: 2,
  batch: true,
  pantry: ['sol', 'cierne-korenie', 'olej'],
  stores: ['kaufland', 'lidl'],
  dealMode: 'prefer',
  dealWeight: 0.5,
};

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface PlanIngredient {
  id: string;
  name: string;
  grams: number;
}

export interface PlanSlot extends Macros {
  day: number;
  meal: MealType;
  recipeId: number;
  name: string;
  scale: number;
  cost: number;
  prepMinutes: number;
  tags: string[];
  source: string;
  feedback: number;
  hasDeal: boolean;
  ingredients: PlanIngredient[];
  steps: string[];
}

export interface PlanDay extends Macros {
  cost: number;
}

export interface CartLine {
  ingredientId: string;
  name: string;
  category: string;
  store: Store | 'odhad';
  productName: string;
  neededGrams: number;
  packGrams: number;
  packs: number;
  loose: boolean;
  unitPrice: number;
  lineTotal: number;
  savings: number;
  isDeal: boolean;
  estimate: boolean;
  leftoverGrams: number;
  liquid: boolean;
}

export interface Cart {
  lines: CartLine[];
  total: number;
  savings: number;
  estimateTotal: number;
}

export interface Plan {
  generatedAt: string;
  slots: PlanSlot[];
  days: PlanDay[];
  cart: Cart;
  budget: number;
  feasible: boolean;
  minCost: number | null;
  warnings: string[];
}

export interface SlotInput {
  day: number;
  meal: MealType;
  recipeId: number;
  locked: boolean;
}

export interface PlanRequest {
  settings: Settings;
  action: 'generate' | 'swap';
  slots?: SlotInput[];
  target?: { day: number; meal: MealType };
  exclude?: number[];
  /** Recipes of the previous plan; a new plan prefers different ones so regenerating visibly changes the week. */
  avoid?: number[];
  seed?: number;
}

export interface Freshness {
  lastUpdate: string | null;
  stale: boolean;
  seedOnly: boolean;
  productCount: number;
}

export interface MetaResponse {
  ingredients: { id: string; name: string; category: string }[];
  freshness: Freshness;
  hasLlm: boolean;
}

export interface DealItem {
  id: number;
  store: Store;
  name: string;
  brand: string | null;
  packText: string | null;
  price: number;
  dealPrice: number | null;
  unitPrice: number | null;
  validTo: string | null;
  category: string | null;
  image: string | null;
  sourceUrl: string;
  ingredient: string | null;
}
