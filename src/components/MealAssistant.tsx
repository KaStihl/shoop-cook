'use client';

import { useState } from 'react';
import { SignIn, useSession } from './HybridAuth';
import { askAssistant, supabase, type ChatTurn, type Suggestion } from '@/lib/assistant';
import { eur } from '@/lib/client';
import { DAY_LABEL, MEAL_LABEL, type Plan, type PlanSlot, type RecipeListItem, type Settings } from '@/lib/types';

const QUICK = [
  'Sedí toto jedlo k môjmu cieľu?',
  'Navrhni výživnejšiu alternatívu',
  'Navrhni lacnejšiu alternatívu',
  'Ako doplniť bielkoviny?',
];

interface Turn extends ChatTurn { suggestions?: Suggestion[] }

/** AI nutrition coach for one planned meal ("Pondelok · Večera"), backed by HybridLog's coach setup. */
export function MealAssistant({ slot, plan, settings, recipes, onPick }: {
  slot: PlanSlot; plan: Plan; settings: Settings; recipes: RecipeListItem[]; onPick: (slot: PlanSlot, recipeId: number) => void;
}) {
  const session = useSession();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(recipes.map((r) => [r.id, r]));

  const ask = async (message: string) => {
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setDraft('');
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns((prev) => [...prev, { role: 'user', content: text }]);
    try {
      const answer = await askAssistant({ slot, plan, settings, recipes, message: text, history });
      setTurns((prev) => [...prev, { role: 'assistant', content: answer.reply, suggestions: answer.suggestions }]);
    } catch (e) {
      setTurns((prev) => prev.slice(0, -1));
      setDraft(text);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-violet-200 bg-violet-50/40 p-3 text-xs print:hidden">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold">AI pomocník · {DAY_LABEL[slot.day]} {MEAL_LABEL[slot.meal].toLowerCase()}</p>
        {session && <button type="button" className="text-stone-500 underline" onClick={() => void supabase().auth.signOut()}>Odhlásiť</button>}
      </div>
      {session === undefined ? <p className="text-stone-500">Načítavam…</p> : !session ? <SignIn /> : (
        <>
          {turns.length > 0 && (
            <ul className="space-y-2">
              {turns.map((turn, i) => (
                <li key={i} className={turn.role === 'user' ? 'ml-6 rounded-lg bg-white px-2 py-1.5 ring-1 ring-stone-200' : 'mr-2'}>
                  <p className="whitespace-pre-line leading-relaxed">{turn.content}</p>
                  {turn.suggestions?.map((s) => {
                    const recipe = byId.get(s.recipe_id);
                    if (!recipe) return null;
                    return (
                      <div key={s.recipe_id} className="mt-1.5 flex items-start justify-between gap-2 rounded-lg bg-white p-2 ring-1 ring-violet-200">
                        <span className="min-w-0">
                          <span className="block font-semibold">{recipe.name}</span>
                          <span className="block text-stone-500">{recipe.kcal} kcal · B {recipe.protein} g · {eur(recipe.cost)} / porcia</span>
                          <span className="block text-stone-600">{s.reason}</span>
                        </span>
                        <button type="button" className="btn btn-primary shrink-0" onClick={() => onPick(slot, recipe.id)}>Použiť</button>
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
          )}
          {busy && <p className="animate-pulse text-stone-500">Premýšľam…</p>}
          {!turns.length && (
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((q) => <button key={q} type="button" className="chip" disabled={busy} onClick={() => void ask(q)}>{q}</button>)}
            </div>
          )}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(draft); }}>
            <input className="input min-w-0 flex-1" placeholder="Opýtajte sa na toto jedlo…" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Otázka pre AI pomocníka" maxLength={1000} />
            <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>Poslať</button>
          </form>
          {error && <p className="text-red-700">{error}</p>}
        </>
      )}
    </div>
  );
}
