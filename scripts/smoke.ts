import assert from 'node:assert/strict';
import { generatePlan } from '@/lib/planner';
import { seedProducts } from '@/lib/seed';
import { DEFAULT_SETTINGS } from '@/lib/types';

// Single smoke test: seed (if empty) -> generate a week -> swap one meal -> cart is consistent.
async function main(): Promise<void> {
  seedProducts();
  const settings = DEFAULT_SETTINGS;
  const plan = await generatePlan({ settings, action: 'generate', seed: 1 });
  assert.equal(plan.slots.length, 7 * settings.meals.length, 'každý deň má všetky jedlá');
  assert.ok(plan.slots.every((s) => s.scale === 1), 'každé jedlo je jedna porcia receptu');
  assert.ok(plan.cart.lines.length > 0 && plan.cart.total > 0, 'košík má položky a cenu');
  assert.ok(Math.abs(plan.cart.total - plan.cart.lines.reduce((a, l) => a + l.lineTotal, 0)) < 0.05, 'súčet košíka sedí');

  const first = plan.slots[0];
  const swapped = await generatePlan({
    settings, action: 'swap', target: { day: first.day, meal: first.meal }, exclude: [first.recipeId],
    slots: plan.slots.map((s) => ({ day: s.day, meal: s.meal, recipeId: s.recipeId, locked: false })),
  });
  assert.notEqual(swapped.slots[0].recipeId, first.recipeId, 'výmena jedla zmení recept');
  console.log(`OK – ${plan.slots.length} jedál, košík ${plan.cart.total.toFixed(2)} € (rozpočet ${settings.budget} €), ${plan.cart.lines.length} položiek.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
