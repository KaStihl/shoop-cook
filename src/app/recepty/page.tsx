'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { amount, api, eur, slotKey, useStored, type StoredPlan } from '@/lib/client';
import { sanitizeSettings } from '@/lib/settings';
import {
  DAY_LABEL, DEFAULT_SETTINGS, KIND_LABEL, MEAL_LABEL, SOURCE_LABEL,
  type MealType, type Plan, type RecipeKind, type RecipeListItem, type Settings,
} from '@/lib/types';

const KINDS: RecipeKind[] = ['main', 'breakfast', 'snack'];
const MEALS_OF: Record<RecipeKind, MealType[]> = { breakfast: ['breakfast'], main: ['lunch', 'dinner'], snack: ['snack'] };
const SOURCES = ['own', 'web', 'yummybox', 'llm', 'rule'];
const PAGE = 30;
const EMPTY_OWN = { name: '', portions: 4, prepMinutes: 30, ingredients: '', steps: '' };

function RecipeCard({ recipe, onPlan, onFeedback, onDelete }: {
  recipe: RecipeListItem;
  onPlan: (recipe: RecipeListItem, day: number, meal: MealType) => Promise<void>;
  onFeedback: (recipe: RecipeListItem, value: number) => void;
  onDelete: (recipe: RecipeListItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(0);
  const [meal, setMeal] = useState<MealType>(MEALS_OF[recipe.kind][0]);
  const [busy, setBusy] = useState(false);
  const plan = async () => {
    setBusy(true);
    await onPlan(recipe, day, meal);
    setBusy(false);
  };
  return (
    <li className="card p-3">
      <button type="button" className="w-full text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold">{recipe.name}</span>
          {recipe.feedback > 0 && <span className="badge bg-emerald-50 text-emerald-700">obľúbené</span>}
          {recipe.feedback < 0 && <span className="badge bg-stone-100 text-stone-500">nenavrhovať</span>}
          {recipe.hasDeal && <span className="badge bg-red-50 text-red-700">akcia</span>}
        </span>
        <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-stone-500">
          <span>{KIND_LABEL[recipe.kind]}</span><span>{SOURCE_LABEL[recipe.source] ?? recipe.source}</span>
          <span>{recipe.kcal} kcal</span><span>B {recipe.protein} g</span><span>{recipe.prepMinutes} min</span><span>{eur(recipe.cost)} / porcia</span>
        </span>
      </button>
      {open && (
        <div className="mt-3 border-t border-stone-100 pt-3 text-sm">
          <div className="mb-2 flex flex-wrap gap-1">{recipe.tags.map((tag) => <span key={tag} className="badge bg-stone-100 text-stone-600">{tag}</span>)}</div>
          <p className="text-xs font-semibold">Suroviny na 1 porciu</p>
          <ul className="mb-2 mt-1 grid grid-cols-1 gap-x-6 text-xs sm:grid-cols-2">
            {recipe.ingredients.map((ing) => <li key={ing.id} className="flex justify-between"><span>{ing.name}</span><span className="text-stone-500">{amount(ing.grams)}</span></li>)}
          </ul>
          <ol className="list-decimal space-y-1 pl-4 text-xs">
            {recipe.steps.map((step, i) => (
              <li key={i}>{step.startsWith('https://')
                ? <a className="font-semibold text-emerald-700 underline" href={step} target="_blank" rel="noreferrer">Pôvodný recept a postup na {new URL(step).hostname.replace(/^www\./, '')}</a>
                : step}</li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="label">Deň</span>
              <select className="input !w-auto" value={day} onChange={(e) => setDay(Number(e.target.value))}>
                {DAY_LABEL.map((label, i) => <option key={label} value={i}>{label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Jedlo</span>
              <select className="input !w-auto" value={meal} onChange={(e) => setMeal(e.target.value as MealType)}>
                {MEALS_OF[recipe.kind].map((m) => <option key={m} value={m}>{MEAL_LABEL[m]}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void plan()}>{busy ? 'Prepočítavam…' : 'Zaradiť do plánu'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => onFeedback(recipe, recipe.feedback > 0 ? 0 : 1)}>{recipe.feedback > 0 ? 'Zrušiť obľúbené' : 'Obľúbené'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => onFeedback(recipe, recipe.feedback < 0 ? 0 : -1)}>{recipe.feedback < 0 ? 'Znova navrhovať' : 'Nenavrhovať'}</button>
            {(recipe.source === 'own' || recipe.source === 'web') && <button type="button" className="btn btn-ghost text-red-700" onClick={() => onDelete(recipe)}>Zmazať</button>}
          </div>
        </div>
      )}
    </li>
  );
}

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<RecipeListItem[] | null>(null);
  const [settings] = useStored<Settings>('jedlokos.settings', DEFAULT_SETTINGS, sanitizeSettings);
  const [stored, setStored] = useStored<StoredPlan | null>('jedlokos.plan', null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<RecipeKind | 'all'>('all');
  const [source, setSource] = useState('all');
  const [shown, setShown] = useState(PAGE);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState<'none' | 'url' | 'own'>('none');
  const [url, setUrl] = useState('');
  const [newKind, setNewKind] = useState<RecipeKind>('main');
  const [own, setOwn] = useState(EMPTY_OWN);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => api<RecipeListItem[]>('/api/recipes').then(setRecipes).catch((e: Error) => {
    setRecipes([]);
    setMessage({ ok: false, text: e.message });
  }), []);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of recipes ?? []) out[r.source] = (out[r.source] ?? 0) + 1;
    return out;
  }, [recipes]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rank = (r: RecipeListItem) => SOURCES.indexOf(r.source);
    return (recipes ?? [])
      .filter((r) => (kind === 'all' || r.kind === kind) && (source === 'all' || r.source === source)
        && (!q || r.name.toLowerCase().includes(q) || r.ingredients.some((i) => i.name.includes(q))))
      .sort((a, b) => b.feedback - a.feedback || rank(a) - rank(b) || a.name.localeCompare(b.name, 'sk'));
  }, [recipes, query, kind, source]);

  const submit = async (body: object, done: string) => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await api<{ name: string; recognised?: number; total?: number }>('/api/recipes', { method: 'POST', body: JSON.stringify(body) });
      setMessage({ ok: true, text: `${done}: ${result.name}${result.total ? ` (rozpoznaných ${result.recognised} z ${result.total} surovín)` : ''}.` });
      setUrl('');
      setOwn(EMPTY_OWN);
      setForm('none');
      await load();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Recept sa nepodarilo uložiť.' });
    }
    setSaving(false);
  };

  /** Puts the recipe into one slot, keeps every other meal as it is and lets the server recompute portions and the cart. */
  const addToPlan = async (recipe: RecipeListItem, day: number, meal: MealType) => {
    setMessage(null);
    if (!settings.meals.includes(meal)) {
      setMessage({ ok: false, text: `${MEAL_LABEL[meal]} nemáte v nastaveniach plánu zapnuté.` });
      return;
    }
    const key = slotKey(day, meal);
    const slots = stored
      ? stored.plan.slots.map((s) => ({ day: s.day, meal: s.meal, recipeId: s.day === day && s.meal === meal ? recipe.id : s.recipeId, locked: true }))
      : [{ day, meal, recipeId: recipe.id, locked: true }];
    try {
      const plan = await api<Plan>('/api/plan', { method: 'POST', body: JSON.stringify({ settings, action: 'generate', slots, seed: Date.now() % 2147483647 }) });
      if (plan.slots.find((s) => s.day === day && s.meal === meal)?.recipeId !== recipe.id) throw new Error('Recept nevyhovuje aktuálnym nastaveniam (diéta, alergény alebo čas prípravy).');
      setStored({ plan, locks: [...new Set([...(stored?.locks ?? []), key])], seen: stored?.seen ?? {} });
      setMessage({ ok: true, text: `${recipe.name} je v pláne: ${DAY_LABEL[day]}, ${MEAL_LABEL[meal].toLowerCase()}. Porcie aj košík sú prepočítané (nákup ${eur(plan.cart.total)}).` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Plán sa nepodarilo prepočítať.' });
    }
  };

  const feedback = async (recipe: RecipeListItem, value: number) => {
    try {
      await api('/api/recipes/feedback', { method: 'POST', body: JSON.stringify({ id: recipe.id, value }) });
      setRecipes((prev) => prev?.map((r) => (r.id === recipe.id ? { ...r, feedback: value } : r)) ?? prev);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Hodnotenie sa nepodarilo uložiť.' });
    }
  };

  const remove = async (recipe: RecipeListItem) => {
    if (!window.confirm(`Zmazať recept „${recipe.name}“?`)) return;
    try {
      await api('/api/recipes', { method: 'POST', body: JSON.stringify({ action: 'delete', id: recipe.id }) });
      await load();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Recept sa nepodarilo zmazať.' });
    }
  };

  const kindPicker = (
    <label className="block">
      <span className="label">Typ jedla</span>
      <select className="input" value={newKind} onChange={(e) => setNewKind(e.target.value as RecipeKind)}>
        {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
      </select>
    </label>
  );

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">Recepty</h1>
            <p className="text-sm text-stone-600">Z týchto receptov sa skladá týždenný plán. Najprv jedlá, až z nich nákupný košík.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className={`btn ${form === 'url' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setForm(form === 'url' ? 'none' : 'url')}>Pridať z URL</button>
            <button type="button" className={`btn ${form === 'own' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setForm(form === 'own' ? 'none' : 'own')}>Vlastný recept</button>
          </div>
        </div>

        {form === 'url' && (
          <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); void submit({ action: 'url', url, kind: newKind }, 'Recept pridaný'); }}>
            <label className="block">
              <span className="label">Adresa receptu (varecha.sk, yummybox.sk a iné weby so štruktúrovaným receptom)</span>
              <input className="input" type="url" required placeholder="https://varecha.pravda.sk/recepty/…" value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            {kindPicker}
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Načítavam…' : 'Načítať suroviny'}</button>
          </form>
        )}

        {form === 'own' && (
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void submit({ action: 'own', kind: newKind, recipe: own }, 'Recept uložený'); }}>
            <label className="block sm:col-span-2">
              <span className="label">Názov</span>
              <input className="input" required minLength={3} value={own.name} onChange={(e) => setOwn({ ...own, name: e.target.value })} />
            </label>
            {kindPicker}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Počet porcií</span>
                <input className="input" type="number" min={1} max={20} value={own.portions} onChange={(e) => setOwn({ ...own, portions: Number(e.target.value) })} />
              </label>
              <label className="block">
                <span className="label">Príprava (min)</span>
                <input className="input" type="number" min={3} max={180} value={own.prepMinutes} onChange={(e) => setOwn({ ...own, prepMinutes: Number(e.target.value) })} />
              </label>
            </div>
            <label className="block">
              <span className="label">Suroviny – jedna na riadok, pre všetky porcie</span>
              <textarea className="input h-36 font-mono text-xs" required value={own.ingredients} onChange={(e) => setOwn({ ...own, ingredients: e.target.value })}
                placeholder={'500 g kuracie prsia\n300 g ryža\n2 ks paprika\n1 PL olej'} />
            </label>
            <label className="block">
              <span className="label">Postup – jeden krok na riadok (nepovinné)</span>
              <textarea className="input h-36 text-xs" value={own.steps} onChange={(e) => setOwn({ ...own, steps: e.target.value })} />
            </label>
            <div className="sm:col-span-2"><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Ukladám…' : 'Uložiť recept'}</button></div>
          </form>
        )}

        {message && (
          <p role={message.ok ? 'status' : 'alert'} className={`mt-3 rounded-xl p-3 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>{message.text}</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <input className="input !w-full sm:!w-64" placeholder="Hľadať recept alebo surovinu…" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} aria-label="Hľadať recept" />
          <button type="button" className={`chip ${kind === 'all' ? 'chip-on' : ''}`} onClick={() => setKind('all')}>Všetky jedlá</button>
          {KINDS.map((k) => <button key={k} type="button" className={`chip ${kind === k ? 'chip-on' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`chip ${source === 'all' ? 'chip-on' : ''}`} onClick={() => setSource('all')}>Všetky zdroje ({recipes?.length ?? 0})</button>
          {SOURCES.filter((s) => counts[s]).map((s) => (
            <button key={s} type="button" className={`chip ${source === s ? 'chip-on' : ''}`} onClick={() => setSource(s)}>{SOURCE_LABEL[s]} ({counts[s]})</button>
          ))}
        </div>

        {!recipes ? (
          <div className="space-y-3" aria-busy="true" aria-label="Načítavam recepty">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-16" />)}</div>
        ) : !filtered.length ? (
          <p className="card p-6 text-center text-sm text-stone-600">Filtru nezodpovedá žiadny recept. Pridajte vlastný alebo ho načítajte z URL.</p>
        ) : (
          <>
            <ul className="grid gap-3 lg:grid-cols-2 lg:items-start">
              {filtered.slice(0, shown).map((recipe) => <RecipeCard key={recipe.id} recipe={recipe} onPlan={addToPlan} onFeedback={(r, v) => void feedback(r, v)} onDelete={(r) => void remove(r)} />)}
            </ul>
            {filtered.length > shown && <button type="button" className="btn btn-ghost w-full" onClick={() => setShown(shown + PAGE)}>Zobraziť ďalšie ({filtered.length - shown})</button>}
          </>
        )}
      </section>
    </div>
  );
}
