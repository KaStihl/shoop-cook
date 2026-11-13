import { generatePlan } from '@/lib/planner';
import { sanitizeSettings } from '@/lib/settings';
import type { PlanRequest } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as PlanRequest;
    return Response.json(await generatePlan({ ...body, settings: sanitizeSettings(body.settings) }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Plán sa nepodarilo vytvoriť.' }, { status: 400 });
  }
}
