import { sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { upsertProducts, type RawProduct } from './ingest';
import type { Store } from './types';

type Row = [name: string, pack: string, price: number, deal?: number];

const KAUFLAND: Row[] = [
  ['Kuracie prsia chladené', '500 g', 4.49, 3.49], ['Mleté mäso bravčové', '500 g', 3.69], ['Vajcia M', '10 ks', 2.39, 1.89],
  ['Mlieko polotučné 1,5 %', '1 l', 0.99, 0.79], ['Biely jogurt smotanový', '400 g', 1.09], ['Tvaroh mäkký', '250 g', 1.29, 0.99],
  ['Ryža guľatozrnná', '1 kg', 1.79], ['Cestoviny penne', '500 g', 0.99, 0.69], ['Zemiaky konzumné', '2 kg', 1.99],
  ['Ovsené vločky jemné', '500 g', 0.89], ['Brokolica', '500 g', 1.49, 0.99], ['Paradajky cherry', '500 g', 1.99],
  ['Banány', 'cena za 1 kg', 1.49, 1.19], ['Chlieb konzumný krájaný', '500 g', 1.29], ['Šošovica červená', '500 g', 1.89],
];
const LIDL: Row[] = [
  ['Kuracie stehná horné', '1 kg', 4.29, 3.29], ['Losos filet s kožou', '250 g', 5.49, 4.49], ['Tuniak vo vlastnej šťave', '160 g', 1.69],
  ['Eidam 30 % plátky', '250 g', 2.19, 1.79], ['Cottage cheese', '180 g', 1.19], ['Maslo 82 %', '250 g', 2.49, 1.99],
  ['Ryža basmati', '1 kg', 2.79], ['Jablká červené', 'cena za 1 kg', 1.39, 0.99], ['Mrkva', '1 kg', 0.89],
  ['Paprika červená', '500 g', 1.79, 1.29], ['Cibuľa žltá', '1 kg', 0.89], ['Paradajky krájané v šťave', '400 g', 0.79],
  ['Vlašské orechy', '200 g', 2.99], ['Slnečnicový olej', '1 l', 1.99], ['Fazuľa červená konzervovaná', '400 g', 0.89],
];

/** 30-item smoke-test fallback. Does nothing once the database holds any products (live data wins). */
export function seedProducts(): number {
  const existing = db.select({ count: sql<number>`count(*)` }).from(schema.products).get()?.count ?? 0;
  if (existing > 0) return 0;
  const now = new Date();
  const validTo = new Date(now.getTime() + 7 * 86400000).toISOString();
  const rows = (store: Store, url: string, list: Row[]): RawProduct[] =>
    list.map(([name, packText, price, dealPrice]) => ({ store, name, packText, price, dealPrice, validTo, category: 'Ukážkové dáta', sourceUrl: url }));
  const result = upsertProducts([...rows('kaufland', 'https://www.kaufland.sk', KAUFLAND), ...rows('lidl', 'https://www.lidl.sk', LIDL)], now.toISOString());
  for (const store of ['kaufland', 'lidl'] as const) {
    db.insert(schema.refreshLog).values({
      store, startedAt: now.toISOString(), finishedAt: now.toISOString(), status: 'seed', itemCount: 15, newCount: 15,
      message: 'Ukážkové dáta (seed) – spustite aktualizáciu pre reálne ceny',
    }).run();
  }
  return result.total;
}
