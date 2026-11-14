import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { cacheGet, cacheSet, db, schema } from '@/db';
import { RECIPE_MODEL, hasLlm, llm } from './anthropic';
import type { Role } from './canonical';
import type { Catalog, CatalogEntry } from './catalog';
import { parseIngredientLines } from './ingredients';
import {
  DIET_LIMIT, DIET_RANK, KCAL_RANGE, cap, computeFacts, extrasNote, libraryFrom, prepareRecipe, round5, usable, violation,
  type Draft, type LibraryRecipe, type OwnRecipeInput, type RecipeFacts, type RecipeIngredient,
} from './recipe-core';

export { computeFacts, violation, type LibraryRecipe, type OwnRecipeInput, type RecipeFacts, type RecipeIngredient } from './recipe-core';
import { sha } from './text';
import { kindOfMeal, type Macros, type RecipeKind, type Settings } from './types';

export interface ExternalRecipe {
  name: string;
  url: string;
  ingredients: RecipeIngredient[];
  /** Original ingredient lines without a canonical counterpart; shown with the recipe, not bought. */
  unmatched: string[];
  prepMinutes: number;
  /** Energy per portion published by the source; used to calibrate the estimated amounts. */
  kcal?: number;
  total: number;
}

const KIND_LABEL: Record<RecipeKind, string> = { breakfast: 'raňajky', main: 'hlavné jedlá (obed/večera)', snack: 'desiaty' };
const MIN_LIBRARY: Record<RecipeKind, number> = { breakfast: 5, main: 8, snack: 4 };

/** Adds the storage fields to a verified recipe. */
function finalize(draft: Draft, catalog: Catalog): { row: typeof schema.recipes.$inferInsert; facts: RecipeFacts } | string {
  const result = prepareRecipe(draft, catalog);
  if (typeof result === 'string') return result;
  const { recipe, facts } = result;
  return { facts, row: { ...recipe, ingredientKey: sha(`${recipe.kind}|${recipe.ingredients.map((x) => x.id).sort().join(',')}`), createdAt: new Date().toISOString() } };
}

const save = (row: typeof schema.recipes.$inferInsert): boolean =>
  db.insert(schema.recipes).values(row).onConflictDoNothing().run().changes > 0;

/** Stores a recipe read from another site: ingredients and a link back, never the original method text. */
export function importExternal(recipe: ExternalRecipe, catalog: Catalog, source: 'yummybox' | 'web' = 'yummybox', kind: RecipeKind = 'main'): 'saved' | 'duplicate' | string {
  let { ingredients } = recipe;
  const facts = computeFacts(ingredients, catalog);
  if (recipe.kcal && facts && facts.kcal > 0) {
    const [min, max] = KCAL_RANGE[kind];
    // Unrecognised ingredients leave an energy gap; closing more than half of it by upscaling would distort the dish.
    const factor = Math.min(1.5, Math.max(0.6, Math.min(max, Math.max(min, recipe.kcal)) / facts.kcal));
    if (facts.kcal * factor < min) return 'príliš málo rozpoznaných surovín';
    ingredients = ingredients.map((ing) => ({ id: ing.id, grams: Math.max(2, Math.round(ing.grams * factor)) }));
  }
  const steps = [
    `Množstvá sú prepočítané na 1 porciu (rozpoznaných ${recipe.ingredients.length} z ${recipe.total} surovín pôvodného receptu).`,
    ...extrasNote(recipe.unmatched), recipe.url,
  ];
  const result = finalize({ name: recipe.name, kind, ingredients, steps, prepMinutes: recipe.prepMinutes, source }, catalog);
  if (typeof result === 'string') return result;
  return save({ ...result.row, ingredientKey: sha(`web|${recipe.url}`) }) ? 'saved' : 'duplicate';
}

/** The user's own recipe: free-text ingredient lines are mapped to canonical ingredients and converted to grams per portion. */
export function saveOwnRecipe(input: OwnRecipeInput, catalog: Catalog): 'saved' | string {
  const name = input.name.trim();
  if (name.length < 3) return 'Zadajte názov receptu.';
  const lines = input.ingredients.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const { mapped, unmatched } = parseIngredientLines(lines, Math.max(1, Math.round(input.portions) || 1), catalog);
  if (mapped.length < 2) return `Rozpoznané sú len ${mapped.length} z ${lines.length} surovín. Uveďte aspoň dve bežné suroviny s množstvom, napr. 500 g kuracie prsia.`;
  const steps = [...input.steps.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), ...extrasNote(unmatched)];
  const result = finalize({ name, kind: input.kind, ingredients: mapped, steps, prepMinutes: input.prepMinutes || 30, source: 'own' }, catalog);
  if (typeof result === 'string') return result;
  return save({ ...result.row, ingredientKey: sha(`own|${name.toLowerCase()}`) }) ? 'saved' : 'Recept s týmto názvom už máte uložený.';
}

export function importedUrls(): Set<string> {
  return new Set(db.select().from(schema.recipes).all().filter((r) => r.source === 'yummybox' || r.source === 'web').map((r) => r.steps[r.steps.length - 1]));
}

export function loadLibrary(catalog: Catalog): { recipe: LibraryRecipe; facts: RecipeFacts }[] {
  return libraryFrom(db.select().from(schema.recipes).all(), catalog);
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
          `${cap(protein.name)}${protein.role === 'legume' ? ' vopred uvarte domäkka,' : ''} osoľte, okoreňte a ${method.verb}.`,
          `Pridajte zeleninu (${veg.name}), krátko prehrejte, dochuťte a podávajte s prílohou.`,
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
  const kinds = new Set<RecipeKind>(settings.meals.map(kindOfMeal));
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
