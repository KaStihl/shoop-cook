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

  // A budget that cannot be met must not undo the repeat limit (it used to fill the week with one cheapest dish).
  const tight = await generatePlan({ settings: { ...settings, budget: 10, maxRepeats: 1, batch: false }, action: 'generate', seed: 3 });
  const counts = new Map<number, number>();
  tight.slots.forEach((s) => counts.set(s.recipeId, (counts.get(s.recipeId) ?? 0) + 1));
  assert.ok([...counts.values()].every((n) => n === 1), 'pri nízkom rozpočte sa jedlo neopakuje viac, než dovoľuje nastavenie');

  // Repeated swaps pick at random among several good alternatives, not always the next cheapest one.
  const picks = new Set<number>();
  for (let i = 0; i < 6; i++) {
    const next = await generatePlan({
      settings, action: 'swap', target: { day: first.day, meal: first.meal }, exclude: [first.recipeId], seed: 100 + i,
      slots: plan.slots.map((s) => ({ day: s.day, meal: s.meal, recipeId: s.recipeId, locked: false })),
    });
    picks.add(next.slots[0].recipeId);
  }
  assert.ok(picks.size > 1, 'výmena jedla vyberá náhodne z viacerých receptov');

  // Only varecha.sk recipes: every lunch and dinner links there (breakfasts may fall back to other sources).
  const varecha = await generatePlan({ settings: { ...settings, origins: ['varecha'] }, action: 'generate', seed: 1 });
  const mains = varecha.slots.filter((s) => s.meal === 'lunch' || s.meal === 'dinner');
  assert.ok(mains.every((s) => s.steps.some((step) => step.includes('varecha'))), 'plán berie obedy a večere len z varecha.sk');
  console.log(`OK – len varecha.sk: ${mains.map((s) => s.name).slice(0, 3).join(', ')}…; upozornenia: ${varecha.warnings.join(' | ') || 'žiadne'}`);
  console.log(`OK – ${plan.slots.length} jedál, košík ${plan.cart.total.toFixed(2)} € (rozpočet ${settings.budget} €), ${plan.cart.lines.length} položiek.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
