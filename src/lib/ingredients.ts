import { mapByRules, type Role } from './canonical';
import type { Catalog, CatalogEntry } from './catalog-core';
import { norm } from './strings';

/** Grams per portion assumed when a recipe gives no usable amount ("1 balenie", "podľa chuti"). */
const PORTION: Record<Role, number> = {
  protein: 130, legume: 100, egg: 60, dairy: 50, milk: 100, topping: 30, spread: 15, carb: 75, bread: 80, cereal: 50,
  veg: 80, fruit: 80, fat: 8, nuts: 15, sweet: 5, sauce: 40, aromatic: 15, staple: 0,
};
/** Typical weight of one piece, used for counts such as "2 ks" or "1 paprika". */
const PIECE: Partial<Record<Role, number>> = { egg: 55, veg: 120, fruit: 150, aromatic: 70, bread: 60, protein: 150, dairy: 125, topping: 100 };
const UNITS: [RegExp, number][] = [
  [/^(kg|kilo\w*)$/, 1000], [/^(g|gram\w*)$/, 1], [/^(dkg|dag|deka)$/, 10], [/^(l|liter|litr\w*)$/, 1000], [/^dl$/, 100], [/^cl$/, 10], [/^ml$/, 1],
  [/^(cl|kl|lyzick\w*|kavov\w*)$/, 5], [/^(pl|lyzic\w*|polievkov\w*)$/, 15], [/^(salk\w*|hrncek\w*|hrnek\w*|pohar\w*)$/, 200], [/^struc\w*$/, 4], [/^(stipk\w*|spetk\w*)$/, 1],
];
const COUNT_WORD = /^(ks|kus\w*|kusok|balen\w*|hrst\w*|zvazok|plechovk\w*|konzerv\w*|plat\w*|vetvick\w*)$/;
/** Seasonings, stocks and sauces whose names contain a staple word ("kokosové mlieko", "kurací vývar", "jablčný ocot"). */
const NOT_INGREDIENT = /ocot|octu|vyvar|bujon|omack|past[ayu]|koren|skrob|prasok|sirup|stav[ayu]|rastlinn|vegansk|uden|fond|dzus|pyre|majonez|dresing|rum|kava|cokolad|mandlov/;
/** Slovak inflected and generic forms the product-name rules do not recognise, mapped straight to canonical ids. */
const ALIASES: [RegExp, string][] = [
  [/olivov\w* olej/, 'olivovy-olej'], [/olej/, 'olej'],
  [/kuracich prs|kuracie prsia|kuracieho mas|kuracie maso/, 'kuracie-prsia'], [/kuracich stehien|kuracie stehn/, 'kuracie-stehna'],
  [/mlet\w+ (hovadz|bravcov|mas)|hovadzie\w* mlet/, 'mlete-maso'], [/bravcov/, 'bravcove-kare'], [/hovadz/, 'hovadzie-maso'],
  [/moracich|moracie/, 'morcacie-prsia'], [/losos/, 'losos'], [/tresk/, 'treska'], [/tuniak/, 'tuniak'], [/sunk/, 'sunka'],
  [/ryze|ryza|ryzu/, 'ryza'], [/cestovin|penne|fusilli|spagiet|tagliatel|rezanc|nudl|gnocchi|orzo/, 'cestoviny'], [/batat/, 'bataty'], [/zemiak/, 'zemiaky'],
  [/kuskus/, 'kuskus'], [/tortill|wrap/, 'tortilla'], [/chlieb|chleb/, 'chlieb'], [/vlock/, 'ovsene-vlocky'],
  [/cibul/, 'cibula'], [/cesnak/, 'cesnak'], [/mrkv/, 'mrkva'], [/paprik[ay]$|paprika |paprik /, 'paprika'], [/paradajok|paradajk|rajcin/, 'paradajky'],
  [/brokolic/, 'brokolica'], [/cuket/, 'cuketa'], [/uhork/, 'uhorka'], [/spenat/, 'spenat'], [/sampin|sampion|hub[ya]?\b|hrib/, 'sampiony'],
  [/kapust/, 'kapusta'], [/karfiol/, 'karfiol'], [/hrasok|hrask/, 'hrasok'], [/kukuric(?!n)/, 'kukurica'], [/salat/, 'salat'],
  [/fazul/, 'fazula'], [/cicer/, 'cicer'], [/sosovic/, 'sosovica'], [/tofu/, 'tofu'], [/vajc|vajec|zltk|bielk/, 'vajcia'],
  [/smotan/, 'smotana-na-varenie'], [/jogurt/, 'jogurt-biely'], [/tvaroh/, 'tvaroh'], [/mozzarell/, 'mozzarella'], [/syr/, 'syr-eidam'], [/masl/, 'maslo'],
  [/mliek/, 'mlieko'], [/citron/, 'citron'], [/mandl/, 'mandle'], [/orech|kesu|arasid/, 'vlasske-orechy'], [/muk[ayu]/, 'muka'], [/\bmed\w?\b/, 'med'],
  [/banan/, 'banany'], [/jablk|jablc/, 'jablka'],
];

function canonical(name: string, catalog: Catalog): CatalogEntry | null {
  const n = norm(name);
  const oil = /olej/.test(n);
  if (NOT_INGREDIENT.test(n) && !oil && !/rezanc|nudl|gnocchi|orzo|sojov\w* omack/.test(n)) return null;
  const id = (oil ? null : mapByRules(name)) ?? ALIASES.find(([pattern]) => pattern.test(n))?.[1];
  const entry = id ? catalog.get(id) : undefined;
  return entry?.macros && entry.offers.length && !/^(sol|cierne-korenie)$/.test(entry.id) ? entry : null;
}

const number = (text: string): number => {
  const t = text.replace(',', '.').replace('½', '.5').replace('¼', '.25').replace('¾', '.75');
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  return fraction ? Number(fraction[1]) / Number(fraction[2]) : Number(t);
};

/** Splits "500 g kuracie prsia" or "maslo, 40 g čerstvé" into quantity, unit and name. */
function split(line: string): { quantity: number | null; unit: string; name: string } {
  const text = line.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const amount = '(\\d+\\s*/\\s*\\d+|\\d+(?:[.,]\\d+)?|[½¼¾])(?:\\s*[-–]\\s*\\d+(?:[.,]\\d+)?)?';
  const tail = new RegExp(`^([^,\\d]+?)\\s*,\\s*${amount}\\s*([^\\s,]*)`).exec(text);
  if (tail) return { name: tail[1].trim(), quantity: number(tail[2]), unit: tail[3] };
  const head = new RegExp(`^${amount}\\s*(\\S*)\\s*(.*)$`).exec(text);
  if (!head) return { quantity: null, unit: '', name: text.split(',')[0] };
  const unitLike = UNITS.some(([pattern]) => pattern.test(norm(head[2]))) || COUNT_WORD.test(norm(head[2]));
  return { quantity: number(head[1]), unit: unitLike ? head[2] : '', name: (unitLike ? head[3] : `${head[2]} ${head[3]}`).split(',')[0].trim() };
}

export interface ParsedIngredients {
  mapped: { id: string; grams: number }[];
  /** Original lines that have no counterpart among the canonical ingredients (spices, sauces, specialities). */
  unmatched: string[];
}

/** Maps free-text recipe ingredient lines to canonical ingredients with grams per portion. */
export function parseIngredientLines(lines: string[], portions: number, catalog: Catalog): ParsedIngredients {
  const mapped = new Map<string, number>();
  const unmatched: string[] = [];
  for (const line of lines.map((l) => l.trim()).filter(Boolean)) {
    const { quantity, unit, name } = split(line);
    if (!name || /^vod[ayu]\b/.test(norm(name))) continue;
    const entry = canonical(name, catalog);
    if (!entry) {
      if (!/^(sol|sol[ie]|korenie|cierne korenie)\b/.test(norm(name))) unmatched.push(line);
      continue;
    }
    const perUnit = UNITS.find(([pattern]) => pattern.test(norm(unit)))?.[1];
    const piece = PIECE[entry.role];
    const grams = quantity !== null && perUnit ? (quantity * perUnit) / portions
      : quantity !== null && piece && !/^balen/.test(norm(unit)) ? (quantity * (/cesnak/.test(norm(name)) ? 4 : piece)) / portions
      : PORTION[entry.role] || 5;
    mapped.set(entry.id, (mapped.get(entry.id) ?? 0) + Math.max(2, Math.round(grams)));
  }
  return { mapped: [...mapped].map(([id, grams]) => ({ id, grams })), unmatched };
}
