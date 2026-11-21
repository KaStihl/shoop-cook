'use client';

import { useCallback, useEffect, useState } from 'react';
import { PlanView } from '@/components/PlanView';
import { SettingsPanel } from '@/components/SettingsPanel';
import { api, slotKey, useStored, type StoredPlan } from '@/lib/client';
import { sanitizeSettings } from '@/lib/settings';
import { DEFAULT_SETTINGS, kindOfMeal, type MealType, type MetaResponse, type Plan, type PlanRequest, type PlanSlot, type RecipeListItem, type Settings } from '@/lib/types';

/** "v pondelok", "v stredu" */
const DAY_IN = ['pondelok', 'utorok', 'stredu', 'štvrtok', 'piatok', 'sobotu', 'nedeľu'];
/** "na obed", "na večeru" */
const MEAL_ON: Record<MealType, string> = { breakfast: 'raňajky', snack: 'desiatu', lunch: 'obed', afternoon: 'olovrant', dinner: 'večeru' };

export default function PlanPage() {
  const [settings, setSettings, settingsReady] = useStored<Settings>('jedlokos.settings', DEFAULT_SETTINGS, sanitizeSettings);
  const [stored, setStored, planReady] = useStored<StoredPlan | null>('jedlokos.plan', null);
  const [ingredients, setIngredients] = useState<MetaResponse['ingredients']>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);

  const loadRecipes = useCallback(() => api<RecipeListItem[]>('/api/recipes').then((list) => { setRecipes(list); return list; }).catch(() => [] as RecipeListItem[]), []);
  useEffect(() => { void loadRecipes(); }, [loadRecipes]);

  useEffect(() => {
    api<MetaResponse>('/api/meta').then((meta) => setIngredients(meta.ingredients)).catch(() => setIngredients([]));
  }, []);

  const request = useCallback(async (body: PlanRequest): Promise<Plan | null> => {
    setError(null);
    try {
      return await api<Plan>('/api/plan', { method: 'POST', body: JSON.stringify(body) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Plán sa nepodarilo vytvoriť.');
      return null;
    }
  }, []);

  const slotsOf = (current: StoredPlan) =>
    current.plan.slots.map((s) => ({ day: s.day, meal: s.meal, recipeId: s.recipeId, locked: current.locks.includes(slotKey(s.day, s.meal)) }));

  const generate = async () => {
    setBusy(true);
    const clean = sanitizeSettings(settings);
    const previous = stored ? slotsOf(stored) : undefined;
    setNotice(null);
    const plan = await request({
      settings: clean, action: 'generate', slots: previous, avoid: previous?.filter((s) => !s.locked).map((s) => s.recipeId), seed: Date.now() % 2147483647,
    });
    if (plan) {
      const before = new Map(previous?.map((s) => [slotKey(s.day, s.meal), s.recipeId]));
      const changed = plan.slots.filter((s) => before.get(slotKey(s.day, s.meal)) !== s.recipeId).length;
      const time = new Date(plan.generatedAt).toLocaleTimeString('sk-SK');
      setNotice(previous ? `Nový plán o ${time}: zmenených ${changed} z ${plan.slots.length} jedál, nákup ${plan.cart.total.toFixed(2)} €.` : `Plán vytvorený o ${time}.`);
      const keys = new Set(plan.slots.map((s) => slotKey(s.day, s.meal)));
      setStored({ plan, locks: (stored?.locks ?? []).filter((k) => keys.has(k)), seen: {} });
      localStorage.removeItem('jedlokos.checked');
    }
    setBusy(false);
  };

  const swap = async (slot: PlanSlot, current: StoredPlan | null = stored) => {
    if (!current) return;
    const key = slotKey(slot.day, slot.meal);
    const seen = [...(current.seen[key] ?? []), slot.recipeId];
    setPending(key);
    const plan = await request({ settings: sanitizeSettings(settings), action: 'swap', slots: slotsOf(current), target: { day: slot.day, meal: slot.meal }, exclude: seen });
    // When the planner had to start a new round (every fitting recipe was offered), the memory of seen recipes restarts too.
    const placed = plan?.slots.find((s) => s.day === slot.day && s.meal === slot.meal)?.recipeId;
    if (plan) setStored({ plan, locks: current.locks, seen: { ...current.seen, [key]: placed !== undefined && seen.includes(placed) ? [] : seen } });
    setPending(null);
  };

  /** Puts a chosen recipe into one meal, keeps everything else and lets the planner recompute portions and the cart. */
  const pick = async (slot: PlanSlot, recipeId: number) => {
    if (!stored) return;
    const key = slotKey(slot.day, slot.meal);
    setPending(key);
    setNotice(null);
    const slots = slotsOf(stored).map((s) => ({ ...s, recipeId: s.day === slot.day && s.meal === slot.meal ? recipeId : s.recipeId, locked: true }));
    const plan = await request({ settings: sanitizeSettings(settings), action: 'generate', slots, seed: Date.now() % 2147483647 });
    const placed = plan?.slots.find((s) => s.day === slot.day && s.meal === slot.meal);
    if (plan && placed?.recipeId === recipeId) {
      setStored({ plan, locks: [...new Set([...stored.locks, key])], seen: stored.seen });
      setNotice(`${placed.name} je zaradené a zamknuté. Porcie aj košík sú prepočítané (nákup ${plan.cart.total.toFixed(2)} €).`);
    } else if (plan) {
      setError('Recept nevyhovuje aktuálnym nastaveniam (diéta, alergény alebo čas prípravy).');
    }
    setPending(null);
  };

  const pickFromUrl = async (slot: PlanSlot, url: string) => {
    const key = slotKey(slot.day, slot.meal);
    setPending(key);
    setError(null);
    try {
      const kind = kindOfMeal(slot.meal);
      const added = await api<{ id: number }>('/api/recipes', { method: 'POST', body: JSON.stringify({ action: 'url', url, kind }) });
      await loadRecipes();
      await pick(slot, added.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recept sa nepodarilo načítať.');
      setPending(null);
    }
  };

  /** Swaps two meals of one kind; every meal stays where it is otherwise, portions and the cart are recomputed. */
  const move = async (from: PlanSlot, to: PlanSlot) => {
    if (!stored) return;
    const fromKey = slotKey(from.day, from.meal);
    const toKey = slotKey(to.day, to.meal);
    setPending(toKey);
    setNotice(null);
    const recipeAt = (key: string, id: number) => (key === fromKey ? to.recipeId : key === toKey ? from.recipeId : id);
    const slots = slotsOf(stored).map((s) => ({ ...s, recipeId: recipeAt(slotKey(s.day, s.meal), s.recipeId), locked: true }));
    const plan = await request({ settings: sanitizeSettings(settings), action: 'generate', slots, seed: Date.now() % 2147483647 });
    const placed = plan?.slots.find((s) => s.day === to.day && s.meal === to.meal);
    if (plan && placed?.recipeId === from.recipeId) {
      // A lock belongs to the dish, so it moves along with it.
      const had = (key: string) => stored.locks.includes(key);
      const locks = stored.locks.filter((k) => k !== fromKey && k !== toKey);
      if (had(fromKey)) locks.push(toKey);
      if (had(toKey)) locks.push(fromKey);
      const { [fromKey]: seenFrom = [], [toKey]: seenTo = [], ...seen } = stored.seen;
      setStored({ plan, locks, seen: { ...seen, [toKey]: seenFrom, [fromKey]: seenTo } });
      const where = (x: PlanSlot) => `na ${MEAL_ON[x.meal]} v ${DAY_IN[x.day]}`;
      setNotice(`Vymenené: ${from.name} je teraz ${where(to)}, ${to.name} ${where(from)}. Košík je prepočítaný (${plan.cart.total.toFixed(2)} €).`);
    } else if (plan) {
      setError('Jedlá sa nepodarilo vymeniť.');
    }
    setPending(null);
  };

  const toggleLock = (slot: PlanSlot) => {
    if (!stored) return;
    const key = slotKey(slot.day, slot.meal);
    setStored({ ...stored, locks: stored.locks.includes(key) ? stored.locks.filter((k) => k !== key) : [...stored.locks, key] });
  };

  const feedback = async (slot: PlanSlot, value: number) => {
    if (!stored) return;
    try {
      await api('/api/recipes/feedback', { method: 'POST', body: JSON.stringify({ id: slot.recipeId, value }) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hodnotenie sa nepodarilo uložiť.');
      return;
    }
    const next = { ...stored, plan: { ...stored.plan, slots: stored.plan.slots.map((s) => (s.recipeId === slot.recipeId ? { ...s, feedback: value } : s)) } };
    setStored(next);
    if (value < 0) await swap(slot, next);
  };

  const ready = settingsReady && planReady;
  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr] lg:items-start print:block">
      <SettingsPanel settings={settings} onChange={setSettings} ingredients={ingredients} recipes={recipes} busy={busy || !ready} onGenerate={generate} />
      <div className="min-w-0">
        {error && (
          <div role="alert" className="card mb-4 border-red-200 bg-red-50 p-3 text-sm text-red-800 print:hidden">
            {error} <button type="button" className="ml-2 font-semibold underline" onClick={() => setError(null)}>Zavrieť</button>
          </div>
        )}
        {notice && !error && <p role="status" className="card mb-4 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 print:hidden">{notice}</p>}
        {!ready || (busy && !stored) ? (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-busy="true" aria-label="Načítavam plán">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-56" />)}
          </div>
        ) : stored ? (
          <div className={busy ? 'pointer-events-none opacity-60 transition' : 'transition'}>
            <PlanView plan={stored.plan} settings={settings} locks={stored.locks} pending={pending} onLock={toggleLock} onSwap={(slot) => void swap(slot)} onFeedback={(slot, value) => void feedback(slot, value)}
              recipes={recipes} onPick={(slot, id) => void pick(slot, id)} onUrl={(slot, url) => void pickFromUrl(slot, url)} onMove={(from, to) => void move(from, to)}
              pantry={settings.pantry.map((id) => ingredients.find((i) => i.id === id)?.name ?? id)} />
          </div>
        ) : (
          <section className="card grid place-items-center gap-3 px-6 py-16 text-center">
            <h1 className="text-xl font-bold">Zostavte si jedálniček na celý týždeň</h1>
            <p className="max-w-md text-sm text-stone-600">
              Nastavte rozpočet, ciele a obmedzenia. JedloKôš vyberie jedlá z najlacnejších surovín podľa aktuálnych akcií a pripraví nákupný zoznam.
            </p>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={generate}>Vygenerovať plán</button>
          </section>
        )}
      </div>
    </div>
  );
}
