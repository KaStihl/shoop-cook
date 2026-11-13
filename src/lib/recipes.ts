import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { cacheGet, cacheSet, db, schema } from '@/db';
import { RECIPE_MODEL, hasLlm, llm } from './anthropic';
import type { IngredientDiet, Role } from './canonical';
import type { Catalog, CatalogEntry } from './catalog';
import { sha } from './text';
import type { Diet, Macros, RecipeKind, Settings } from './types';

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

export interface RecipeFacts extends Macros {
  diet: IngredientDiet;
  allergens: Set<string>;
  lactoseFree: boolean;
  glutenFree: boolean;
}

interface Draft {
  name: string;
  kind: RecipeKind;
  ingredients: RecipeIngredient[];
  steps: string[];
  prepMinutes: number;
  source: 'llm' | 'rule';
}

const DIET_RANK: Record<IngredientDiet, number> = { vegan: 0, vegetarian: 1, fish: 2, meat: 3 };
const DIET_LIMIT: Record<Diet, number> = { vegan: 0, vegetarian: 1, pescatarian: 2, all: 3 };
const DIET_TAG: Record<IngredientDiet, string> = { vegan: 'vegánske', vegetarian: 'vegetariánske', fish: 'ryba', meat: 'mäso' };
const KCAL_RANGE: Record<RecipeKind, [number, number]> = { breakfast: [300, 650], main: [400, 850], snack: [100, 350] };
const KIND_LABEL: Record<RecipeKind, string> = { breakfast: 'raňajky', main: 'hlavné jedlá (obed/večera)', snack: 'desiaty' };
const MIN_LIBRARY: Record<RecipeKind, number> = { breakfast: 5, main: 8, snack: 4 };

const usable = (entry: CatalogEntry | undefined): entry is CatalogEntry => Boolean(entry && entry.macros && entry.offers.length);
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Macros and dietary properties recomputed from the DB; null when an ingredient lacks nutrition data. */
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

/** "Code verifies": validates ingredients against the catalog, repairs portion size and derives tags. */
function finalize(draft: Draft, catalog: Catalog): { row: typeof schema.recipes.$inferInsert; facts: RecipeFacts } | string {
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
    row: {
      name: cap(draft.name.trim()), kind: draft.kind, ingredients, steps: draft.steps.map((s) => s.trim()).filter(Boolean), prepMinutes, tags,
      ingredientKey: sha(`${draft.kind}|${ingredients.map((x) => x.id).sort().join(',')}`), source: draft.source,
      createdAt: new Date().toISOString(),
    },
  };
}

const save = (row: typeof schema.recipes.$inferInsert): boolean =>
  db.insert(schema.recipes).values(row).onConflictDoNothing().run().changes > 0;

export function loadLibrary(catalog: Catalog): { recipe: LibraryRecipe; facts: RecipeFacts }[] {
  const out: { recipe: LibraryRecipe; facts: RecipeFacts }[] = [];
  for (const row of db.select().from(schema.recipes).all()) {
    const facts = row.ingredients.every((ing) => usable(catalog.get(ing.id))) ? computeFacts(row.ingredients, catalog) : null;
    if (facts) out.push({ recipe: { ...row, kind: row.kind as RecipeKind }, facts });
  }
  return out;
}

// ---------- LLM proposals ----------

const Proposal = z.object({
  recipes: z.array(z.object({
    name: z.string(),
    ingredients: z.array(z.object({ id: z.string(), grams: z.number() })),
    steps: z.array(z.string()),
    prepMinutes: z.number().int(),
  })),
});

function ingredientAllowed(entry: CatalogEntry, settings: Settings): boolean {
  return usable(entry) && DIET_RANK[entry.diet] <= DIET_LIMIT[settings.diet] && (!settings.lactoseFree || entry.lactoseFree)
    && (!settings.glutenFree || entry.glutenFree) && !settings.allergens.some((a) => entry.allergens.includes(a));
}

async function generateWithLlm(kind: RecipeKind, count: number, settings: Settings, catalog: Catalog): Promise<number> {
  const offer = [...catalog.values()].filter((e) => ingredientAllowed(e, settings))
    .sort((a, b) => Number(b.hasDeal) - Number(a.hasDeal) || (a.unitPrice as number) - (b.unitPrice as number)).slice(0, 150);
  const constraints = { kind, diet: settings.diet, lf: settings.lactoseFree, gf: settings.glutenFree, allergens: [...settings.allergens].sort(), maxPrep: settings.maxPrep };
  const digest = sha(offer.map((e) => `${e.id}:${(e.unitPrice as number).toFixed(1)}:${e.hasDeal}`).join('|'));
  const cacheKey = `recipes:${sha(JSON.stringify(constraints))}:${digest}`;
  if (offer.length < 4 || cacheGet(cacheKey) !== undefined) return 0;

  const [min, max] = KCAL_RANGE[kind];
  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: `Navrhni ${count} rôznych zdravých receptov typu: ${KIND_LABEL[kind]}. Jedna porcia má mať ${min}–${max} kcal, príprava najviac ${settings.maxPrep} minút.
Použi VÝHRADNE suroviny z tohto zoznamu (pole "id" musí byť presne id zo zoznamu), uprednostni tie v akcii a lacné. Množstvá uvádzaj v gramoch na 1 porciu v surovom stave. Kroky píš po slovensky, stručne. Soľ a korenie medzi suroviny nedávaj.

id | názov | cena €/kg | akcia
${offer.map((e) => `${e.id} | ${e.name} | ${(e.unitPrice as number).toFixed(2)} | ${e.hasDeal ? 'áno' : 'nie'}`).join('\n')}`,
  }];

  let saved = 0;
  for (let attempt = 0; attempt < 3 && saved < count; attempt++) {
    const response = await llm().messages.parse({
      model: RECIPE_MODEL,
      max_tokens: 16000,
      system: 'Si skúsený slovenský kuchár a nutričný poradca. Navrhuješ jednoduché, vyvážené a lacné domáce jedlá.',
      messages,
      output_config: { effort: 'medium', format: zodOutputFormat(Proposal) },
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) break;
    const failures: string[] = [];
    for (const proposal of response.parsed_output.recipes) {
      const result = finalize({ ...proposal, kind, source: 'llm' }, catalog);
      const reason = typeof result === 'string' ? result : violation(result.facts, result.row.prepMinutes, settings);
      if (reason) failures.push(`"${proposal.name}": ${reason}`);
      else if (typeof result !== 'string' && save(result.row)) saved++;
    }
    if (!failures.length) break;
    messages.push({ role: 'assistant', content: response.content }, {
      role: 'user',
      content: `Tieto recepty neprešli kontrolou:\n${failures.join('\n')}\nNavrhni ${failures.length} náhradných receptov, ktoré podmienky spĺňajú.`,
    });
  }
  cacheSet(cacheKey, 'recipes', { saved });
  return saved;
}

// ---------- Rule-based combiner (fallback without LLM) ----------

function generateByRules(kind: RecipeKind, catalog: Catalog): number {
  const role = (r: Role) => [...catalog.values()].filter((e) => e.role === r && usable(e)).sort((a, b) => (a.unitPrice as number) - (b.unitPrice as number));
  const pick = (id: string) => (usable(catalog.get(id)) ? (catalog.get(id) as CatalogEntry) : undefined);
  const forKcal = (e: CatalogEntry, kcal: number, lo: number, hi: number) => round5(Math.min(hi, Math.max(lo, (kcal / (e.macros as Macros).kcal) * 100)));
  const at = <T,>(list: T[], index: number): T | undefined => (list.length ? list[index % list.length] : undefined);
  const vegs = role('veg'), fruits = role('fruit'), breads = role('bread'), nuts = role('nuts'), dairies = role('dairy');
  const oil = pick('olej') ?? pick('olivovy-olej') ?? role('fat')[0];
  let saved = 0;
  const add = (name: string, prepMinutes: number, parts: [CatalogEntry | undefined, number][], steps: string[]) => {
    const ingredients = parts.filter((p): p is [CatalogEntry, number] => Boolean(p[0])).map(([e, grams]) => ({ id: e.id, grams }));
    const result = finalize({ name, kind, ingredients, steps, prepMinutes, source: 'rule' }, catalog);
    if (typeof result !== 'string' && save(result.row)) saved++;
  };

  if (kind === 'main') {
    const proteins = [...role('protein'), ...role('legume'), ...role('egg')];
    const carbs = role('carb');
    const onion = pick('cibula'), tomato = pick('paradajky-krajane');
    const methods = [
      { label: 'na panvici', minutes: 25, sauce: false, verb: 'opečte na panvici na oleji s cibuľou dozlatista' },
      { label: 'z rúry', minutes: 40, sauce: false, verb: 'pečte v rúre pri 200 °C približne 25 minút' },
      { label: 'na paradajkách', minutes: 35, sauce: true, verb: 'opečte na cibuľke, zalejte paradajkami a 15 minút poduste' },
    ];
    proteins.forEach((protein, pi) => {
      methods.forEach((method, k) => {
        const carb = at(carbs, pi + k), veg = at(vegs, pi * 2 + k);
        if (!carb || !veg || (method.sauce && !tomato) || (protein.role === 'egg' && k > 0)) return;
        const m = protein.macros as Macros;
        const grams = round5(Math.min(250, Math.max(80, 3000 / Math.max(m.protein, 1)), 33000 / Math.max(m.kcal, 1)));
        add(`${protein.name} ${method.label} – ${carb.name} a ${veg.name}`, protein.role === 'legume' && m.kcal > 250 ? method.minutes + 15 : method.minutes, [
          [protein, grams], [carb, forKcal(carb, protein.role === 'legume' ? 180 : 260, 40, 350)], [veg, 200], [oil, 10], [onion, 50],
          [method.sauce ? tomato : undefined, 150],
        ], [
          `${cap(carb.name)} uvarte alebo pripravte podľa návodu na obale.`,
          `${cap(protein.name)} pripravte (strukoviny vopred uvarte domäkka), osoľte, okoreňte a ${method.verb}.`,
          `Pridajte ${veg.name}, krátko prehrejte, dochuťte a podávajte s prílohou.`,
        ]);
      });
    });
  }

  if (kind === 'breakfast') {
    const cereal = pick('ovsene-vlocky') ?? role('cereal')[0];
    const egg = role('egg')[0], sweet = role('sweet')[0];
    const butter = pick('maslo') ?? oil;
    role('milk').forEach((milk, mi) => fruits.slice(0, 3).forEach((fruit, fi) => {
      if (cereal) add(`Ovsená kaša – ${milk.name} a ${fruit.name}`, 10, [[cereal, 60], [milk, 250], [fruit, 120], [at(nuts, mi + fi), 15]], [
        `Vločky zalejte tekutinou (${milk.name}) a varte 3–5 minút do zhustnutia.`, `Pridajte ${fruit.name} a posypte orechmi.`,
      ]);
    }));
    dairies.forEach((dairy) => fruits.slice(0, 3).forEach((fruit) => {
      add(`${dairy.name} s ovocím a vločkami – ${fruit.name}`, 5, [[dairy, 200], [fruit, 120], [cereal, 30], [sweet, 10]], [
        `Do misky dajte ${dairy.name}, pridajte nakrájané ovocie (${fruit.name}) a vločky.`, 'Podľa chuti osladte medom.',
      ]);
    }));
    breads.forEach((bread) => vegs.slice(0, 3).forEach((veg, vi) => {
      if (egg) add(`Praženica s chlebom – ${veg.name}`, 10, [[bread, 100], [egg, 120], [veg, 100], [butter, 8]], [
        'Vajcia rozšľahajte, osoľte a na tuku pomaly miešajte do zhustnutia.', `Podávajte s chlebom a čerstvou zeleninou (${veg.name}).`,
      ]);
      const topping = at(role('topping'), vi);
      if (topping) add(`Obložený chlieb – ${topping.name} a ${veg.name}`, 5, [[bread, 100], [topping, 60], [veg, 100], [butter, 8]], [
        'Chlieb natrite tenkou vrstvou tuku.', `Obložte: ${topping.name} a ${veg.name}.`,
      ]);
    }));
  }

  if (kind === 'snack') {
    fruits.forEach((fruit, fi) => {
      const nut = at(nuts, fi), dairy = at(dairies, fi), spread = role('spread')[0], bread = breads[0];
      if (nut) add(`${fruit.name} a ${nut.name}`, 3, [[fruit, 150], [nut, 25]], [`Ovocie umyte a podávajte s orechmi (${nut.name}).`]);
      if (dairy) add(`${dairy.name} – ${fruit.name}`, 3, [[dairy, 150], [fruit, 100]], [`${cap(dairy.name)} zmiešajte s nakrájaným ovocím (${fruit.name}).`]);
      if (spread && bread) add(`Chlieb, ${spread.name} a ${fruit.name}`, 5, [[bread, 60], [spread, 20], [fruit, 100]], [`Chlieb natrite (${spread.name}) a obložte plátkami ovocia.`]);
    });
    vegs.slice(0, 3).forEach((veg) => {
      const dip = pick('cottage') ?? dairies[0];
      if (dip) add(`${veg.name} s dipom – ${dip.name}`, 5, [[veg, 150], [dip, 120]], [`Zeleninu nakrájajte na hranolčeky a podávajte s dipom (${dip.name}).`]);
    });
  }
  return saved;
}

/** Library first; new recipes are generated only to fill gaps for the current constraints. */
export async function ensureLibrary(settings: Settings, catalog: Catalog): Promise<string[]> {
  const notes: string[] = [];
  const kinds = new Set<RecipeKind>(settings.meals.map((m) => (m === 'lunch' || m === 'dinner' ? 'main' : m)));
  const eligible = (kind: RecipeKind) => loadLibrary(catalog)
    .filter(({ recipe, facts }) => recipe.kind === kind && recipe.feedback >= 0 && !violation(facts, recipe.prepMinutes, settings)).length;
  for (const kind of kinds) {
    const missing = MIN_LIBRARY[kind] - eligible(kind);
    if (missing <= 0) continue;
    if (hasLlm()) {
      try {
        await generateWithLlm(kind, missing + 2, settings, catalog);
      } catch (error) {
        notes.push(`Generovanie receptov cez AI zlyhalo (${error instanceof Error ? error.message : String(error)}), použitý bol pravidlový generátor.`);
      }
    }
    if (eligible(kind) < MIN_LIBRARY[kind]) generateByRules(kind, catalog);
  }
  if (!hasLlm()) notes.push('Recepty zostavuje pravidlový generátor – pre AI recepty nastavte ANTHROPIC_API_KEY.');
  return notes;
}
