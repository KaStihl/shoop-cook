import * as cheerio from 'cheerio';
import type { Catalog } from '../catalog';
import { parseIngredientLines } from '../ingredients';
import type { ExternalRecipe } from '../recipes';
import type { RecipeKind } from '../types';
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
      // billa.sk ships the JSON in a `children` attribute instead of the element body.
      ld ??= findRecipe(JSON.parse($(el).text() || $(el).attr('children') || ''));
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
  const declared = Math.max(1, parseInt(String([recipe.recipeYield].flat()[0] ?? ''), 10) || 4);
  const lines = recipe.recipeIngredient;
  // Some sites publish "1" as the yield of a family-size dish; amounts that large for one portion mean four portions.
  const whole = parseIngredientLines(lines, declared, catalog);
  const portions = declared === 1 && whole.mapped.some((m) => m.grams > 350) ? 4 : declared;
  const { mapped, unmatched } = portions === declared ? whole : parseIngredientLines(lines, portions, catalog);
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

export interface RecipeBatch {
  kind: RecipeKind;
  recipes: ExternalRecipe[];
}

interface Listing {
  kind: RecipeKind;
  /** Page that lists recipe links; `{page}` is replaced by 0, 1, 2… for paginated listings. */
  path: string;
  link: RegExp;
}

interface RecipeSite {
  origin: string;
  listings: Listing[];
}

export const RECIPE_SITES: Record<string, RecipeSite> = {
  yummybox: { origin: 'https://yummybox.sk', listings: [{ kind: 'main', path: '/sitemap.xml', link: /https:\/\/yummybox\.sk\/recepty\/[^<"\/]+/g }] },
  billa: { origin: 'https://www.billa.sk', listings: [{ kind: 'main', path: '/sitemap.xml', link: /https:\/\/www\.billa\.sk\/recepty\/[^<"\/]+/g }] },
  varecha: {
    origin: 'https://varecha.pravda.sk',
    listings: [
      { kind: 'main', path: '/recepty/chody/hlavne-jedla/{page}', link: /\/recepty\/[^"\/]+\/\d+-recept\.html/g },
      { kind: 'main', path: '/recepty/chody/polievky/{page}', link: /\/recepty\/[^"\/]+\/\d+-recept\.html/g },
      { kind: 'breakfast', path: '/recepty/chody/ranajky/{page}', link: /\/recepty\/[^"\/]+\/\d+-recept\.html/g },
    ],
  },
};

/** Collects recipe links from a site's sitemap or listing pages and reads up to `limit` new recipes (robots.txt respected, rate-limited). */
export async function crawlRecipeSite(name: string, catalog: Catalog, limit: number, skip: Set<string>, log: (line: string) => void): Promise<RecipeBatch[]> {
  const site = RECIPE_SITES[name];
  if (!site) throw new Error(`Neznámy zdroj receptov: ${name}`);
  const http = new Fetcher(site.origin);
  const share = Math.ceil(limit / site.listings.length);
  const out: RecipeBatch[] = [];
  for (const listing of site.listings) {
    const urls = new Set<string>();
    const pages = listing.path.includes('{page}') ? Math.ceil(share / 20) + 1 : 1;
    for (let page = 0; page < pages && urls.size < share * 3; page++) {
      const html = await http.get(listing.path.replace('{page}', String(page)));
      for (const match of html.match(listing.link) ?? []) {
        const url = new URL(match, site.origin).toString();
        if (!skip.has(url)) urls.add(url);
      }
    }
    log(`${name} ${listing.path}: ${urls.size} nových odkazov, čítam najviac ${share}`);
    const batch: RecipeBatch = { kind: listing.kind, recipes: [] };
    for (const url of [...urls].slice(0, share)) {
      try {
        const result = parseRecipePage(await http.get(url), url, catalog);
        if (typeof result === 'string') log(`${name} ${url.split('/').slice(-2).join('/')}: preskočené (${result})`);
        else batch.recipes.push(result);
      } catch (error) {
        log(`${name} ${url}: chyba (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    out.push(batch);
  }
  return out;
}
