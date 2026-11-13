import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { cacheGet, cacheSet, db, schema } from '@/db';
import { CLASSIFY_MODEL, hasLlm, llm } from './anthropic';
import { CATEGORIES, DIETS, ROLES, likelyFood } from './canonical';
import { slug } from './text';
import { ALLERGENS } from './types';

const BATCH = 100;

const Output = z.object({
  items: z.array(z.object({
    index: z.number().int(),
    ingredientId: z.string().nullable(),
    newIngredient: z.object({
      name: z.string(),
      category: z.enum(CATEGORIES),
      role: z.enum(ROLES),
      diet: z.enum(DIETS),
      allergens: z.array(z.enum(ALLERGENS)),
      lactoseFree: z.boolean(),
    }).nullable(),
  })),
});

type Verdict = z.infer<typeof Output>['items'][number];
interface Cached { ingredientId: string | null }

const SYSTEM = `Si klasifikátor potravín pre slovenský plánovač jedál. Ku každému produktu z obchodu priraď kanonickú surovinu na varenie.
Pravidlá:
- Ak produkt zodpovedá surovine zo zoznamu, vráť jej id v "ingredientId".
- Ak ide o základnú surovinu na varenie, ktorá v zozname chýba, vyplň "newIngredient" (krátky slovenský názov malými písmenami, napr. "kuracie krídla"); "ingredientId" nechaj null.
- Hotové jedlá, sladkosti, nápoje, alkohol, drogéria a nepotravinový tovar: obe polia null.
- "diet" je najprísnejšia diéta, ktorej surovina vyhovuje (vegan < vegetarian < fish < meat). "lactoseFree" je false len pri mliečnych výrobkoch s laktózou.
Vráť presne jednu položku pre každý index.`;

function applyVerdict(verdict: Verdict, known: Set<string>): string | null {
  if (verdict.ingredientId && known.has(verdict.ingredientId)) return verdict.ingredientId;
  const fresh = verdict.newIngredient;
  if (!fresh) return null;
  const id = slug(fresh.name);
  if (!id) return null;
  if (!known.has(id)) {
    db.insert(schema.ingredients).values({
      id, name: fresh.name.toLowerCase(), category: fresh.category, role: fresh.role, diet: fresh.diet,
      allergens: fresh.allergens, lactoseFree: fresh.lactoseFree, glutenFree: !fresh.allergens.includes('gluten'),
      nutritionSource: 'none', origin: 'llm',
    }).onConflictDoNothing().run();
    known.add(id);
  }
  return id;
}

/** Batched LLM mapping for products the keyword rules could not place. Results are cached by product hash. */
export async function classifyUnmapped(log: (line: string) => void): Promise<number> {
  if (!hasLlm()) {
    log('LLM klasifikácia preskočená (chýba ANTHROPIC_API_KEY)');
    return 0;
  }
  const unmapped = db.select().from(schema.products).where(isNull(schema.products.ingredientId)).all();
  const known = new Set(db.select({ id: schema.ingredients.id }).from(schema.ingredients).all().map((r) => r.id));
  const setMapping = (hash: string, ingredientId: string) =>
    db.update(schema.products).set({ ingredientId, mappingSource: 'llm' })
      .where(and(eq(schema.products.hash, hash), isNull(schema.products.ingredientId))).run();

  const pending = new Map<string, { name: string; brand: string | null; category: string | null }>();
  let mapped = 0;
  for (const product of unmapped) {
    if (!likelyFood(product.category, product.name) || pending.has(product.hash)) continue;
    const cached = cacheGet<Cached>(`classify:${product.hash}`);
    if (cached === undefined) pending.set(product.hash, product);
    else if (cached.ingredientId && known.has(cached.ingredientId)) mapped += setMapping(product.hash, cached.ingredientId).changes;
  }

  const entries = [...pending.entries()];
  for (let start = 0; start < entries.length; start += BATCH) {
    const batch = entries.slice(start, start + BATCH);
    const catalog = db.select({ id: schema.ingredients.id, name: schema.ingredients.name }).from(schema.ingredients).all();
    try {
      const response = await llm().messages.parse({
        model: CLASSIFY_MODEL,
        max_tokens: 16000,
        system: [
          { type: 'text', text: SYSTEM },
          { type: 'text', text: `Kanonické suroviny (id | názov):\n${catalog.map((c) => `${c.id} | ${c.name}`).join('\n')}`, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{
          role: 'user',
          content: batch.map(([, p], index) => `${index}. ${p.name}${p.brand ? ` (${p.brand})` : ''}${p.category ? ` [${p.category}]` : ''}`).join('\n'),
        }],
        output_config: { effort: 'low', format: zodOutputFormat(Output) },
      });
      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        log(`LLM klasifikácia: dávka ${start / BATCH + 1} bez výsledku (${response.stop_reason})`);
        continue;
      }
      for (const verdict of response.parsed_output.items) {
        const entry = batch[verdict.index];
        if (!entry) continue;
        const ingredientId = applyVerdict(verdict, known);
        cacheSet(`classify:${entry[0]}`, 'classify', { ingredientId } satisfies Cached);
        if (ingredientId) mapped += setMapping(entry[0], ingredientId).changes;
      }
      log(`LLM klasifikácia: ${Math.min(start + BATCH, entries.length)}/${entries.length}`);
    } catch (error) {
      log(`LLM klasifikácia zlyhala: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
  }
  return mapped;
}
