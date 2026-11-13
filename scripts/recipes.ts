import { loadCatalog } from '@/lib/catalog';
import { crawlYummybox } from '@/lib/crawlers/yummybox';
import { importExternal, importedUrls } from '@/lib/recipes';
import { STORES } from '@/lib/types';

// Usage: npm run recipes [-- --limit=100]   (imports reference recipes from yummybox.sk into the recipe library)
const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 60);

async function main(): Promise<void> {
  const catalog = loadCatalog(STORES);
  const recipes = await crawlYummybox(catalog, limit, importedUrls(), (line) => console.log(line));
  let saved = 0;
  for (const recipe of recipes) {
    const result = importExternal(recipe, catalog);
    if (result === 'saved') saved++;
    else if (result !== 'duplicate') console.log(`${recipe.name}: neuložené (${result})`);
  }
  console.log(`Hotovo: ${saved} nových receptov z ${recipes.length} rozpoznaných.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
