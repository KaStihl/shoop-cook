'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { SignIn, useSession } from '@/components/HybridAuth';
import { api, eur, slotKey, useStored, type StoredPlan } from '@/lib/client';
import { fromFridge, planFromFridge, weekSlots, type WeekChoice, type WeekProposal } from '@/lib/fridge';
import { sanitizeSettings } from '@/lib/settings';
import { DAY_LABEL, DEFAULT_SETTINGS, MEAL_LABEL, type MetaResponse, type Plan, type RecipeListItem, type Settings } from '@/lib/types';

/**
 * "Chladnička": say what is at home, let the AI coach build the week around it (with alternatives per meal),
 * then take it over as the weekly plan. What is at home is the same list as "Mám doma (nekupovať)" in the plan
 * settings, so those ingredients are never put into the shopping cart.
 */
export default function FridgePage() {
  const router = useRouter();
  const session = useSession();
  const [settings, setSettings, settingsReady] = useStored<Settings>('jedlokos.settings', DEFAULT_SETTINGS, sanitizeSettings);
  const [note, setNote] = useStored<string>('jedlokos.fridgeNote', '');
  const [wish, setWish] = useStored<string>('jedlokos.fridgeWish', '');
  const [proposal, setProposal] = useStored<WeekProposal | null>('jedlokos.fridgeWeek', null);
  const [, setStoredPlan] = useStored<StoredPlan | null>('jedlokos.plan', null);
  const [ingredients, setIngredients] = useState<MetaResponse['ingredients']>([]);
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<'ai' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MetaResponse>('/api/meta').then((meta) => setIngredients(meta.ingredients)).catch(() => setIngredients([]));
    api<RecipeListItem[]>('/api/recipes').then(setRecipes).catch(() => setRecipes([]));
  }, []);

  const names = useMemo(() => new Map(ingredients.map((i) => [i.id, i.name])), [ingredients]);
  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const home = useMemo(() => new Set(settings.pantry), [settings.pantry]);
  const q = query.trim().toLowerCase();
  const matches = q.length > 1 ? ingredients.filter((i) => !home.has(i.id) && i.name.toLowerCase().includes(q)).slice(0, 18) : [];
  const toggle = (id: string) => setSettings({ ...settings, pantry: home.has(id) ? settings.pantry.filter((p) => p !== id) : [...settings.pantry, id] });

  const ask = async () => {
    setBusy('ai');
    setError(null);
    try {
      const fridgeNames = settings.pantry.map((id) => names.get(id) ?? id);
      setProposal(await planFromFridge({ recipes, settings, fridgeNames, note, wish }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const choose = (choice: WeekChoice, recipeId: number) => {
    if (!proposal) return;
    setProposal({
      ...proposal,
      slots: proposal.slots.map((s) => (s === choice ? { ...s, recipe_id: recipeId, alternatives: [s.recipe_id, ...s.alternatives.filter((a) => a !== recipeId)] } : s)),
    });
  };

  /** Locks the AI choices into a real plan; meals the AI left out are filled by the regular planner. */
  const apply = async () => {
    if (!proposal) return;
    setBusy('apply');
    setError(null);
    try {
      const slots = proposal.slots.map((s) => ({ day: s.day, meal: s.meal, recipeId: s.recipe_id, locked: true }));
      const plan = await api<Plan>('/api/plan', { method: 'POST', body: JSON.stringify({ settings: sanitizeSettings(settings), action: 'generate', slots, seed: Date.now() % 2147483647 }) });
      setStoredPlan({ plan, locks: proposal.slots.map((s) => slotKey(s.day, s.meal)), seen: {} });
      localStorage.removeItem('jedlokos.checked');
      router.push('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const planned = weekSlots(settings);
  const choices = new Map(proposal?.slots.map((s) => [slotKey(s.day, s.meal), s]));

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <section className="card space-y-4 p-4 lg:sticky lg:top-[4.5rem] lg:self-start">
        <div>
          <h1 className="text-lg font-bold">Chladnička</h1>
          <p className="text-xs text-stone-500">Zadajte, čo máte doma. AI pomocník z toho zostaví týždeň a doplní len to, čo treba dokúpiť. Tieto suroviny sa nedávajú do košíka (rovnaký zoznam ako „Mám doma“ v nastaveniach plánu).</p>
        </div>
        <div>
          <span className="label">Mám doma ({settings.pantry.length})</span>
          <input className="input" placeholder="Pridať surovinu, napr. kuracie, ryža…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Pridať surovinu" />
          {matches.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {matches.map((i) => <button key={i.id} type="button" className="chip" onClick={() => { toggle(i.id); setQuery(''); }}>+ {i.name}</button>)}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {settingsReady && settings.pantry.map((id) => (
              <button key={id} type="button" className="chip chip-on" title="Odobrať" onClick={() => toggle(id)}>{names.get(id) ?? id} ×</button>
            ))}
          </div>
          {settings.pantry.length > DEFAULT_SETTINGS.pantry.length && (
            <button type="button" className="mt-2 text-xs text-stone-500 underline" onClick={() => setSettings({ ...settings, pantry: [...DEFAULT_SETTINGS.pantry] })}>Vyprázdniť (nechať soľ, korenie a olej)</button>
          )}
        </div>
        <label className="block">
          <span className="label">Zvyšky a množstvá (voľný text)</span>
          <textarea className="input min-h-20" placeholder="napr. 500 g kuracích pŕs do stredy, pol hlávky kapusty, zvyšok ryže" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1500} />
        </label>
        <label className="block">
          <span className="label">Želanie na týždeň</span>
          <input className="input" placeholder="napr. rýchle večere, viac bielkovín" value={wish} onChange={(e) => setWish(e.target.value)} maxLength={500} />
        </label>
        <p className="text-xs text-stone-500">Týždeň má {planned.length} jedál podľa nastavení plánu (dni, chody, diéta, zdroje receptov).</p>
        {session === undefined ? null : !session ? (
          <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-3 text-xs"><SignIn /></div>
        ) : (
          <button type="button" className="btn btn-primary w-full" disabled={busy !== null || !recipes.length || !planned.length} onClick={() => void ask()}>
            {busy === 'ai' ? 'AI zostavuje týždeň… (do 1 min)' : proposal ? 'Zostaviť znova' : 'Zostaviť týždeň z chladničky'}
          </button>
        )}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </section>

      <section className="min-w-0 space-y-4">
        {!proposal ? (
          <div className="card p-6 text-sm text-stone-500">Návrh týždňa sa zobrazí tu. Pri každom jedle uvidíte, čo z chladničky minie, a 2–3 alternatívy.</div>
        ) : (
          <>
            <div className="card space-y-3 p-4">
              {proposal.summary && <p className="text-sm leading-relaxed">{proposal.summary}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void apply()}>{busy === 'apply' ? 'Prepočítavam…' : 'Použiť ako týždenný plán'}</button>
                <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => setProposal(null)}>Zahodiť návrh</button>
              </div>
              <p className="text-xs text-stone-500">Jedlá sa v pláne zamknú; košík sa prepočíta bez surovín, ktoré máte doma.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {DAY_LABEL.map((label, day) => {
                const daySlots = planned.filter((s) => s.day === day);
                if (!daySlots.length) return null;
                return (
                  <div key={label} className="card overflow-hidden">
                    <h2 className="border-b border-stone-100 bg-stone-50/60 px-3 py-2 text-sm font-bold">{label}</h2>
                    <ul className="divide-y divide-stone-100">
                      {daySlots.map((s) => {
                        const choice = choices.get(slotKey(s.day, s.meal));
                        const recipe = choice ? byId.get(choice.recipe_id) : undefined;
                        const uses = recipe ? fromFridge(recipe, home) : [];
                        return (
                          <li key={s.meal} className="space-y-1 px-3 py-2.5 text-xs">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">{MEAL_LABEL[s.meal]}</span>
                            {!choice || !recipe ? <p className="text-stone-500">AI nevybrala – doplní ho bežný plánovač.</p> : (
                              <>
                                <p className="text-sm font-medium leading-snug">{recipe.name}</p>
                                <p className="text-stone-500">{recipe.kcal} kcal · B {recipe.protein} g · {recipe.prepMinutes} min · {eur(recipe.cost * settings.people)}</p>
                                {uses.length > 0 && <p className="text-emerald-700">Z chladničky: {uses.join(', ')}</p>}
                                {choice.reason && <p className="text-stone-600">{choice.reason}</p>}
                                {choice.alternatives.some((id) => byId.has(id)) && (
                                  <div className="flex flex-wrap gap-1 pt-1">
                                    <span className="text-stone-400">Alternatívy:</span>
                                    {choice.alternatives.filter((id) => byId.has(id)).map((id) => (
                                      <button key={id} type="button" className="chip !px-2 !py-0.5" title={`${byId.get(id)!.kcal} kcal · ${eur(byId.get(id)!.cost * settings.people)}`} onClick={() => choose(choice, id)}>
                                        {byId.get(id)!.name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
