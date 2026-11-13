import * as cheerio from 'cheerio';
import type { RawProduct } from '../ingest';
import { Fetcher } from './http';

const ORIGIN = 'https://www.kaufland.sk';
const START = '/aktualna-ponuka/prehlad.html';
const MAX_PAGES = 80;

const money = (text: string): number => Number(text.replace(/[^\d,.]/g, '').replace(',', '.'));

function isoDate(day: string, month: string): string {
  const now = new Date();
  const year = now.getMonth() === 11 && Number(month) === 1 ? now.getFullYear() + 1 : now.getFullYear();
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parsePage(html: string, pageUrl: string): { products: RawProduct[]; links: string[] } {
  const $ = cheerio.load(html);
  const validity = $('body').text().match(/od\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(?:\d{4})?\s*do\s+(\d{1,2})\.\s*(\d{1,2})\./i);
  const validFrom = validity ? isoDate(validity[1], validity[2]) : null;
  const validTo = validity ? isoDate(validity[3], validity[4]) : null;
  const products: RawProduct[] = [];

  $('.k-product-tile, [data-t-name="OfferTile"], .m-offer-tile').each((_, el) => {
    const tile = $(el);
    const pick = (selector: string) => tile.find(selector).first().text().replace(/\s+/g, ' ').trim();
    const title = pick('.k-product-tile__title, .m-offer-tile__title');
    const subtitle = pick('.k-product-tile__subtitle, .m-offer-tile__subtitle');
    const current = money(pick('.k-price-tag__price, .a-pricetag__price'));
    const old = money(pick('.k-price-tag__old-price, .a-pricetag__old-price'));
    if (!(title || subtitle) || !current) return;
    const href = tile.is('a') ? tile.attr('href') : tile.find('a').first().attr('href');
    products.push({
      store: 'kaufland',
      name: [title, subtitle].filter(Boolean).join(' '),
      brand: title && subtitle ? title : null,
      packText: pick('.k-product-tile__unit-price, .m-offer-tile__quantity') || pick('.k-product-tile__base-price, .m-offer-tile__basic-price') || null,
      price: old > current ? old : current,
      dealPrice: old > current ? current : null,
      validFrom,
      validTo,
      category: $('h1').first().text().trim() || null,
      image: tile.find('img').first().attr('src') ?? tile.find('img').first().attr('data-src') ?? null,
      sourceUrl: href ? new URL(href, ORIGIN).toString() : pageUrl,
    });
  });

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const nodes = [JSON.parse($(el).text())].flat() as { '@type'?: string; name?: string; gtin13?: string; image?: string; brand?: { name?: string }; offers?: { price?: string | number; priceValidUntil?: string } }[];
      for (const node of nodes) {
        const price = Number(node.offers?.price);
        if (node['@type'] !== 'Product' || !node.name || !price) continue;
        products.push({
          store: 'kaufland', name: node.name, brand: node.brand?.name ?? null, ean: node.gtin13 ?? null, price,
          validTo: node.offers?.priceValidUntil ?? validTo, validFrom, image: node.image ?? null, sourceUrl: pageUrl,
        });
      }
    } catch {
      // Non-product structured data is ignored.
    }
  });

  const links = new Set<string>();
  $('a[href*="/aktualna-ponuka/"], a[href*="/sortiment/"]').each((_, el) => {
    const url = new URL($(el).attr('href') ?? '', ORIGIN);
    if (url.origin === ORIGIN && url.pathname.endsWith('.html')) links.add(url.pathname + url.search);
  });
  return { products, links: [...links] };
}

/**
 * Crawls the weekly offer ("aktuálna ponuka") and assortment pages. kaufland.sk currently answers automated
 * clients with a bot challenge; in that case the Fetcher raises BlockedError and nothing is bypassed.
 */
export async function crawlKaufland(log: (line: string) => void): Promise<RawProduct[]> {
  const http = new Fetcher(ORIGIN);
  const products: RawProduct[] = [];
  const queue = [START];
  const visited = new Set<string>();
  while (queue.length && visited.size < MAX_PAGES) {
    const path = queue.shift() as string;
    if (visited.has(path)) continue;
    visited.add(path);
    try {
      let page = parsePage(await http.get(path), ORIGIN + path);
      if (!page.products.length) {
        const rendered = await http.render(path);
        if (rendered) page = parsePage(rendered, ORIGIN + path);
      }
      products.push(...page.products);
      queue.push(...page.links.filter((link) => !visited.has(link)));
      log(`kaufland ${path}: ${page.products.length} položiek`);
    } catch (error) {
      if (path === START) throw error;
      log(`kaufland ${path}: preskočené (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return products;
}
