import * as cheerio from 'cheerio';
import type { Catalog } from '../catalog';
import { parseIngredientLines } from '../ingredients';
import type { ExternalRecipe } from '../recipes';
import { Fetcher } from './http';

interface LdRecipe {
  '@type'?: string | string[];
  '@graph'?: LdRecipe[];
  name?: string;
  recipeIngredient?: string[];
  totalTime?: string;
  cookTime?: string;
  recipeYield?: string | number | (string | number)[];
  nutrition?: { calories?: string | number };
}

function findRecipe(node: unknown): LdRecipe | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findRecipe(item);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  const data = node as LdRecipe;
  if ([data['@type']].flat().includes('Recipe')) return data;
  return data['@graph'] ? findRecipe(data['@graph']) : null;
}

/** Reads a schema.org Recipe (JSON-LD) from any recipe page; only ingredients and metadata are kept, never the method text. */
export function parseRecipePage(html: string, url: string, catalog: Catalog): ExternalRecipe | string {
  const $ = cheerio.load(html);
  let ld: LdRecipe | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      ld ??= findRecipe(JSON.parse($(el).text()));
    } catch {
      // Unrelated or malformed JSON-LD blocks are ignored.
    }
  });
  const recipe = ld as LdRecipe | null;
  if (!recipe?.recipeIngredient?.length) return 'stránka neobsahuje štruktúrovaný recept (schema.org Recipe)';
  const text = $('main').text() || $('body').text();
  const name = (recipe.name || /Recept (.{3,90}?) bol vytvoren/.exec(text)?.[1] || $('.prose h2').first().text().split(' – ')[0] || $('h1').first().text())
    .trim().replace(/^na\s+/i, '');
  if (!name) return 'chýba názov receptu';
  const portions = Math.max(1, parseInt(String([recipe.recipeYield].flat()[0] ?? ''), 10) || 4);
  const lines = recipe.recipeIngredient;
  const { mapped, unmatched } = parseIngredientLines(lines, portions, catalog);
  const roles = new Set(mapped.map((m) => catalog.get(m.id)?.role as string));
  if (mapped.length < 3 || !['protein', 'legume', 'egg', 'carb', 'dairy', 'cereal', 'bread', 'milk'].some((r) => roles.has(r)) || mapped.length < lines.length * 0.4) {
    return `rozpoznané len ${mapped.length} z ${lines.length} surovín`;
  }
  const minutes = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(recipe.totalTime ?? recipe.cookTime ?? '');
  const kcal = parseFloat(String(recipe.nutrition?.calories ?? '')) / (new URL(url).hostname.endsWith('yummybox.sk') ? portions : 1);
  return {
    name, url, ingredients: mapped, unmatched, total: lines.length,
    prepMinutes: minutes ? Number(minutes[1] ?? 0) * 60 + Number(minutes[2] ?? 0) || 30 : 30,
    kcal: Number.isFinite(kcal) && kcal > 0 ? kcal : undefined,
  };
}

/** Fetches one recipe page the user pointed at (robots.txt of that site is respected). */
export async function fetchRecipe(rawUrl: string, catalog: Catalog): Promise<ExternalRecipe> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || /^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/.test(url.hostname)) throw new Error('Zadajte verejnú adresu receptu začínajúcu https://');
  const result = parseRecipePage(await new Fetcher(url.origin).get(url.toString()), url.toString(), catalog);
  if (typeof result === 'string') throw new Error(`Recept sa nepodarilo načítať: ${result}.`);
  return result;
}

/** Reads recipe pages listed in the yummybox.sk sitemap (robots.txt respected, rate-limited). */
export async function crawlYummybox(catalog: Catalog, limit: number, skip: Set<string>, log: (line: string) => void): Promise<ExternalRecipe[]> {
  const http = new Fetcher('https://yummybox.sk');
  const sitemap = await http.get('/sitemap.xml');
  const urls = [...new Set([...sitemap.matchAll(/<loc>(https:\/\/yummybox\.sk\/recepty\/[^<\/]+)<\/loc>/g)].map((m) => m[1]))].filter((u) => !skip.has(u));
  log(`yummybox: ${urls.length} nových receptov v sitemap, čítam najviac ${limit}`);
  const out: ExternalRecipe[] = [];
  for (const url of urls.slice(0, limit)) {
    try {
      const result = parseRecipePage(await http.get(url), url, catalog);
      if (typeof result === 'string') log(`yummybox ${url.split('/').pop()}: preskočené (${result})`);
      else out.push(result);
    } catch (error) {
      log(`yummybox ${url.split('/').pop()}: chyba (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return out;
}
