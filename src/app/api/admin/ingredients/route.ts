import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(db.select().from(schema.ingredients).orderBy(schema.ingredients.category, schema.ingredients.name).all());
}

/** Manual nutrition override and baseline price book edits. */
export async function PUT(request: Request): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;
  const current = typeof body.id === 'string' ? db.select().from(schema.ingredients).where(eq(schema.ingredients.id, body.id)).get() : undefined;
  if (!current) return Response.json({ error: 'Surovina neexistuje.' }, { status: 404 });
  const value = (key: string): number | null => {
    const n = Number(body[key]);
    return body[key] === '' || body[key] === null || !Number.isFinite(n) || n < 0 ? null : n;
  };
  const macros = { kcal: value('kcal'), protein: value('protein'), carbs: value('carbs'), fat: value('fat') };
  const changed = (Object.keys(macros) as (keyof typeof macros)[]).some((k) => macros[k] !== current[k]);
  db.update(schema.ingredients).set({
    ...macros,
    nutritionSource: changed ? 'manual' : current.nutritionSource,
    baselinePrice: value('baselinePrice'),
    baselinePack: value('baselinePack') || current.baselinePack,
  }).where(eq(schema.ingredients.id, current.id)).run();
  return Response.json({ ok: true });
}
