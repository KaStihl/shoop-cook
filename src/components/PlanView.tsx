'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { amount, eur, slotKey } from '@/lib/client';
import { dateOfDay, hybridLink, hybridText, toHybridMeal } from '@/lib/hybridlog';
import { DAY_LABEL, MEAL_LABEL, SOURCE_LABEL, kindOfMeal, type Plan, type PlanSlot, type RecipeListItem, type Settings } from '@/lib/types';

interface Props {
  plan: Plan;
  settings: Settings;
  locks: string[];
  pending: string | null;
  onLock: (slot: PlanSlot) => void;
  onSwap: (slot: PlanSlot) => void;
  onFeedback: (slot: PlanSlot, value: number) => void;
  /** Recipe library for the per-meal picker. */
  recipes: RecipeListItem[];
  onPick: (slot: PlanSlot, recipeId: number) => void;
  onUrl: (slot: PlanSlot, url: string) => void;
}

const ICONS = {
  lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z',
  unlock: 'M7 11V7a5 5 0 0 1 9.9-1M5 11h14v10H5z',
  swap: 'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.3l7.8-7.8 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  ban: 'M4.9 4.9l14.2 14.2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
  pick: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  log: 'M12 5v14M5 12h14M4 4h16v16H4z',
};

function IconButton({ icon, label, active, disabled, onClick }: { icon: keyof typeof ICONS; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-lg border transition disabled:opacity-40 ${active ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill={active && icon === 'heart' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={ICONS[icon]} />
      </svg>
    </button>
  );
}

function Macro({ label, value, target, unit }: { label: string; value: number; target: number; unit: string }) {
  const off = target > 0 && Math.abs(value - target) / target > 0.1;
  return (
    <span className={off ? 'font-semibold text-amber-700' : ''} title={`Cieľ ${target} ${unit}${off ? ' – mimo tolerancie ±10 %' : ''}`}>
      {label} {value} {unit}
    </span>
  );
}

/** Lets the user put a specific recipe into one meal: from the library or straight from a recipe URL. */
function Picker({ slot, recipes, busy, onPick, onUrl }: { slot: PlanSlot; busy: boolean } & Pick<Props, 'recipes' | 'onPick' | 'onUrl'>) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState('');
  const [url, setUrl] = useState('');
  const kind = kindOfMeal(slot.meal);
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => r.kind === kind && r.feedback >= 0 && r.id !== slot.recipeId && (!q || r.name.toLowerCase().includes(q) || r.ingredients.some((i) => i.name.includes(q))))
      .sort((a, b) => b.feedback - a.feedback || a.name.localeCompare(b.name, 'sk')).slice(0, 150);
  }, [recipes, kind, query, slot.recipeId]);
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-brand-200 bg-brand-50/40 p-3 text-xs print:hidden">
      <p className="font-semibold">Vlastný výber pre {MEAL_LABEL[slot.meal].toLowerCase()}</p>
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
        <input className="input" placeholder="Hľadať…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Hľadať recept" />
        <select className="input" value={chosen} onChange={(e) => setChosen(e.target.value)} aria-label="Recept z knižnice">
          <option value="">{options.length ? `Vyberte recept (${options.length})` : 'Žiadny recept nevyhovuje'}</option>
          {options.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.kcal} kcal · {eur(r.cost)}</option>)}
        </select>
        <button type="button" className="btn btn-primary" disabled={busy || !chosen} onClick={() => onPick(slot, Number(chosen))}>Použiť</button>
      </div>
      <form className="grid gap-2 sm:grid-cols-[1fr_auto]" onSubmit={(e) => { e.preventDefault(); onUrl(slot, url.trim()); }}>
        <input className="input" type="url" required placeholder="alebo adresa receptu: https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Adresa receptu" />
        <button type="submit" className="btn btn-ghost" disabled={busy}>Načítať z URL</button>
      </form>
    </div>
  );
}

function Meal({ slot, locked, busy, onLock, onSwap, onFeedback, recipes, onPick, onUrl }: { slot: PlanSlot; locked: boolean; busy: boolean } & Omit<Props, 'plan' | 'settings' | 'locks' | 'pending'>) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  return (
    <li className={`px-3 py-2.5 ${busy ? 'animate-pulse' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">{MEAL_LABEL[slot.meal]}</span>
          <span className="block text-sm font-medium leading-snug">{slot.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
            <span>{slot.kcal} kcal</span><span>B {slot.protein} g</span><span>{slot.prepMinutes} min</span><span>{eur(slot.cost)}</span>
            {slot.hasDeal && <span className="badge bg-red-50 text-red-700">akcia</span>}
          </span>
        </button>
        <div className="flex shrink-0 gap-1 print:hidden">
          <IconButton icon={locked ? 'lock' : 'unlock'} label={locked ? 'Odomknúť jedlo' : 'Zamknúť jedlo'} active={locked} onClick={() => onLock(slot)} />
          <IconButton icon="swap" label="Vymeniť jedlo" disabled={busy || locked} onClick={() => onSwap(slot)} />
          <IconButton icon="pick" label="Vybrať vlastný recept" active={picking} onClick={() => setPicking(!picking)} />
        </div>
      </div>
      {picking && <Picker slot={slot} recipes={recipes} busy={busy} onPick={onPick} onUrl={onUrl} />}
      {open && (
        <div className="mt-2 rounded-xl bg-stone-50 p-3 text-xs">
          <div className="mb-2 flex flex-wrap gap-1">
            {slot.tags.map((tag) => <span key={tag} className="badge bg-white text-stone-600 ring-1 ring-stone-200">{tag}</span>)}
            <span className="badge bg-white text-stone-600 ring-1 ring-stone-200">{SOURCE_LABEL[slot.source] ?? slot.source}</span>
          </div>
          <p className="font-semibold">Suroviny na 1 porciu</p>
          <ul className="mb-2 mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {slot.ingredients.map((ing) => <li key={ing.id} className="flex justify-between"><span>{ing.name}</span><span className="text-stone-500">{amount(ing.grams)}</span></li>)}
          </ul>
          <p className="font-semibold">Postup</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4">{slot.steps.map((step, i) => (
            <li key={i}>{step.startsWith('https://') ? <a className="font-semibold text-emerald-700 underline" href={step} target="_blank" rel="noreferrer">Pôvodný recept a postup na {new URL(step).hostname.replace(/^www\./, '')}</a> : step}</li>
          ))}</ol>
          <p className="mt-2 text-stone-500">S {slot.carbs} g · T {slot.fat} g · soľ a korenie podľa chuti</p>
          <div className="mt-2 flex gap-2 print:hidden">
            <IconButton icon="heart" label="Páči sa mi" active={slot.feedback > 0} onClick={() => onFeedback(slot, slot.feedback > 0 ? 0 : 1)} />
            <IconButton icon="ban" label="Už nenavrhovať" disabled={busy} onClick={() => onFeedback(slot, -1)} />
          </div>
        </div>
      )}
    </li>
  );
}

/** Sends a day's planned meals to HybridLog: an import link plus a text copy as a fallback. */
function HybridLogPanel({ day, slots }: { day: number; slots: PlanSlot[] }) {
  const [date, setDate] = useState(() => dateOfDay(day));
  const [chosen, setChosen] = useState(() => slots.map((s) => s.meal));
  const [copied, setCopied] = useState(false);
  const picked = slots.filter((s) => chosen.includes(s.meal));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hybridText(picked));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-2 border-b border-stone-100 bg-brand-50/40 px-3 py-2.5 text-xs print:hidden">
      <p className="font-semibold">Zapísať do HybridLogu</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {slots.map((s) => (
          <label key={s.meal} className="flex items-center gap-1">
            <input type="checkbox" className="accent-emerald-600" checked={chosen.includes(s.meal)}
              onChange={() => setChosen(chosen.includes(s.meal) ? chosen.filter((m) => m !== s.meal) : [...chosen, s.meal])} />
            {MEAL_LABEL[s.meal]}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="label">Dátum</span>
          <input type="date" className="input !w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {picked.length > 0 && date ? (
          <a className="btn btn-primary" href={hybridLink(picked.map((s) => toHybridMeal(s, date)))} target="_blank" rel="noreferrer" onClick={() => void copy()}>Otvoriť HybridLog</a>
        ) : <span className="btn btn-primary pointer-events-none opacity-50">Otvoriť HybridLog</span>}
        <button type="button" className="btn btn-ghost" disabled={!picked.length} onClick={() => void copy()}>{copied ? 'Skopírované' : 'Kopírovať text'}</button>
      </div>
      <p className="text-stone-500">Porcie sú na 1 osobu. Jedlá sa pošlú s gramážou a makrami; text ostane v schránke ako záloha.</p>
    </div>
  );
}

export function PlanView({ plan, settings, locks, pending, onLock, onSwap, onFeedback, recipes, onPick, onUrl }: Props) {
  const ratio = Math.min(1, plan.cart.total / plan.budget);
  const [logDay, setLogDay] = useState<number | null>(null);
  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-stone-500">Nákup na týždeň pre {settings.people} {settings.people === 1 ? 'osobu' : settings.people < 5 ? 'osoby' : 'osôb'}</p>
            <p className="text-2xl font-bold tracking-tight">
              {eur(plan.cart.total)} <span className="text-sm font-medium text-stone-500">z {eur(plan.budget)}</span>
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {plan.cart.savings > 0 && <span className="badge bg-red-50 px-2 py-1 text-red-700">ušetríte {eur(plan.cart.savings)}</span>}
            <Link href="/kosik" className="btn btn-ghost print:hidden">Zobraziť košík</Link>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${plan.feasible ? 'bg-brand-500' : 'bg-red-500'}`} style={{ width: `${ratio * 100}%` }} />
        </div>
        {plan.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-amber-800">
            {plan.warnings.map((warning) => <li key={warning} className="rounded-lg bg-amber-50 px-2 py-1">{warning}</li>)}
          </ul>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {plan.days.map((day, index) => {
          const slots = plan.slots.filter((s) => s.day === index);
          const share = day.share ?? 1;
          return (
          <section key={index} className="card overflow-hidden">
            <header className="border-b border-stone-100 bg-stone-50/60 px-3 py-2">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-bold">{DAY_LABEL[index]}</h2>
                <span className="flex items-center gap-2 text-sm font-semibold text-stone-700">
                  {eur(day.cost)}
                  {slots.length > 0 && <IconButton icon="log" label="Zapísať deň do HybridLogu" active={logDay === index} onClick={() => setLogDay(logDay === index ? null : index)} />}
                </span>
              </div>
              <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-stone-500">
                <Macro label="" value={day.kcal} target={Math.round(settings.kcal * share)} unit="kcal" />
                <Macro label="B" value={day.protein} target={Math.round(settings.protein * share)} unit="g" />
                <Macro label="S" value={day.carbs} target={Math.round(settings.carbs * share)} unit="g" />
                <Macro label="T" value={day.fat} target={Math.round(settings.fat * share)} unit="g" />
              </p>
            </header>
            {logDay === index && <HybridLogPanel day={index} slots={slots} />}
            {!slots.length && <p className="px-3 py-4 text-xs text-stone-500">Na tento deň nie je naplánované žiadne jedlo.</p>}
            <ul className="divide-y divide-stone-100">
              {slots.map((slot) => {
                const key = slotKey(slot.day, slot.meal);
                return <Meal key={key} slot={slot} locked={locks.includes(key)} busy={pending === key} onLock={onLock} onSwap={onSwap} onFeedback={onFeedback} recipes={recipes} onPick={onPick} onUrl={onUrl} />;
              })}
            </ul>
          </section>
          );
        })}
      </div>
    </div>
  );
}
