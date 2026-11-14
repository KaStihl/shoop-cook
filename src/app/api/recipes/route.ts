import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { loadCatalog } from '@/lib/catalog';
import { fetchRecipe } from '@/lib/crawlers/webrecipes';
import { importExternal, loadLibrary, saveOwnRecipe, type OwnRecipeInput } from '@/lib/recipes';
import { toListItems } from '@/lib/recipe-core';
import { STORES, type RecipeKind } from '@/lib/types';

export const dynamic = 'force-dynamic';

const KINDS: RecipeKind[] = ['breakfast', 'main', 'snack'];
const fail = (message: string): Response => Response.json({ error: message }, { status: 400 });

/** The whole recipe library with macros and today's cost per portion, recomputed from the database. */
export function GET(): Response {
  const catalog = loadCatalog(STORES);
  return Response.json(toListItems(loadLibrary(catalog), catalog));
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
      if (result !== 'saved' && result !== 'duplicate') return fail(`Recept sa nedá použiť: ${result}.`);
      // A recipe imported earlier is returned as it is, so the plan can use it straight away.
      const row = db.select({ id: schema.recipes.id, steps: schema.recipes.steps }).from(schema.recipes).all().find((r) => r.steps[r.steps.length - 1] === recipe.url);
      return Response.json({ id: row?.id, name: recipe.name, recognised: recipe.ingredients.length, total: recipe.total });
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
