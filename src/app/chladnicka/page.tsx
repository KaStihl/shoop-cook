'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { SignIn, useSession } from '@/components/HybridAuth';
import { amount, api, slotKey, useStored, type StoredPlan } from '@/lib/client';
import { inventWeek, mergeProposal, saveIdeas, weekSlots, type IdeaRecipe, type IdeaSlot, type WeekProposal, type WeekSlot } from '@/lib/fridge';
import { sanitizeSettings } from '@/lib/settings';
import { DAY_LABEL, DEFAULT_SETTINGS, MEAL_LABEL, type MetaResponse, type Plan, type RecipeListItem, type Settings } from '@/lib/types';

/** One invented recipe: what it takes from the fridge, what has to be bought, and the short method. */
function Idea({ idea, home, names }: { idea: IdeaRecipe; home: Set<string>; names: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  const buy = idea.ingredients.filter((i) => !home.has(i.id));
  const have = idea.ingredients.filter((i) => home.has(i.id));
  return (
    <div className="space-y-1">
      <button type="button" className="block text-left text-sm font-medium leading-snug" aria-expanded={open} onClick={() => setOpen(!open)}>{idea.name}</button>
      <p className="text-stone-500">{idea.prep_minutes} min · {idea.ingredients.length} {idea.ingredients.length < 5 ? 'suroviny' : 'surovín'} na 1 porciu</p>
      {have.length > 0 && <p className="text-emerald-700">Z chladničky: {have.map((i) => names.get(i.id) ?? i.id).join(', ')}</p>}
      {buy.length > 0 && <p className="text-stone-600">Dokúpiť: {buy.map((i) => names.get(i.id) ?? i.id).join(', ')}</p>}
      {open && (
        <div className="mt-1 rounded-lg bg-stone-50 p-2">
          <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {idea.ingredients.map((i) => <li key={i.id} className="flex justify-between"><span>{names.get(i.id) ?? i.id}</span><span className="text-stone-500">{amount(i.grams)}</span></li>)}
          </ul>
          <ol className="mt-2 list-decimal space-y-1 pl-4">{idea.steps.map((s, n) => <li key={n}>{s}</li>)}</ol>
        </div>
      )}
      {!open && <button type="button" className="text-stone-500 underline" onClick={() => setOpen(true)}>Suroviny a postup</button>}
    </div>
  );
}

/**
 * "Chladnička": say what is at home and let the AI coach invent new recipes for the week around it, with alternative
 * ideas per meal. What is at home is the same list as "Mám doma (nekupovať)" in the plan settings, so it never goes
 * into the cart. Taking the week over saves the chosen ideas as own recipes and locks them into the plan.
 */
export default function FridgePage() {
  const router = useRouter();
  const session = useSession();
  const [settings, setSettings, settingsReady] = useStored<Settings>('jedlokos.settings', DEFAULT_SETTINGS, sanitizeSettings);
  const [note, setNote] = useStored<string>('jedlokos.fridgeNote', '');
  const [wish, setWish] = useStored<string>('jedlokos.fridgeWish', '');
  const [proposal, setProposal] = useStored<WeekProposal | null>('jedlokos.fridgeIdeas', null);
  const [, setStoredPlan] = useStored<StoredPlan | null>('jedlokos.plan', null);
  const [ingredients, setIngredients] = useState<MetaResponse['ingredients']>([]);
  const [recipes, setRecipes] = useState<RecipeListItem[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<'ai' | 'apply' | null>(null);
  /** The one meal being re-invented, if any ("day:meal"). */
  const [renewing, setRenewing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MetaResponse>('/api/meta').then((meta) => setIngredients(meta.ingredients)).catch(() => setIngredients([]));
    api<RecipeListItem[]>('/api/recipes').then(setRecipes).catch(() => setRecipes([]));
    localStorage.removeItem('jedlokos.fridgeWeek'); // proposal format of the first version (library picks)
  }, []);

  const names = useMemo(() => new Map(ingredients.map((i) => [i.id, i.name])), [ingredients]);
  const home = useMemo(() => new Set(settings.pantry), [settings.pantry]);
  const ideas = useMemo(() => new Map((proposal?.recipes ?? []).map((r) => [r.key, r])), [proposal]);
  const q = query.trim().toLowerCase();
  const matches = q.length > 1 ? ingredients.filter((i) => !home.has(i.id) && i.name.toLowerCase().includes(q)).slice(0, 18) : [];
  const toggle = (id: string) => setSettings({ ...settings, pantry: home.has(id) ? settings.pantry.filter((p) => p !== id) : [...settings.pantry, id] });

  /**
   * Invents ideas for the given meal, or for every meal that is not locked; what stays is sent along so the new
   * ideas fit around it, and everything not replaced is kept as it is.
   */
  const ask = async (only?: WeekSlot) => {
    const planned = weekSlots(settings);
    const lockedSlots = (proposal?.slots ?? []).filter((s) => s.locked && planned.some((p) => p.day === s.day && p.meal === s.meal));
    const targets = only ? [only] : planned.filter((p) => !lockedSlots.some((s) => s.day === p.day && s.meal === p.meal));
    if (!targets.length) {
      setError('Všetky jedlá sú ponechané. Odomknite tie, ktoré chcete vymyslieť znova.');
      return;
    }
    // Context for the AI: the locked meals, and when renewing one meal also the rest of the week.
    const staying = (proposal?.slots ?? []).filter((s) => (only ? !(s.day === only.day && s.meal === only.meal) : s.locked));
    const keep = staying.map((s) => ({ slot: { day: s.day, meal: s.meal }, recipe: ideas.get(s.recipe) }))
      .filter((k): k is { slot: WeekSlot; recipe: IdeaRecipe } => Boolean(k.recipe));
    setBusy('ai');
    setRenewing(only ? slotKey(only.day, only.meal) : null);
    setError(null);
    try {
      const next = await inventWeek({ settings, ingredients, recipes, note, wish, only: targets, keep });
      setProposal(mergeProposal(proposal, next, targets));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setRenewing(null);
    }
  };

  const toggleLock = (choice: IdeaSlot) => {
    if (!proposal) return;
    setProposal({ ...proposal, slots: proposal.slots.map((s) => (s.day === choice.day && s.meal === choice.meal ? { ...s, locked: !s.locked } : s)) });
  };

  const choose = (choice: IdeaSlot, key: string) => {
    if (!proposal) return;
    setProposal({
      ...proposal,
      slots: proposal.slots.map((s) => (s.day === choice.day && s.meal === choice.meal ? { ...s, recipe: key, alternatives: [s.recipe, ...s.alternatives.filter((a) => a !== key)] } : s)),
    });
  };

  /** Saves the chosen ideas as own recipes, locks them into the plan and lets the planner fill anything left. */
  const apply = async () => {
    if (!proposal) return;
    setBusy('apply');
    setError(null);
    try {
      const used = [...new Set(proposal.slots.map((s) => s.recipe))].map((k) => ideas.get(k)).filter((r): r is IdeaRecipe => Boolean(r));
      const ids = await saveIdeas(used);
      const chosen = proposal.slots.filter((s) => ids.has(s.recipe));
      const slots = chosen.map((s) => ({ day: s.day, meal: s.meal, recipeId: ids.get(s.recipe)!, locked: true }));
      const plan = await api<Plan>('/api/plan', { method: 'POST', body: JSON.stringify({ settings: sanitizeSettings(settings), action: 'generate', slots, seed: Date.now() % 2147483647 }) });
      setStoredPlan({ plan, locks: chosen.map((s) => slotKey(s.day, s.meal)), seen: {} });
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
          <p className="text-xs text-stone-500">Zadajte, čo máte doma. AI pomocník vymyslí <b>nové recepty</b> na týždeň (mimo vašej knižnice) a ku každému jedlu ďalšie nápady. Tieto suroviny sa nedávajú do košíka (rovnaký zoznam ako „Mám doma“ v nastaveniach plánu).</p>
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
          <input className="input" placeholder="napr. ázijská kuchyňa, rýchle večere, viac bielkovín" value={wish} onChange={(e) => setWish(e.target.value)} maxLength={500} />
        </label>
        <p className="text-xs text-stone-500">Týždeň má {planned.length} jedál podľa nastavení plánu (dni, chody, diéta, čas prípravy).</p>
        {session === undefined ? null : !session ? (
          <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-3 text-xs"><SignIn /></div>
        ) : (
          <button type="button" className="btn btn-primary w-full" disabled={busy !== null || !ingredients.length || !planned.length} onClick={() => void ask()}>
            {busy === 'ai' && !renewing ? 'AI vymýšľa recepty… (1–2 min)' : proposal ? (proposal.slots.some((s) => s.locked) ? 'Vymyslieť znova neponechané jedlá' : 'Vymyslieť znova') : 'Vymyslieť týždeň z chladničky'}
          </button>
        )}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </section>

      <section className="min-w-0 space-y-4">
        {!proposal ? (
          <div className="card p-6 text-sm text-stone-500">Nápady na týždeň sa zobrazia tu: pri každom jedle nový recept, čo z chladničky minie, čo treba dokúpiť, a ďalšie nápady na výmenu.</div>
        ) : (
          <>
            <div className="card space-y-3 p-4">
              {proposal.summary && <p className="text-sm leading-relaxed">{proposal.summary}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void apply()}>{busy === 'apply' ? 'Ukladám recepty a prepočítavam…' : 'Použiť ako týždenný plán'}</button>
                <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => setProposal(null)}>Zahodiť nápady</button>
              </div>
              <p className="text-xs text-stone-500">Vybrané recepty sa uložia medzi vaše vlastné (záložka Recepty), v pláne sa zamknú a košík sa prepočíta bez surovín, ktoré máte doma. Gramáže sa pri uložení prepočítajú na rozumnú porciu.</p>
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
                        const idea = choice ? ideas.get(choice.recipe) : undefined;
                        return (
                          <li key={s.meal} className={`space-y-1 px-3 py-2.5 text-xs ${renewing === slotKey(s.day, s.meal) ? 'animate-pulse' : ''} ${choice?.locked ? 'bg-brand-50/40' : ''}`}>
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">{MEAL_LABEL[s.meal]}</span>
                              {choice && idea && (
                                <span className="flex gap-1">
                                  <button type="button" aria-pressed={Boolean(choice.locked)} className={`chip !px-2 !py-0.5 ${choice.locked ? 'chip-on' : ''}`} onClick={() => toggleLock(choice)}>
                                    {choice.locked ? '🔒 Ponechané' : 'Ponechať'}
                                  </button>
                                  <button type="button" className="chip !px-2 !py-0.5" disabled={busy !== null || Boolean(choice.locked)} onClick={() => void ask({ day: s.day, meal: s.meal })}>
                                    {renewing === slotKey(s.day, s.meal) ? 'Vymýšľam…' : 'Nový nápad'}
                                  </button>
                                </span>
                              )}
                            </div>
                            {!choice || !idea ? <p className="text-stone-500">Bez nápadu – doplní ho bežný plánovač z knižnice.</p> : (
                              <>
                                <Idea idea={idea} home={home} names={names} />
                                {choice.alternatives.some((k) => ideas.has(k)) && (
                                  <div className="flex flex-wrap gap-1 pt-1">
                                    <span className="text-stone-400">Iné nápady:</span>
                                    {choice.alternatives.filter((k) => ideas.has(k)).map((k) => (
                                      <button key={k} type="button" className="chip !px-2 !py-0.5" onClick={() => choose(choice, k)}>{ideas.get(k)!.name}</button>
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
