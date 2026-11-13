'use client';

import Link from 'next/link';
import { useState } from 'react';
import { amount, eur, slotKey } from '@/lib/client';
import { DAY_LABEL, MEAL_LABEL, type Plan, type PlanSlot, type Settings } from '@/lib/types';

interface Props {
  plan: Plan;
  settings: Settings;
  locks: string[];
  pending: string | null;
  onLock: (slot: PlanSlot) => void;
  onSwap: (slot: PlanSlot) => void;
  onFeedback: (slot: PlanSlot, value: number) => void;
}

const ICONS = {
  lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z',
  unlock: 'M7 11V7a5 5 0 0 1 9.9-1M5 11h14v10H5z',
  swap: 'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.3l7.8-7.8 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  ban: 'M4.9 4.9l14.2 14.2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
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
  const off = Math.abs(value - target) / target > 0.1;
  return (
    <span className={off ? 'font-semibold text-amber-700' : ''} title={`Cieľ ${target} ${unit}${off ? ' – mimo tolerancie ±10 %' : ''}`}>
      {label} {value} {unit}
    </span>
  );
}

function Meal({ slot, locked, busy, onLock, onSwap, onFeedback }: { slot: PlanSlot; locked: boolean; busy: boolean } & Pick<Props, 'onLock' | 'onSwap' | 'onFeedback'>) {
  const [open, setOpen] = useState(false);
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
        </div>
      </div>
      {open && (
        <div className="mt-2 rounded-xl bg-stone-50 p-3 text-xs">
          <div className="mb-2 flex flex-wrap gap-1">
            {slot.tags.map((tag) => <span key={tag} className="badge bg-white text-stone-600 ring-1 ring-stone-200">{tag}</span>)}
            <span className="badge bg-white text-stone-600 ring-1 ring-stone-200">{slot.source === 'llm' ? 'AI recept' : 'pravidlový recept'}</span>
          </div>
          <p className="font-semibold">Suroviny na 1 porciu</p>
          <ul className="mb-2 mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {slot.ingredients.map((ing) => <li key={ing.id} className="flex justify-between"><span>{ing.name}</span><span className="text-stone-500">{amount(ing.grams)}</span></li>)}
          </ul>
          <p className="font-semibold">Postup</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4">{slot.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
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

export function PlanView({ plan, settings, locks, pending, onLock, onSwap, onFeedback }: Props) {
  const ratio = Math.min(1, plan.cart.total / plan.budget);
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
        {plan.days.map((day, index) => (
          <section key={index} className="card overflow-hidden">
            <header className="border-b border-stone-100 bg-stone-50/60 px-3 py-2">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-bold">{DAY_LABEL[index]}</h2>
                <span className="text-sm font-semibold text-stone-700">{eur(day.cost)}</span>
              </div>
              <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-stone-500">
                <Macro label="" value={day.kcal} target={settings.kcal} unit="kcal" />
                <Macro label="B" value={day.protein} target={settings.protein} unit="g" />
                <Macro label="S" value={day.carbs} target={settings.carbs} unit="g" />
                <Macro label="T" value={day.fat} target={settings.fat} unit="g" />
              </p>
            </header>
            <ul className="divide-y divide-stone-100">
              {plan.slots.filter((s) => s.day === index).map((slot) => {
                const key = slotKey(slot.day, slot.meal);
                return <Meal key={key} slot={slot} locked={locks.includes(key)} busy={pending === key} onLock={onLock} onSwap={onSwap} onFeedback={onFeedback} />;
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
