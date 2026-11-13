import * as cheerio from 'cheerio';
import type { RawProduct } from '../ingest';
import { BlockedError, Fetcher } from './http';

const ORIGIN = 'https://www.lidl.sk';
const MAX_PAGES = 120;

interface LidlPrice {
  price?: number;
  oldPrice?: number;
  startDate?: string;
  endDate?: string;
  discount?: { deletedPrice?: number };
  packaging?: { text?: string; amount?: number; unit?: string };
  basePrice?: { text?: string };
}

interface LidlData {
  fullTitle?: string;
  title?: string;
  brand?: { name?: string };
  price?: LidlPrice;
  regionsPrices?: Record<string, { currentPrice?: LidlPrice }>;
  image?: string;
  canonicalUrl?: string;
  canonicalPath?: string;
  category?: string;
  keyfacts?: { analyticsCategory?: string };
}

function toProduct(data: LidlData, pageUrl: string): RawProduct | null {
  const name = data.fullTitle || data.title;
  const regional = data.regionsPrices ? Object.values(data.regionsPrices)[0]?.currentPrice : undefined;
  const price = { ...data.price, ...regional };
  if (!name || typeof price.price !== 'number') return null;
  const old = price.oldPrice ?? price.discount?.deletedPrice;
  const pack = price.packaging;
  const path = data.canonicalUrl || data.canonicalPath;
  const category = (data.keyfacts?.analyticsCategory || data.category || '').split('/')[1];
  return {
    store: 'lidl',
    name,
    brand: data.brand?.name ?? null,
    packText: pack?.text || (pack?.amount && pack.unit ? `${pack.amount} ${pack.unit}` : price.basePrice?.text) || null,
    price: old && old > price.price ? old : price.price,
    dealPrice: old && old > price.price ? price.price : null,
    validFrom: price.startDate ?? null,
    validTo: price.endDate ?? null,
    category: category || (pageUrl.includes('/c/store/') ? 'Ponuka v predajni' : null),
    image: data.image ?? null,
    sourceUrl: path ? ORIGIN + path : pageUrl,
  };
}

function parsePage(html: string, pageUrl: string): { products: RawProduct[]; links: string[] } {
  const $ = cheerio.load(html);
  const products: RawProduct[] = [];
  $('[data-grid-data]').each((_, el) => {
    try {
      const product = toProduct(JSON.parse($(el).attr('data-grid-data') ?? '') as LidlData, pageUrl);
      if (product) products.push(product);
    } catch {
      // Malformed tile payloads are skipped; the rest of the page is still ingested.
    }
  });
  const links = new Set<string>();
  $('a[href^="/c/"]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').split('#')[0].split('?')[0];
    if (/^\/c\/[^.]+\/[as]\d+$/.test(href)) links.add(href);
  });
  return { products, links: [...links] };
}

/** Crawls every offer/category page linked from lidl.sk plus the product search API (as far as robots.txt allows). */
export async function crawlLidl(log: (line: string) => void): Promise<RawProduct[]> {
  const http = new Fetcher(ORIGIN);
  const products: RawProduct[] = [];
  const queue = ['/'];
  const visited = new Set<string>();
  while (queue.length && visited.size < MAX_PAGES) {
    const path = queue.shift() as string;
    if (visited.has(path)) continue;
    visited.add(path);
    try {
      let page = parsePage(await http.get(path), ORIGIN + path);
      if (path.includes('/c/store/')) {
        // Offer pages load most tiles with JavaScript; a rendered copy (when a browser is installed) is more complete.
        const rendered = await http.render(path);
        const full = rendered ? parsePage(rendered, ORIGIN + path) : null;
        if (full && full.products.length > page.products.length) page = full;
      }
      products.push(...page.products);
      // Offer pages first: they carry the weekly grocery deals.
      for (const link of page.links) if (!visited.has(link)) link.includes('/store/') ? queue.unshift(link) : queue.push(link);
      if (page.products.length) log(`lidl ${path}: ${page.products.length} položiek`);
    } catch (error) {
      if (error instanceof BlockedError && path === '/') throw error;
      log(`lidl ${path}: preskočené (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const url = `/q/api/search?assortment=SK&locale=sk_SK&version=v2.0.0&fetchsize=${pageSize}${offset ? `&offset=${offset}` : ''}`;
    if (!(await http.allowed(url))) {
      log('lidl API: ďalšie stránky katalógu zakazuje robots.txt, pokračujem bez nich');
      break;
    }
    const body = JSON.parse(await http.get(url)) as { numFound?: number; items?: { gridbox?: { data?: LidlData } }[] };
    const batch = (body.items ?? []).map((it) => (it.gridbox?.data ? toProduct(it.gridbox.data, ORIGIN) : null)).filter((p): p is RawProduct => p !== null);
    products.push(...batch);
    log(`lidl API offset ${offset}: ${batch.length} položiek`);
    if (!body.items?.length || offset + pageSize >= (body.numFound ?? 0)) break;
  }
  return products;
}
