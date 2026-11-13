import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { classifyUnmapped } from './classify';
import { BlockedError } from './crawlers/http';
import { crawlBilla } from './crawlers/billa';
import { crawlKaufland } from './crawlers/kaufland';
import { crawlLidl } from './crawlers/lidl';
import { upsertProducts, type RawProduct } from './ingest';
import { refreshNutrition } from './nutrition';
import { STORES, type Store } from './types';

interface RefreshState {
  running: boolean;
  startedAt: string | null;
  lines: string[];
}

const holder = globalThis as typeof globalThis & { __jedlokosRefresh?: RefreshState };
export const refreshState: RefreshState = (holder.__jedlokosRefresh ??= { running: false, startedAt: null, lines: [] });

const CRAWLERS: Record<Store, (log: (line: string) => void) => Promise<RawProduct[]>> = {
  kaufland: crawlKaufland, lidl: crawlLidl,
  billa: crawlBilla,
  tesco: async () => { throw new BlockedError('Tesco blokuje automatický prístup (ochrana proti robotom).'); },
};

/** Incremental refresh: crawl each store, upsert, then map unmapped products and refresh nutrition. */
export async function runRefresh(stores: Store[] = STORES, echo: (line: string) => void = () => undefined): Promise<void> {
  if (refreshState.running) return;
  refreshState.running = true;
  refreshState.startedAt = new Date().toISOString();
  refreshState.lines = [];
  const log = (line: string) => {
    refreshState.lines = [...refreshState.lines.slice(-199), `${new Date().toLocaleTimeString('sk-SK')} ${line}`];
    echo(line);
  };
  try {
    for (const store of stores) {
      const startedAt = new Date().toISOString();
      const entry = db.insert(schema.refreshLog).values({ store, startedAt, status: 'running' }).returning({ id: schema.refreshLog.id }).get();
      const finish = (status: string, itemCount: number, newCount: number, message: string) => {
        db.update(schema.refreshLog).set({ status, itemCount, newCount, message, finishedAt: new Date().toISOString() })
          .where(eq(schema.refreshLog.id, entry.id)).run();
        log(`${store}: ${message}`);
      };
      try {
        const result = upsertProducts(await CRAWLERS[store](log), startedAt);
        if (result.total) finish('ok', result.total, result.created, `${result.total} položiek, ${result.created} nových, ${result.changed} zmien ceny`);
        else finish('empty', 0, 0, 'Web nevrátil žiadne produkty; pôvodné dáta zostávajú.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finish(error instanceof BlockedError ? 'blocked' : 'error', 0, 0, error instanceof BlockedError ? `${message} Použite import v /admin.` : message);
      }
    }
    const mapped = await classifyUnmapped(log);
    if (mapped) log(`LLM priradilo surovinu ${mapped} produktom`);
    await refreshNutrition(log);
    log('Aktualizácia dokončená');
  } finally {
    refreshState.running = false;
  }
}
