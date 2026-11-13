import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { loadCatalog } from '@/lib/catalog';
import { fetchRecipe } from '@/lib/crawlers/webrecipes';
import { importExternal, loadLibrary, saveOwnRecipe, type OwnRecipeInput } from '@/lib/recipes';
import { round2 } from '@/lib/text';
import { STORES, type RecipeKind, type RecipeListItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

const KINDS: RecipeKind[] = ['breakfast', 'main', 'snack'];
const fail = (message: string): Response => Response.json({ error: message }, { status: 400 });

/** The whole recipe library with macros and today's cost per portion, recomputed from the database. */
export function GET(): Response {
  const catalog = loadCatalog(STORES);
  const items: RecipeListItem[] = loadLibrary(catalog).map(({ recipe, facts }) => ({
    id: recipe.id, name: recipe.name, kind: recipe.kind, source: recipe.source, tags: recipe.tags, prepMinutes: recipe.prepMinutes, feedback: recipe.feedback,
    kcal: Math.round(facts.kcal), protein: Math.round(facts.protein), carbs: Math.round(facts.carbs), fat: Math.round(facts.fat),
    cost: round2(recipe.ingredients.reduce((acc, ing) => acc + (ing.grams / 1000) * (catalog.get(ing.id)?.unitPrice ?? 0), 0)),
    hasDeal: recipe.ingredients.some((ing) => catalog.get(ing.id)?.hasDeal),
    ingredients: recipe.ingredients.map((ing) => ({ id: ing.id, name: catalog.get(ing.id)?.name ?? ing.id, grams: ing.grams })),
    steps: recipe.steps,
  }));
  return Response.json(items);
}

/** Adds a recipe from a URL or the user's own text, or deletes an imported/own recipe. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { action?: string; url?: string; kind?: RecipeKind; id?: number; recipe?: OwnRecipeInput };
    const kind = KINDS.includes(body.kind as RecipeKind) ? (body.kind as RecipeKind) : 'main';
    const catalog = loadCatalog(STORES);
    if (body.action === 'url') {
      if (!body.url?.trim()) return fail('Zadajte adresu receptu.');
      const recipe = await fetchRecipe(body.url.trim(), catalog);
      const result = importExternal(recipe, catalog, 'web', kind);
      if (result === 'duplicate') return fail('Tento recept už v knižnici máte.');
      if (result !== 'saved') return fail(`Recept sa nedá použiť: ${result}.`);
      return Response.json({ name: recipe.name, recognised: recipe.ingredients.length, total: recipe.total });
    }
    if (body.action === 'own' && body.recipe) {
      const result = saveOwnRecipe({ ...body.recipe, kind }, catalog);
      return result === 'saved' ? Response.json({ name: body.recipe.name }) : fail(result);
    }
    if (body.action === 'delete' && Number.isInteger(body.id)) {
      db.delete(schema.recipes).where(eq(schema.recipes.id, body.id as number)).run();
      return Response.json({ ok: true });
    }
    return fail('Neplatná požiadavka.');
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Recept sa nepodarilo uložiť.');
  }
}
