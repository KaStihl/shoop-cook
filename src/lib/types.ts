export type Store = 'kaufland' | 'lidl' | 'billa' | 'tesco';
export type CartMode = 'split' | 'single';
export type MealType = 'breakfast' | 'snack' | 'lunch' | 'afternoon' | 'dinner';
export type RecipeKind = 'breakfast' | 'main' | 'snack';
export type Diet = 'all' | 'pescatarian' | 'vegetarian' | 'vegan';
export type DealMode = 'off' | 'prefer' | 'only';

export const STORES: Store[] = ['kaufland', 'lidl', 'billa', 'tesco'];
export const STORE_HOME: Record<Store, string> = { kaufland: 'https://www.kaufland.sk', lidl: 'https://www.lidl.sk', billa: 'https://www.billa.sk', tesco: 'https://tesco.sk' };
export const STORE_LABEL: Record<Store | 'odhad', string> = { kaufland: 'Kaufland', lidl: 'Lidl', billa: 'Billa', tesco: 'Tesco', odhad: 'Bežná cena (odhad)' };
/** Meals of the day in the order they are eaten. */
export const MEALS: MealType[] = ['breakfast', 'snack', 'lunch', 'afternoon', 'dinner'];
export const kindOfMeal = (meal: MealType): RecipeKind => (meal === 'lunch' || meal === 'dinner' ? 'main' : meal === 'breakfast' ? 'breakfast' : 'snack');
export const MEAL_LABEL: Record<MealType, string> = { breakfast: 'Raňajky', snack: 'Desiata', lunch: 'Obed', afternoon: 'Olovrant', dinner: 'Večera' };
export const DAY_LABEL = ['Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota', 'Nedeľa'];
export const ALLERGENS = ['milk', 'gluten', 'egg', 'fish', 'nuts', 'soy'] as const;
export const ALLERGEN_LABEL: Record<string, string> = { milk: 'mlieko', gluten: 'lepok', egg: 'vajcia', fish: 'ryby', nuts: 'orechy', soy: 'sója' };

export interface Settings {
  people: number;
  budget: number;
  diet: Diet;
  lactoseFree: boolean;
  glutenFree: boolean;
  allergens: string[];
  maxPrep: number;
  /** Every meal planned on at least one day (derived from `dayMeals`). */
  meals: MealType[];
  /** Meals planned on each day, Monday first; a day may have any subset, or none. */
  dayMeals: MealType[][];
  maxRepeats: number;
  batch: boolean;
  pantry: string[];
  stores: Store[];
  /** 'split' buys every item where it is cheapest; 'single' puts the whole cart into the one cheapest chain. */
  cartMode: CartMode;
  dealMode: DealMode;
  dealWeight: number;
}

export const DEFAULT_SETTINGS: Settings = {
  people: 2,
  budget: 90,
  diet: 'all',
  lactoseFree: false,
  glutenFree: false,
  allergens: [],
  maxPrep: 45,
  meals: ['breakfast', 'lunch', 'dinner'],
  dayMeals: Array.from({ length: 7 }, (): MealType[] => ['breakfast', 'lunch', 'dinner']),
  maxRepeats: 2,
  batch: true,
  pantry: ['sol', 'cierne-korenie', 'olej'],
  stores: ['kaufland', 'lidl', 'billa', 'tesco'],
  cartMode: 'split',
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
  /** Macros of this amount; absent in plans stored before they were added. */
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
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
  /** People the plan was computed for; meal values in `slots` are per person. Absent in older stored plans. */
  people?: number;
  slots: PlanSlot[];
  days: PlanDay[];
  cart: Cart;
  budget: number;
  /** Set when the whole cart comes from one chain (cart mode 'single'). */
  singleStore: Store | null;
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

export const SOURCE_LABEL: Record<string, string> = {
  own: 'vlastný recept', web: 'recept z webu', yummybox: 'recept z yummybox.sk', llm: 'AI recept', rule: 'zostavený zo surovín',
};
export const KIND_LABEL: Record<RecipeKind, string> = { breakfast: 'Raňajky', main: 'Obed / večera', snack: 'Desiata' };

export interface RecipeListItem extends Macros {
  id: number;
  name: string;
  kind: RecipeKind;
  source: string;
  tags: string[];
  prepMinutes: number;
  feedback: number;
  /** Ingredient cost of one portion at today's cheapest prices. */
  cost: number;
  hasDeal: boolean;
  ingredients: PlanIngredient[];
  steps: string[];
}
