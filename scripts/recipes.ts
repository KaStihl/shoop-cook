import { loadCatalog } from '@/lib/catalog';
import { RECIPE_SITES, crawlRecipeSite } from '@/lib/crawlers/webrecipes';
import { importExternal, importedUrls } from '@/lib/recipes';
import { STORES } from '@/lib/types';

// Usage: npm run recipes [-- --source=varecha|billa|yummybox] [-- --limit=100]
// Imports reference recipes (ingredients + link to the original) into the recipe library. Without --source every site is read.
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const limit = Number(arg('limit') ?? 60);
const sources = arg('source') ? [arg('source') as string] : Object.keys(RECIPE_SITES);

async function main(): Promise<void> {
  const catalog = loadCatalog(STORES);
  for (const source of sources) {
    let saved = 0, read = 0;
    for (const batch of await crawlRecipeSite(source, catalog, limit, importedUrls(), (line) => console.log(line))) {
      for (const recipe of batch.recipes) {
        read++;
        const result = importExternal(recipe, catalog, source === 'yummybox' ? 'yummybox' : 'web', batch.kind);
        if (result === 'saved') saved++;
        else if (result !== 'duplicate') console.log(`${recipe.name}: neuložené (${result})`);
      }
    }
    console.log(`${source}: ${saved} nových receptov z ${read} rozpoznaných.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
