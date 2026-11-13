import { buildCart, getFreshness, loadCatalog, type Catalog } from './catalog';
import { ensureLibrary, loadLibrary, violation, type LibraryRecipe, type RecipeFacts } from './recipes';
import { round2 } from './text';
import type { Cart, Macros, MealType, Plan, PlanDay, PlanRequest, PlanSlot, RecipeKind, Settings } from './types';
import { MEALS } from './types';

const DAYS = 7;
const SHARE: Record<MealType, number> = { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 };
const kindOf = (meal: MealType): RecipeKind => (meal === 'lunch' || meal === 'dinner' ? 'main' : meal);

interface Candidate {
  recipe: LibraryRecipe;
  facts: RecipeFacts;
  hasDeal: boolean;
  /** Ingredient cost of one unscaled serving; pantry items are free. */
  cost: number;
  eligible: boolean;
}

interface Slot {
  day: number;
  meal: MealType;
  targetKcal: number;
}

interface Group {
  slots: number[];
  kind: RecipeKind;
  fixed: boolean;
  choice: number;
}

interface Evaluation {
  objective: number;
  cart: Cart;
  days: Macros[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Planner {
  private readonly pantry: Set<string>;
  private readonly slots: Slot[];
  private readonly pool: Record<RecipeKind, Candidate[]> = { breakfast: [], main: [], snack: [] };
  private readonly weight: number;
  readonly warnings: string[] = [];

  constructor(private readonly settings: Settings, private readonly catalog: Catalog) {
    this.pantry = new Set(settings.pantry);
    this.weight = Math.max(settings.budget, 40);
    const meals = MEALS.filter((m) => settings.meals.includes(m));
    const shareSum = meals.reduce((acc, m) => acc + SHARE[m], 0);
    this.slots = Array.from({ length: DAYS }, (_, day) => meals.map((meal) => ({ day, meal, targetKcal: (settings.kcal * SHARE[meal]) / shareSum }))).flat();

    for (const { recipe, facts } of loadLibrary(catalog)) {
      const entries = recipe.ingredients.map((ing) => ({ ing, entry: catalog.get(ing.id) }));
      const hasDeal = entries.some(({ entry }) => entry?.hasDeal);
      this.pool[recipe.kind].push({
        recipe, facts, hasDeal,
        cost: entries.reduce((acc, { ing, entry }) => acc + (this.pantry.has(ing.id) ? 0 : (ing.grams / 1000) * (entry?.unitPrice ?? 0)), 0),
        eligible: recipe.feedback >= 0 && !violation(facts, recipe.prepMinutes, settings),
      });
    }
    if (settings.dealMode === 'only') {
      for (const kind of Object.keys(this.pool) as RecipeKind[]) {
        const withDeals = this.pool[kind].filter((c) => c.eligible && c.hasDeal);
        if (withDeals.length) this.pool[kind].forEach((c) => { c.eligible &&= c.hasDeal; });
        else if (this.slots.some((s) => kindOf(s.meal) === kind)) this.warnings.push('Pre niektoré jedlá nie sú tento týždeň akciové suroviny, použili sa aj bežné ceny.');
      }
    }
  }

  get slotList(): Slot[] {
    return this.slots;
  }

  private scale(slot: Slot, candidate: Candidate): number {
    return Math.min(1.8, Math.max(0.6, Math.round(slot.targetKcal / candidate.facts.kcal / 0.05) * 0.05));
  }

  private free(kind: RecipeKind, exclude: Set<number> = new Set()): number[] {
    return this.pool[kind].map((c, index) => (c.eligible && !exclude.has(c.recipe.id) ? index : -1)).filter((index) => index >= 0);
  }

  avoid = new Set<number>();

  indexOf(kind: RecipeKind, recipeId: number): number {
    return this.pool[kind].findIndex((c) => c.recipe.id === recipeId);
  }

  /** Groups of slots that share one recipe: batch cooking pairs consecutive days for lunch and dinner. */
  buildGroups(locked: Map<string, number>): Group[] {
    const groups: Group[] = [];
    const open = new Map<string, Group>();
    this.slots.forEach((slot, index) => {
      const kind = kindOf(slot.meal);
      const lockedId = locked.get(`${slot.day}:${slot.meal}`);
      const lockedChoice = lockedId === undefined ? -1 : this.indexOf(kind, lockedId);
      if (lockedChoice >= 0) {
        groups.push({ slots: [index], kind, fixed: true, choice: lockedChoice });
        return;
      }
      const pairKey = `${slot.meal}:${Math.floor(slot.day / 2)}`;
      const partner = this.settings.batch && kind === 'main' ? open.get(pairKey) : undefined;
      if (partner) {
        partner.slots.push(index);
        return;
      }
      const group: Group = { slots: [index], kind, fixed: false, choice: -1 };
      groups.push(group);
      open.set(pairKey, group);
    });
    for (const kind of new Set(groups.filter((g) => !g.fixed).map((g) => g.kind))) {
      if (!this.free(kind).length) throw new Error('Pre zvolené filtre sa nenašli žiadne recepty. Skúste uvoľniť diétu, alergény alebo čas prípravy.');
    }
    return groups;
  }

  evaluate(groups: Group[], variety: boolean): Evaluation {
    const { settings } = this;
    const needs = new Map<string, number>();
    const days: Macros[] = Array.from({ length: DAYS }, () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0 }));
    const uses = new Map<number, number>();
    let liked = 0;
    for (const group of groups) {
      const candidate = this.pool[group.kind][group.choice];
      uses.set(candidate.recipe.id, (uses.get(candidate.recipe.id) ?? 0) + group.slots.length);
      if (candidate.recipe.feedback > 0) liked += group.slots.length;
      for (const index of group.slots) {
        const slot = this.slots[index];
        const scale = this.scale(slot, candidate);
        for (const ing of candidate.recipe.ingredients) needs.set(ing.id, (needs.get(ing.id) ?? 0) + ing.grams * scale * settings.people);
        const day = days[slot.day];
        day.kcal += candidate.facts.kcal * scale;
        day.protein += candidate.facts.protein * scale;
        day.carbs += candidate.facts.carbs * scale;
        day.fat += candidate.facts.fat * scale;
      }
    }
    const cart = buildCart(needs, this.catalog, this.pantry);
    let objective = cart.total - liked * 0.4;
    if (settings.dealMode === 'prefer') objective -= settings.dealWeight * 0.3 * cart.lines.reduce((acc, l) => acc + (l.isDeal ? l.lineTotal : 0), 0);
    // Soft constraints: anything beyond the ±10 % tolerance costs "virtual euros" proportional to the budget.
    const excess = (value: number, target: number) => (target > 0 ? Math.max(0, Math.abs(value - target) / target - 0.1) : 0);
    for (const day of days) {
      const protein = excess(day.protein, settings.protein) * (day.protein < settings.protein ? 1 : 0.3);
      objective += this.weight * (excess(day.kcal, settings.kcal) + protein + 0.3 * excess(day.carbs, settings.carbs) + 0.3 * excess(day.fat, settings.fat));
    }
    if (variety) {
      for (const [id, count] of uses) {
        objective += Math.max(0, count - settings.maxRepeats) * this.weight * 0.15;
        if (this.avoid.has(id)) objective += count * this.weight * 0.012;
      }
    }
    return { objective, cart, days };
  }

  /** Greedy construction followed by local-search swaps on the non-fixed groups. */
  search(groups: Group[], variety: boolean, random: () => number, iterations: number): Evaluation {
    const open = groups.filter((g) => !g.fixed);
    const uses = new Map<number, number>();
    for (const group of groups) {
      if (group.choice >= 0) {
        const id = this.pool[group.kind][group.choice].recipe.id;
        uses.set(id, (uses.get(id) ?? 0) + group.slots.length);
        continue;
      }
      let bestScore = Infinity;
      for (const index of this.free(group.kind)) {
        const candidate = this.pool[group.kind][index];
        const used = uses.get(candidate.recipe.id) ?? 0;
        const servings = group.slots.reduce((acc, s) => acc + this.scale(this.slots[s], candidate), 0) * this.settings.people;
        const score = candidate.cost * servings * (candidate.hasDeal && this.settings.dealMode !== 'off' ? 1 - 0.3 * this.settings.dealWeight : 1)
          + (variety && used + group.slots.length > this.settings.maxRepeats ? this.weight * 0.15 : 0)
          + (variety && this.avoid.has(candidate.recipe.id) ? this.weight * 0.012 * group.slots.length : 0)
          - (candidate.recipe.feedback > 0 ? 0.4 : 0) + random() * 0.05;
        if (score < bestScore) { bestScore = score; group.choice = index; }
      }
      const id = this.pool[group.kind][group.choice].recipe.id;
      uses.set(id, (uses.get(id) ?? 0) + group.slots.length);
    }
    let best = this.evaluate(groups, variety);
    for (let i = 0; i < iterations && open.length; i++) {
      const group = open[Math.floor(random() * open.length)];
      const options = this.free(group.kind);
      const next = options[Math.floor(random() * options.length)];
      if (next === group.choice) continue;
      const previous = group.choice;
      group.choice = next;
      const trial = this.evaluate(groups, variety);
      if (trial.objective < best.objective - 1e-9) best = trial;
      else group.choice = previous;
    }
    return best;
  }

  /** Replaces one slot with the best alternative while everything else stays as it is. */
  swap(groups: Group[], target: Group, exclude: Set<number>): Evaluation {
    const options = this.free(target.kind, exclude);
    if (!options.length) throw new Error('Pre toto jedlo už nie je k dispozícii žiadna ďalšia alternatíva.');
    let best: Evaluation | null = null;
    let bestChoice = options[0];
    for (const option of options) {
      target.choice = option;
      const trial = this.evaluate(groups, true);
      if (!best || trial.objective < best.objective) { best = trial; bestChoice = option; }
    }
    target.choice = bestChoice;
    return best as Evaluation;
  }

  toPlan(groups: Group[], evaluation: Evaluation): Pick<Plan, 'slots' | 'days' | 'cart'> {
    const { people } = this.settings;
    const slots: PlanSlot[] = [];
    for (const group of groups) {
      const candidate = this.pool[group.kind][group.choice];
      for (const index of group.slots) {
        const slot = this.slots[index];
        const scale = this.scale(slot, candidate);
        slots.push({
          day: slot.day, meal: slot.meal, recipeId: candidate.recipe.id, name: candidate.recipe.name, scale: round2(scale),
          kcal: Math.round(candidate.facts.kcal * scale), protein: Math.round(candidate.facts.protein * scale),
          carbs: Math.round(candidate.facts.carbs * scale), fat: Math.round(candidate.facts.fat * scale),
          cost: round2(candidate.cost * scale * people), prepMinutes: candidate.recipe.prepMinutes, tags: candidate.recipe.tags,
          source: candidate.recipe.source, feedback: candidate.recipe.feedback, hasDeal: candidate.hasDeal,
          ingredients: candidate.recipe.ingredients.map((ing) => ({ id: ing.id, name: this.catalog.get(ing.id)?.name ?? ing.id, grams: Math.round(ing.grams * scale) })),
          steps: candidate.recipe.steps,
        });
      }
    }
    slots.sort((a, b) => a.day - b.day || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal));
    const days: PlanDay[] = evaluation.days.map((d, day) => ({
      kcal: Math.round(d.kcal), protein: Math.round(d.protein), carbs: Math.round(d.carbs), fat: Math.round(d.fat),
      cost: round2(slots.filter((s) => s.day === day).reduce((acc, s) => acc + s.cost, 0)),
    }));
    return { slots, days, cart: evaluation.cart };
  }
}

export async function generatePlan(request: PlanRequest): Promise<Plan> {
  const { settings } = request;
  if (!settings.meals.length) throw new Error('Vyberte aspoň jedno jedlo dňa.');
  if (!settings.stores.length) throw new Error('Vyberte aspoň jeden obchod.');
  const catalog = loadCatalog(settings.stores);
  const notes = await ensureLibrary(settings, catalog);
  const planner = new Planner(settings, catalog);
  const random = mulberry32(request.seed ?? Date.now());
  const warnings = [...planner.warnings, ...notes];
  const freshness = getFreshness();
  if (freshness.stale) warnings.push('Ceny sú staršie ako 8 dní – aktualizujte ponuku v časti Admin.');

  let groups: Group[];
  let evaluation: Evaluation;
  let feasible = true;
  let minCost: number | null = null;

  if (request.action === 'swap' && request.target && request.slots?.length) {
    const { target } = request;
    const others = new Map(request.slots.filter((s) => !(s.day === target.day && s.meal === target.meal)).map((s) => [`${s.day}:${s.meal}`, s.recipeId]));
    groups = planner.buildGroups(others);
    const open = groups.find((g) => !g.fixed && g.slots.some((i) => planner.slotList[i].day === target.day && planner.slotList[i].meal === target.meal));
    const stragglers = groups.filter((g) => !g.fixed && g !== open);
    if (!open || stragglers.length) throw new Error('Plán sa zmenil, vygenerujte ho prosím znova.');
    evaluation = planner.swap(groups, open, new Set(request.exclude ?? []));
    feasible = evaluation.cart.total <= settings.budget;
  } else {
    const locked = new Map((request.slots ?? []).filter((s) => s.locked).map((s) => [`${s.day}:${s.meal}`, s.recipeId]));
    planner.avoid = new Set(request.avoid ?? []);
    groups = planner.buildGroups(locked);
    evaluation = planner.search(groups, true, random, 2500);
    if (evaluation.cart.total > settings.budget) {
      // Budget not met: relax variety first, then report the minimum achievable cost.
      const snapshot = groups.map((g) => g.choice);
      groups.forEach((g) => { if (!g.fixed) g.choice = -1; });
      const relaxed = planner.search(groups, false, random, 4000);
      if (relaxed.cart.total < evaluation.cart.total) {
        evaluation = relaxed;
        if (relaxed.cart.total <= settings.budget) warnings.push('Aby sa plán zmestil do rozpočtu, bola znížená pestrosť jedál.');
      } else {
        groups.forEach((g, i) => { g.choice = snapshot[i]; });
      }
      if (evaluation.cart.total > settings.budget) {
        feasible = false;
        minCost = evaluation.cart.total;
        warnings.push(`Rozpočet ${settings.budget.toFixed(0)} € sa pri týchto nastaveniach nedá dodržať. Najnižšia dosiahnuteľná cena je ${minCost.toFixed(2)} €.`);
      }
    }
  }

  if (evaluation.cart.estimateTotal > 0) warnings.push('Niektoré položky nemajú aktuálnu cenu z obchodu – v košíku sú označené ako „odhad ceny“.');
  return { generatedAt: new Date().toISOString(), ...planner.toPlan(groups, evaluation), budget: settings.budget, feasible, minCost, warnings: [...new Set(warnings)] };
}
