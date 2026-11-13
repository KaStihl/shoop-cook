import { getFreshness, loadCatalog } from './catalog';
import { planWith } from './planner-core';
import { ensureLibrary, loadLibrary } from './recipes';
import type { Plan, PlanRequest } from './types';

/** Server-side planning: fills gaps in the recipe library first, then plans against the database. */
export async function generatePlan(request: PlanRequest): Promise<Plan> {
  const { settings } = request;
  const notes = settings.meals.length && settings.stores.length ? await ensureLibrary(settings, loadCatalog(settings.stores)) : [];
  return planWith(request, { catalog: loadCatalog, library: loadLibrary, notes, stale: getFreshness().stale });
}
