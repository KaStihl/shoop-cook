import type { RawProduct } from '../ingest';
import { Fetcher } from './http';

const ORIGIN = 'https://www.billa.sk';
const PAGE_SIZE = 100;
const MAX_PAGES = 80;

interface BillaPriceTier {
  value?: number;
  promotionText?: string;
  tags?: string[];
}

interface BillaProduct {
  name?: string;
  slug?: string;
  amount?: string;
  volumeLabelShort?: string;
  images?: string[];
  parentCategories?: { name: string }[][];
  /** Amounts are in euro cents. `crossed` is the regular price when `regular` carries a promotion. */
  price?: { crossed?: number; regular?: BillaPriceTier; standard?: BillaPriceTier };
}

/** Monday and Sunday (ISO dates) of an ISO week. */
function weekRange(week: number, year: number): [string, string] {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4.getTime() + ((week - 1) * 7 - ((jan4.getUTCDay() + 6) % 7)) * 86400000);
  return [monday.toISOString().slice(0, 10), new Date(monday.getTime() + 6 * 86400000).toISOString().slice(0, 10)];
}

/** Leaflet weeks ("KW 46/2026") a product is listed in, as one validity span; null when it is not a leaflet item. */
function leafletSpan(item: BillaProduct): [string, string] | null {
  const ranges = (item.parentCategories ?? []).flat().map((c) => /^KW (\d{1,2})\/(\d{4})$/.exec(c.name))
    .filter((m): m is RegExpExecArray => m !== null).map((m) => weekRange(Number(m[1]), Number(m[2])));
  if (!ranges.length) return null;
  return [ranges.map((r) => r[0]).sort()[0], ranges.map((r) => r[1]).sort().reverse()[0]];
}

function toProduct(item: BillaProduct): RawProduct | null {
  const current = item.price?.regular?.value;
  if (!item.name || !item.slug || typeof current !== 'number') return null;
  // Multi-buy offers ("od 2 ks") are not a price for a single pack, so the single-pack price is used instead.
  const promo = item.price?.regular;
  const multiBuy = Boolean(promo?.tags?.includes('pt-multi') || /od \d+ ks/.test(promo?.promotionText ?? ''));
  const regular = item.price?.crossed ?? item.price?.standard?.value;
  const isDeal = !multiBuy && typeof regular === 'number' && regular > current;
  const shelf = multiBuy ? (item.price?.standard?.value ?? regular ?? current) : isDeal ? (regular as number) : current;
  // Leaflet prices apply only in the leaflet's weeks (approximated as Monday to Sunday).
  const span = isDeal ? leafletSpan(item) : null;
  const category = item.parentCategories?.find((path) => path[0] && path[0].name !== 'LEAFLET')?.[0]?.name ?? null;
  return {
    store: 'billa',
    name: item.name.replace(/\s+/g, ' ').trim(),
    packText: item.amount && item.volumeLabelShort ? `${item.amount} ${item.volumeLabelShort}` : null,
    price: shelf / 100,
    dealPrice: isDeal ? current / 100 : null,
    validFrom: span?.[0] ?? null,
    validTo: span?.[1] ?? null,
    category,
    image: item.images?.[0] ?? null,
    sourceUrl: `${ORIGIN}/produkt/${item.slug}`,
  };
}

/** Reads the whole assortment from billa.sk's product listing API (allowed by robots.txt, rate-limited). */
export async function crawlBilla(log: (line: string) => void): Promise<RawProduct[]> {
  const http = new Fetcher(ORIGIN);
  const products: RawProduct[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = JSON.parse(await http.get(`/api/product-discovery/products?page=${page}&pageSize=${PAGE_SIZE}`)) as { total?: number; results?: BillaProduct[] };
    const batch = (body.results ?? []).map(toProduct).filter((p): p is RawProduct => p !== null);
    products.push(...batch);
    if (page % 10 === 0) log(`billa strana ${page + 1}: spolu ${products.length} z ${body.total ?? '?'} položiek`);
    if (!body.results?.length || (page + 1) * PAGE_SIZE >= (body.total ?? 0)) break;
  }
  return products;
}
