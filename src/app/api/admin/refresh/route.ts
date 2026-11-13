import { refreshState, runRefresh } from '@/lib/refresh';
import { STORES, type Store } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Starts a background refresh; progress is polled through /api/admin/status. */
export async function POST(request: Request): Promise<Response> {
  if (refreshState.running) return Response.json({ error: 'Aktualizácia už prebieha.' }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { stores?: Store[] };
  const stores = STORES.filter((s) => !body.stores || body.stores.includes(s));
  void runRefresh(stores).catch(() => undefined);
  return Response.json({ started: true }, { status: 202 });
}
