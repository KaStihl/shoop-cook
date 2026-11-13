import { norm } from './strings';

export const CATEGORIES = ['Mäso a ryby', 'Mliečne a vajcia', 'Ovocie a zelenina', 'Pečivo', 'Trvanlivé', 'Mrazené', 'Ostatné'] as const;
export const ROLES = [
  'protein', 'legume', 'egg', 'dairy', 'milk', 'topping', 'spread', 'carb', 'bread', 'cereal',
  'veg', 'fruit', 'fat', 'nuts', 'sweet', 'sauce', 'aromatic', 'staple',
] as const;
export const DIETS = ['vegan', 'vegetarian', 'fish', 'meat'] as const;

export type Role = (typeof ROLES)[number];
export type IngredientDiet = (typeof DIETS)[number];

export interface IngredientSeed {
  id: string;
  name: string;
  category: (typeof CATEGORIES)[number];
  role: Role;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  diet: IngredientDiet;
  allergens: string[];
  lactoseFree: boolean;
  baselinePrice: number;
  baselinePack: number;
  pieceGrams: number | null;
  match: RegExp;
  not: RegExp | null;
}

interface Extra { not?: string; lf?: boolean; piece?: number }

const MEAT = 'Mäso a ryby', DAIRY = 'Mliečne a vajcia', PRODUCE = 'Ovocie a zelenina', BAKERY = 'Pečivo', DRY = 'Trvanlivé', FROZEN = 'Mrazené';

function i(
  id: string, name: string, category: IngredientSeed['category'], role: Role, n: [number, number, number, number],
  diet: IngredientDiet, allergens: string[], baselinePrice: number, baselinePack: number, match: string, extra: Extra = {},
): IngredientSeed {
  return {
    id, name, category, role, kcal: n[0], protein: n[1], carbs: n[2], fat: n[3], diet, allergens,
    lactoseFree: extra.lf ?? !allergens.includes('milk'), baselinePrice, baselinePack, pieceGrams: extra.piece ?? null,
    match: new RegExp(match), not: extra.not ? new RegExp(extra.not) : null,
  };
}

/**
 * Built-in canonical ingredients. Order matters for keyword mapping: specific rules come before generic ones.
 * Patterns run against diacritics-free lowercase product names. Nutrition is per 100 g, baseline price per kg/l.
 */
export const BUILTIN: IngredientSeed[] = [
  i('mlieko-bez-laktozy', 'mlieko bez laktózy', DAIRY, 'milk', [47, 3.3, 4.8, 1.5], 'vegetarian', ['milk'], 1.45, 1000, 'mlieko.*(bez lakt|bezlakt|delakt)|(bez lakt|bezlakt).*mlieko', { lf: true }),
  i('kokosove-mlieko', 'kokosové mlieko', DRY, 'sauce', [180, 1.8, 3, 18], 'vegan', [], 4.5, 400, 'kokosov.*mlieko'),
  i('ovseny-napoj', 'ovsený nápoj', DRY, 'milk', [45, 1, 7, 1.5], 'vegan', ['gluten'], 1.9, 1000, 'ovsen.*napoj'),
  i('mlieko', 'mlieko polotučné', DAIRY, 'milk', [47, 3.3, 4.8, 1.5], 'vegetarian', ['milk'], 0.95, 1000, 'mlieko', { not: 'kondenz|susene|kokos|mandl|soj|ryzov|telov|cistiac|plet|cokolad|v prasku|ochuten|kakaov' }),
  i('jogurt-bez-laktozy', 'biely jogurt bez laktózy', DAIRY, 'dairy', [65, 4, 5, 3.2], 'vegetarian', ['milk'], 3.6, 400, 'jogurt.*(bez lakt|bezlakt)', { lf: true }),
  i('jogurt-biely', 'biely jogurt', DAIRY, 'dairy', [65, 4, 5, 3.2], 'vegetarian', ['milk'], 2.6, 400, 'jogurt.*(biel|greck|natur)|(biely|grecky).*jogurt'),
  i('tvaroh', 'tvaroh', DAIRY, 'dairy', [95, 13, 3.5, 3], 'vegetarian', ['milk'], 5.5, 250, 'tvaroh', { not: 'tvarohov|termix|dezert|kolac' }),
  i('cottage', 'cottage cheese', DAIRY, 'dairy', [98, 12, 2.5, 4.5], 'vegetarian', ['milk'], 6.5, 180, 'cottage'),
  i('mozzarella', 'mozzarella', DAIRY, 'topping', [250, 18, 2, 19], 'vegetarian', ['milk'], 8.5, 125, 'mozzarell', { not: 'pizza|bageta' }),
  i('syr-eidam', 'tvrdý syr (eidam)', DAIRY, 'topping', [340, 26, 1, 26], 'vegetarian', ['milk'], 8, 250, 'eidam|edam|gouda|ementa', { not: 'pizza|bageta|chips' }),
  i('arasidove-maslo', 'arašidové maslo', DRY, 'spread', [590, 25, 20, 50], 'vegan', ['nuts'], 7, 350, 'arasidov.*(maslo|krem)'),
  i('maslo', 'maslo', DAIRY, 'fat', [740, 0.7, 0.6, 82], 'vegetarian', ['milk'], 9.5, 250, '\\bmaslo', { not: 'orieskov|kakaov|telov|bambuck|maslov|susienk' }),
  i('smotana-na-varenie', 'smotana na varenie', DAIRY, 'sauce', [130, 3, 4, 12], 'vegetarian', ['milk'], 4.5, 250, 'smotana.*(varen|12 ?%|10 ?%)'),
  i('vajcia', 'vajcia', DAIRY, 'egg', [143, 12.5, 0.7, 9.5], 'vegetarian', ['egg'], 3.6, 600, 'vajc|vajic', { not: 'cestovin|liker|cokolad|kinder|majonez|rezanc', piece: 60 }),
  i('kuracie-prsia', 'kuracie prsia', MEAT, 'protein', [110, 23, 0, 2], 'meat', [], 7.9, 500, 'kurac.*prs', { not: 'sunk|narez|nugget|obalovan' }),
  i('kuracie-stehna', 'kuracie stehná', MEAT, 'protein', [180, 18, 0, 12], 'meat', [], 4.2, 1000, 'kurac.*steh', { not: 'uden|grilovan' }),
  i('morcacie-prsia', 'morčacie prsia', MEAT, 'protein', [107, 24, 0, 1], 'meat', [], 9.5, 500, 'morcac.*prs', { not: 'sunk|narez' }),
  i('mlete-maso', 'mleté mäso', MEAT, 'protein', [235, 17, 0, 18.5], 'meat', [], 6.9, 500, 'mlet.*mas'),
  i('bravcove-pliecko', 'bravčové pliecko', MEAT, 'protein', [180, 18, 0, 12], 'meat', [], 5.5, 1000, 'bravcov.*pliec', { not: 'uden|sunk' }),
  i('bravcova-krkovicka', 'bravčová krkovička', MEAT, 'protein', [230, 17, 0, 18], 'meat', [], 6.5, 1000, 'bravcov.*krkov', { not: 'uden|marinov' }),
  i('bravcove-kare', 'bravčové karé', MEAT, 'protein', [150, 21, 0, 7], 'meat', [], 6.9, 1000, 'bravcov.*kare', { not: 'uden' }),
  i('hovadzie-maso', 'hovädzie mäso', MEAT, 'protein', [180, 20, 0, 11], 'meat', [], 11.5, 500, 'hovadz', { not: 'vyvar|bujon|konzerv|gulas hotov|burger' }),
  i('losos', 'losos', MEAT, 'protein', [200, 20, 0, 13], 'fish', ['fish'], 19, 250, 'losos', { not: 'uden|pasta|natier|salat' }),
  i('treska', 'treska (filety)', FROZEN, 'protein', [80, 18, 0, 0.7], 'fish', ['fish'], 9.5, 400, 'tresk|aljask', { not: 'salat|v majonez|obalovan|prsty' }),
  i('tuniak', 'tuniak vo vlastnej šťave', DRY, 'protein', [110, 25, 0, 1], 'fish', ['fish'], 12, 160, 'tuniak', { not: 'salat|natier|pasta|pre mack' }),
  i('sunka', 'šunka', MEAT, 'topping', [110, 19, 1, 3], 'meat', [], 10, 100, 'sunka', { not: 'pizza|bageta|syr|salat|rolk' }),
  i('tofu', 'tofu', DAIRY, 'protein', [125, 13, 2, 7.5], 'vegan', ['soy'], 8, 180, 'tofu'),
  i('sosovica', 'šošovica', DRY, 'legume', [350, 24, 50, 1.5], 'vegan', [], 3.6, 500, 'sosovic', { not: 'polievk|hotov' }),
  i('cicer', 'cícer', DRY, 'legume', [360, 20, 50, 6], 'vegan', [], 3.8, 500, 'cicer', { not: 'hummus|natier|chrumk' }),
  i('fazula', 'fazuľa (konzerva)', DRY, 'legume', [100, 7, 15, 0.5], 'vegan', [], 2.4, 400, 'fazul', { not: 'zelen.*fazul|struk|polievk' }),
  i('ryza-basmati', 'ryža basmati', DRY, 'carb', [350, 8, 77, 1], 'vegan', [], 2.8, 1000, 'basmati'),
  i('ryza', 'ryža', DRY, 'carb', [350, 7, 78, 0.7], 'vegan', [], 1.7, 1000, 'ryza', { not: 'napoj|chlebic|puding|mliec|hotov|rizot' }),
  i('cestoviny-bezlepkove', 'bezlepkové cestoviny', DRY, 'carb', [355, 7, 78, 1.5], 'vegan', [], 4.5, 500, 'cestovin.*(bezlep|bez lepku)|bezlepkov.*cestovin'),
  i('cestoviny', 'cestoviny', DRY, 'carb', [355, 12, 72, 1.5], 'vegan', ['gluten'], 1.7, 500, 'cestovin|spaget|penne|fusilli|kolienka|farfalle|tagliatelle', { not: 'omack|instant|hotov|salat|na cestoviny' }),
  i('zemiaky', 'zemiaky', PRODUCE, 'carb', [77, 2, 17, 0.1], 'vegan', [], 0.9, 1000, 'zemiak', { not: 'lupien|chips|hranol|salat|kas|plack|knedl|krokety|skrob|pyre' }),
  i('bataty', 'batáty', PRODUCE, 'carb', [86, 1.6, 20, 0.1], 'vegan', [], 2.6, 1000, 'batat', { not: 'chips|hranol' }),
  i('chlieb', 'chlieb', BAKERY, 'bread', [245, 9, 46, 2.5], 'vegan', ['gluten'], 2.7, 500, 'chlieb|chleb', { not: 'chlebic|struhank|chrumk|bezlep|nater|nôz|noz|chlebnik' }),
  i('tortilla', 'pšeničné tortilly', BAKERY, 'carb', [300, 8, 50, 7], 'vegan', ['gluten'], 4, 320, 'tortill', { not: 'chips|nachos' }),
  i('ovsene-vlocky', 'ovsené vločky', DRY, 'cereal', [370, 13, 60, 7], 'vegan', ['gluten'], 1.9, 500, 'ovsen.*vlock'),
  i('kuskus', 'kuskus', DRY, 'carb', [360, 12, 72, 1.5], 'vegan', ['gluten'], 3.2, 500, 'kuskus', { not: 'salat|hotov' }),
  i('bulgur', 'bulgur', DRY, 'carb', [345, 12, 70, 1.5], 'vegan', ['gluten'], 3.2, 500, 'bulgur', { not: 'salat|hotov' }),
  i('pohanka', 'pohánka', DRY, 'carb', [340, 12, 68, 3], 'vegan', [], 3.8, 500, 'pohank', { not: 'chlebic|vankus' }),
  i('muka', 'múka hladká', DRY, 'staple', [345, 10, 72, 1], 'vegan', ['gluten'], 0.85, 1000, '\\bmuka', { not: 'mandl|kokos|ryzov|kukuric' }),
  i('paradajky-krajane', 'krájané paradajky (konzerva)', DRY, 'sauce', [22, 1.2, 4, 0.1], 'vegan', [], 2.2, 400, 'paradajk.*(krajan|lupan|pasirov|drven)|passata|pelati'),
  i('paradajkovy-pretlak', 'paradajkový pretlak', DRY, 'staple', [80, 4, 16, 0.5], 'vegan', [], 5, 140, 'pretlak'),
  i('paradajky', 'paradajky', PRODUCE, 'veg', [20, 1, 3.5, 0.2], 'vegan', [], 2.7, 500, 'paradajk|rajcin', { not: 'susen|kecup|omack|stava|polievk|sardink|makrel|v paradajk' }),
  i('paprika', 'paprika', PRODUCE, 'veg', [30, 1, 6, 0.3], 'vegan', [], 3, 500, 'paprik', { not: 'mleta|korenie|chips|klobas|natier|lupien|chrumk|steriliz|plnen|salam' }),
  i('uhorka', 'uhorka šalátová', PRODUCE, 'veg', [15, 0.7, 3, 0.1], 'vegan', [], 2, 400, 'uhork', { not: 'steriliz|kysl|nakladan|v nalev' }),
  i('cibula', 'cibuľa', PRODUCE, 'aromatic', [40, 1.2, 9, 0.1], 'vegan', [], 1, 1000, 'cibul', { not: 'kruzk|prazen|susen|chips|smotan' }),
  i('cesnak', 'cesnak', PRODUCE, 'aromatic', [140, 6, 30, 0.5], 'vegan', [], 6.5, 200, 'cesnak', { not: 'susen|granul|pasta|bageta|natier|maslo|dresing|omack|chips' }),
  i('mrkva', 'mrkva', PRODUCE, 'veg', [40, 1, 9, 0.2], 'vegan', [], 1, 1000, 'mrkv', { not: 'stav|detsk|prikrm|salat' }),
  i('brokolica', 'brokolica', PRODUCE, 'veg', [34, 2.8, 7, 0.4], 'vegan', [], 3.2, 500, 'brokolic', { not: 'polievk' }),
  i('karfiol', 'karfiol', PRODUCE, 'veg', [25, 2, 5, 0.3], 'vegan', [], 2.2, 800, 'karfiol', { not: 'polievk|obalovan' }),
  i('spenat', 'špenát', FROZEN, 'veg', [23, 2.9, 3.6, 0.4], 'vegan', [], 4, 450, 'spenat', { not: 'pizza|listove cesto|tasticky' }),
  i('cuketa', 'cuketa', PRODUCE, 'veg', [17, 1.2, 3, 0.3], 'vegan', [], 2.2, 500, 'cuket'),
  i('kapusta', 'kapusta biela', PRODUCE, 'veg', [25, 1.3, 6, 0.1], 'vegan', [], 0.9, 1000, 'kapust', { not: 'kysl|kvasen|steriliz|ruzickov|salat' }),
  i('sampiony', 'šampiňóny', PRODUCE, 'veg', [22, 3, 3, 0.3], 'vegan', [], 4.6, 500, 'sampion', { not: 'steriliz|konzerv|v nalev|polievk' }),
  i('salat', 'listový šalát', PRODUCE, 'veg', [15, 1.4, 2.9, 0.2], 'vegan', [], 5, 200, 'ladov.*salat|hlavkov.*salat|rimsk.*salat|listov.*salat|rukol|polnicek|mix salat'),
  i('hrasok', 'hrášok mrazený', FROZEN, 'veg', [80, 5, 14, 0.4], 'vegan', [], 2.6, 450, 'hras', { not: 'polievk|wasabi|chrumk|steriliz|cukrov' }),
  i('zelenina-mrazena', 'mrazená zeleninová zmes', FROZEN, 'veg', [50, 2.5, 9, 0.5], 'vegan', [], 2.6, 450, 'zeleninov.*zmes|mrazen.*zelenin|zelenina (pod|na) '),
  i('kukurica', 'kukurica sladká', DRY, 'veg', [85, 3, 19, 1.2], 'vegan', [], 3.2, 285, 'kukuric', { not: 'lupien|chrumk|pukan|popcorn|chips|muka|krupic|skrob|olej|chlebic' }),
  i('banany', 'banány', PRODUCE, 'fruit', [89, 1.1, 23, 0.3], 'vegan', [], 1.5, 1000, 'banan', { not: 'chips|susen|cokolad|prichut|napoj' }),
  i('jablka', 'jablká', PRODUCE, 'fruit', [52, 0.3, 14, 0.2], 'vegan', [], 1.5, 1000, 'jablk|jablc', { not: 'stav|dzus|pyre|must|ocot|zavin|strudl|kompot|susen|chips|napoj|cider|vyziva' }),
  i('pomarance', 'pomaranče', PRODUCE, 'fruit', [47, 0.9, 12, 0.1], 'vegan', [], 1.6, 1000, 'pomaranc', { not: 'stav|dzus|napoj|dzem|cokolad|prichut|nektar|limonad' }),
  i('hrusky', 'hrušky', PRODUCE, 'fruit', [57, 0.4, 15, 0.1], 'vegan', [], 1.9, 1000, 'hrusk', { not: 'kompot|stav|destil|palenk' }),
  i('mandarinky', 'mandarínky', PRODUCE, 'fruit', [53, 0.8, 13, 0.3], 'vegan', [], 1.8, 1000, 'mandarink|klementink', { not: 'kompot|napoj' }),
  i('citron', 'citróny', PRODUCE, 'staple', [29, 1.1, 9, 0.3], 'vegan', [], 2.5, 500, 'citron', { not: 'stav|napoj|caj|cistic|prichut|limonad|kyselin|pivo|radler' }),
  i('lesne-ovocie', 'lesné ovocie mrazené', FROZEN, 'fruit', [50, 1, 12, 0.5], 'vegan', [], 7, 300, 'lesn.*(ovoc|zmes)|maliny.*mrazen|cucoriedk', { not: 'jogurt|dzem|caj|napoj|sirup' }),
  i('olivovy-olej', 'olivový olej', DRY, 'fat', [884, 0, 0, 100], 'vegan', [], 10, 500, 'olivov.*olej', { not: 'sardink|tuniak|v olivov' }),
  i('olej', 'olej repkový', DRY, 'fat', [884, 0, 0, 100], 'vegan', [], 2.2, 1000, 'repkov.*olej|slnecnicov.*olej|rastlinn.*olej', { not: 'sardink|tuniak|v oleji|v slnecnic' }),
  i('vlasske-orechy', 'vlašské orechy', DRY, 'nuts', [654, 15, 14, 65], 'vegan', ['nuts'], 12, 200, 'vlassk.*orech'),
  i('mandle', 'mandle', DRY, 'nuts', [579, 21, 22, 50], 'vegan', ['nuts'], 13, 200, 'mandl', { not: 'mlieko|napoj|muka|cokolad|v cukre|susienk|krem|sprchov' }),
  i('med', 'med', DRY, 'sweet', [304, 0.3, 82, 0], 'vegetarian', [], 9, 250, 'vceli med|kvetov.*med|\\bmed\\b', { not: 'medov' }),
  i('sol', 'soľ', DRY, 'staple', [0, 0, 0, 0], 'vegan', [], 0.6, 1000, 'kuchynsk.*sol|jedla sol|morska sol|\\bsol\\b', { not: 'kupel|umyv|regener|tablet' }),
  i('cierne-korenie', 'čierne korenie', DRY, 'staple', [250, 10, 64, 3], 'vegan', [], 30, 20, 'ciern.*korenie'),
  i('sojova-omacka', 'sójová omáčka', DRY, 'staple', [60, 8, 6, 0], 'vegan', ['soy', 'gluten'], 6, 150, 'sojov.*omack'),
];

const EXCLUDE = /mysli|musli|granol|detsk|prikrm|\bdp\b|steriliz|delikates|nakladan|kompot|dzem|lekvar|ochuten|prichut|instant|polievk|hotov\w* jedl|cips|chips|tycink|oblatk|napln|\bcaj\b|ovocn\w* (jogurt|tvaroh)|krmivo|pre psov|pre mack|granule|sampon|lupienky|cokolad|susienk|keks|cukrik|zuvack|dzus|pivo|vino |liker|puding|zmrzlin|pizza|sendvic|pastet|klobas|parky|spekac|slanin|dresing|kecup|majonez|tatarsk|praci|cistic|dekorac|hracka|sviecka|napoj/;
const NON_FOOD = /moda|byvanie|nabytok|dielna|zahrada|hrack|sport|domacnost|chovatel|drogeri|kozmetik|elektro|auto|textil|obuv|naradie/;

/** Keyword rules: returns the canonical ingredient id or null when no rule applies. */
export function mapByRules(name: string): string | null {
  const n = norm(name);
  if (EXCLUDE.test(n) && !/ovsen.*napoj/.test(n)) return null;
  for (const seed of BUILTIN) {
    if (seed.match.test(n) && !(seed.not && seed.not.test(n))) return seed.id;
  }
  return null;
}

/** Cheap pre-filter so obviously non-food catalogue items are never sent to the LLM. */
export function likelyFood(category: string | null, name: string): boolean {
  if (category && NON_FOOD.test(norm(category))) return false;
  return !NON_FOOD.test(norm(name));
}
