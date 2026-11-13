import * as cheerio from 'cheerio';
import { mapByRules, type Role } from '../canonical';
import type { Catalog } from '../catalog';
import type { ExternalRecipe } from '../recipes';
import { norm } from '../text';
import { Fetcher } from './http';

const ORIGIN = 'https://yummybox.sk';

/** Grams per portion assumed when the source gives only "1 balenie" or a piece count (meal-kit recipes carry no weights). */
const PORTION: Record<Role, number> = {
  protein: 130, legume: 100, egg: 60, dairy: 50, milk: 100, topping: 30, spread: 15, carb: 75, bread: 80, cereal: 50,
  veg: 80, fruit: 80, fat: 8, nuts: 15, sweet: 5, sauce: 40, aromatic: 15, staple: 0,
};
const UNIT_GRAMS: [RegExp, number][] = [[/^strucik/, 4], [/^lyzick/, 5], [/^lyzic/, 15], [/^dl$/, 100], [/^ml$/, 1], [/^l$/, 1000], [/^kg$/, 1000], [/^g$/, 1]];
/** Slovak inflected forms the product-name rules do not recognise. */
const ALIASES: [RegExp, string][] = [
  [/kuracich prs|kuracie prsia|kuracieho mas/, 'kuracie prsia'], [/kuracich stehien|kuracie stehn/, 'kuracie stehná'],
  [/mlet\w+ hovadz|hovadzie\w* mlet/, 'mleté hovädzie mäso'], [/mlet\w+ bravcov|mlet\w+ mas/, 'mleté mäso'],
  [/bravcov/, 'bravčové karé'], [/hovadz/, 'hovädzie mäso'], [/moracich|moracie/, 'morčacie prsia'], [/losos/, 'losos filet'],
  [/ryze|ryza/, 'ryža'], [/cestovin|penne|fusilli|spagiet|tagliatel|nudl/, 'cestoviny'], [/zemiak/, 'zemiaky'], [/kuskus/, 'kuskus'],
  [/tortill|wrap/, 'tortilla'], [/cibul/, 'cibuľa'], [/cesnak/, 'cesnak'], [/mrkv/, 'mrkva'], [/paprik[ay]$|paprika |paprik /, 'paprika'],
  [/paradajok|paradajk/, 'paradajky'], [/brokolic/, 'brokolica'], [/cuket/, 'cuketa'], [/uhork/, 'uhorka'], [/spenat/, 'špenát'],
  [/sampinon|hub/, 'šampiňóny'], [/kapust/, 'kapusta biela'], [/karfiol/, 'karfiol'], [/hrasok|hrask/, 'hrášok mrazený'], [/kukuric(?!n)/, 'kukurica sladká'],
  [/fazul/, 'fazuľa konzerva'], [/cicer/, 'cícer'], [/sosovic/, 'šošovica'], [/tofu/, 'tofu'], [/vajc|vajec/, 'vajcia'],
  [/smotan/, 'smotana na varenie'], [/jogurt/, 'jogurt biely'], [/mozzarell/, 'mozzarella'], [/syr/, 'syr eidam'], [/masl/, 'maslo'],
  [/mliek/, 'mlieko polotučné'], [/olej/, 'olej repkový'], [/citron/, 'citrón'], [/arasid|orech|kesu|mandl/, 'arašidy'],
];

/** Seasonings, stocks and sauces whose names contain a staple word ("kokosové mlieko", "kurací vývar", "jablčný ocot"). */
const NOT_INGREDIENT = /ocot|octu|vyvar|bujon|kokos|omack|past[ayu]|koren|skrob|prasok|sirup|stav[ayu]|rastlinn|vegansk|uden|fond|dzus|pyre|majonez|dresing/;

function canonical(name: string): string | null {
  const n = norm(name);
  const noodles = /rezanc|nudl|gnocchi|orzo/.test(n);
  if (NOT_INGREDIENT.test(n) && !noodles) return null;
  if (noodles) return mapByRules('cestoviny');
  const direct = mapByRules(name);
  if (direct) return direct;
  for (const [pattern, alias] of ALIASES) if (pattern.test(n)) return mapByRules(alias);
  return null;
}

/** "1 balenie kuracích pŕs" → grams of a canonical ingredient per portion (estimated where the source has no weight). */
function parseIngredient(line: string, portions: number, catalog: Catalog): { id: string; grams: number } | null {
  const match = /^\s*([\d.,]+)?(?:\s*-\s*[\d.,]+)?\s*(.*)$/.exec(line);
  if (!match) return null;
  const quantity = match[1] ? Number(match[1].replace(',', '.')) || 1 : 1;
  const [first, ...rest] = match[2].trim().split(/\s+/);
  const unit = UNIT_GRAMS.find(([pattern]) => pattern.test(norm(first ?? '')));
  const name = unit || /^(balen|strucik|kusok|ks$|stipk|hrst|zvazok|plechovk)/.test(norm(first ?? '')) ? rest.join(' ') : match[2];
  if (!name || /^vod[ayu]$/.test(norm(name))) return null;
  const id = canonical(name);
  const entry = id ? catalog.get(id) : undefined;
  if (!entry?.macros || !entry.offers.length || entry.role === 'staple') return null;
  const grams = unit ? (quantity * unit[1]) / portions : PORTION[entry.role];
  return { id: entry.id, grams: Math.max(2, Math.round(grams)) };
}

interface LdRecipe {
  '@type'?: string;
  recipeIngredient?: string[];
  totalTime?: string;
  recipeYield?: string;
  nutrition?: { calories?: string };
}

function parseRecipe(html: string, url: string, catalog: Catalog): ExternalRecipe | string {
  const $ = cheerio.load(html);
  let ld: LdRecipe | undefined;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text()) as LdRecipe;
      if (data['@type'] === 'Recipe') ld = data;
    } catch {
      // Unrelated or malformed JSON-LD blocks are ignored.
    }
  });
  if (!ld?.recipeIngredient?.length) return 'stránka neobsahuje štruktúrovaný recept';
  const text = $('main').text() || $('body').text();
  const name = (/Recept (.{3,90}?) bol vytvoren/.exec(text)?.[1] ?? $('.prose h2').first().text().split(' – ')[0]).trim().replace(/^na\s+/i, '');
  if (!name) return 'chýba názov receptu';
  const portions = Math.max(1, parseInt(ld.recipeYield ?? '', 10) || 4);
  const lines = ld.recipeIngredient;
  const mapped = lines.map((line) => parseIngredient(line, portions, catalog)).filter((x): x is { id: string; grams: number } => x !== null);
  const roles = new Set(mapped.map((m) => catalog.get(m.id)?.role));
  const substantial = ['protein', 'legume', 'egg', 'carb', 'dairy'].filter((r) => roles.has(r as Role)).length;
  if (new Set(mapped.map((m) => m.id)).size < 3 || substantial < 1 || mapped.length < lines.length * 0.4) return `rozpoznané len ${mapped.length} z ${lines.length} surovín`;
  const minutes = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(ld.totalTime ?? '');
  const kcal = parseFloat(ld.nutrition?.calories ?? '') / portions;
  return {
    name, url, ingredients: mapped,
    prepMinutes: minutes ? Number(minutes[1] ?? 0) * 60 + Number(minutes[2] ?? 0) || 30 : 30,
    kcal: Number.isFinite(kcal) && kcal > 0 ? kcal : undefined,
    recognised: mapped.length, total: lines.length,
  };
}

/** Reads recipe pages listed in the yummybox.sk sitemap (robots.txt respected, rate-limited). */
export async function crawlYummybox(catalog: Catalog, limit: number, skip: Set<string>, log: (line: string) => void): Promise<ExternalRecipe[]> {
  const http = new Fetcher(ORIGIN);
  const sitemap = await http.get('/sitemap.xml');
  const urls = [...new Set([...sitemap.matchAll(/<loc>(https:\/\/yummybox\.sk\/recepty\/[^<\/]+)<\/loc>/g)].map((m) => m[1]))].filter((u) => !skip.has(u));
  log(`yummybox: ${urls.length} nových receptov v sitemap, čítam najviac ${limit}`);
  const out: ExternalRecipe[] = [];
  for (const url of urls.slice(0, limit)) {
    try {
      const result = parseRecipe(await http.get(url), url, catalog);
      if (typeof result === 'string') log(`yummybox ${url.split('/').pop()}: preskočené (${result})`);
      else out.push(result);
    } catch (error) {
      log(`yummybox ${url.split('/').pop()}: chyba (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return out;
}
