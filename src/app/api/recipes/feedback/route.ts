import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';

export const dynamic = 'force-dynamic';

/** Like (1), neutral (0) or ban (-1) a recipe; the planner reads this on the next generation. */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as { id?: number; value?: number };
  if (!Number.isInteger(body.id) || ![1, 0, -1].includes(body.value as number)) {
    return Response.json({ error: 'Neplatná požiadavka.' }, { status: 400 });
  }
  db.update(schema.recipes).set({ feedback: body.value }).where(eq(schema.recipes.id, body.id as number)).run();
  return Response.json({ ok: true });
}
