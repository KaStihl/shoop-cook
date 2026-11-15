'use client';

import { useState, type ReactNode } from 'react';
import { ALLERGENS, ALLERGEN_LABEL, DAY_LABEL, MEALS, MEAL_LABEL, STORES, STORE_LABEL, type DealMode, type Diet, type MealType, type MetaResponse, type Settings } from '@/lib/types';

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  ingredients: MetaResponse['ingredients'];
  busy: boolean;
  onGenerate: () => void;
}

const DIETS: [Diet, string][] = [['all', 'Všetko'], ['pescatarian', 'Bez mäsa, s rybou'], ['vegetarian', 'Vegetariánska'], ['vegan', 'Vegánska']];
const DEAL_MODES: [DealMode, string][] = [['off', 'Nezohľadniť'], ['prefer', 'Uprednostniť'], ['only', 'Len akcie']];

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={`chip ${on ? 'chip-on' : ''}`}>{children}</button>;
}

function Num({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <label className="block">
      <span className="label">{label}{suffix ? ` (${suffix})` : ''}</span>
      <input className="input" type="number" inputMode="decimal" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-stone-100 pt-3">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</legend>
      {children}
    </fieldset>
  );
}

export function SettingsPanel({ settings, onChange, ingredients, busy, onGenerate }: Props) {
  const [open, setOpen] = useState(false);
  const [pantryQuery, setPantryQuery] = useState('');
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  // Meals are chosen per day; the chips above the grid switch a meal on or off for the whole week at once.
  const setDayMeals = (dayMeals: MealType[][]) => onChange({ ...settings, dayMeals, meals: MEALS.filter((m) => dayMeals.some((day) => day.includes(m))) });
  const everyDay = (meal: MealType) => settings.dayMeals.every((day) => day.includes(meal));
  const toggleWeek = (meal: MealType) => {
    const on = !everyDay(meal);
    setDayMeals(settings.dayMeals.map((day) => (on ? MEALS.filter((m) => m === meal || day.includes(m)) : day.filter((m) => m !== meal))));
  };
  const toggleDay = (index: number, meal: MealType) => setDayMeals(settings.dayMeals.map((day, i) => (i === index ? MEALS.filter((m) => (m === meal ? !day.includes(m) : day.includes(m))) : day)));
  const pantryOptions = ingredients.filter((i) => settings.pantry.includes(i.id) || (pantryQuery.length > 1 && i.name.includes(pantryQuery.toLowerCase()))).slice(0, 24);

  return (
    <aside className="card sticky top-14 z-20 lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto print:hidden">
      <div className="flex items-center justify-between gap-2 p-3">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left lg:pointer-events-none" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="text-sm font-semibold">Nastavenia</span>
          <span className="truncate text-xs text-stone-500">
            {settings.people} os. · {settings.budget} € · {settings.dayMeals.reduce((acc, day) => acc + day.length, 0)} jedál
          </span>
          <span className="ml-auto text-stone-400 lg:hidden">{open ? '▲' : '▼'}</span>
        </button>
        <button type="button" className="btn btn-primary shrink-0 !py-2" disabled={busy} onClick={onGenerate}>{busy ? 'Počítam…' : 'Vygenerovať'}</button>
      </div>

      <div className={`${open ? 'block' : 'hidden'} max-h-[70vh] space-y-4 overflow-y-auto border-t border-stone-100 p-3 lg:block lg:max-h-none`}>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Počet osôb" value={settings.people} onChange={(v) => set('people', v)} />
          <Num label="Rozpočet na týždeň" suffix="€" value={settings.budget} step={5} onChange={(v) => set('budget', v)} />
        </div>

        <Section title="Stravovanie">
          <label className="block">
            <span className="label">Diéta</span>
            <select className="input" value={settings.diet} onChange={(e) => set('diet', e.target.value as Diet)}>
              {DIETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip on={settings.lactoseFree} onClick={() => set('lactoseFree', !settings.lactoseFree)}>Bez laktózy</Chip>
            <Chip on={settings.glutenFree} onClick={() => set('glutenFree', !settings.glutenFree)}>Bez lepku</Chip>
          </div>
          <span className="label mt-3">Vylúčiť alergény</span>
          <div className="flex flex-wrap gap-2">
            {ALLERGENS.map((a) => <Chip key={a} on={settings.allergens.includes(a)} onClick={() => set('allergens', toggle(settings.allergens, a))}>{ALLERGEN_LABEL[a]}</Chip>)}
          </div>
        </Section>

        <Section title="Jedlá a varenie">
          <div className="flex flex-wrap gap-2">
            {MEALS.map((m) => <Chip key={m} on={everyDay(m)} onClick={() => toggleWeek(m)}>{MEAL_LABEL[m]}</Chip>)}
          </div>
          <span className="label mt-3">Jedlá podľa dní</span>
          <table className="w-full text-center text-xs">
            <thead>
              <tr className="text-stone-500">
                <th className="py-1 text-left font-medium">Deň</th>
                {MEALS.map((m) => <th key={m} className="font-medium" title={MEAL_LABEL[m]}>{MEAL_LABEL[m].slice(0, 3)}</th>)}
              </tr>
            </thead>
            <tbody>
              {DAY_LABEL.map((label, day) => (
                <tr key={label} className="border-t border-stone-100">
                  <th scope="row" className="py-1 text-left font-medium">{label}</th>
                  {MEALS.map((m) => (
                    <td key={m}>
                      <input type="checkbox" className="h-4 w-4 accent-emerald-600" aria-label={`${label}: ${MEAL_LABEL[m]}`}
                        checked={settings.dayMeals[day].includes(m)} onChange={() => toggleDay(day, m)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Num label="Max. čas prípravy" suffix="min" value={settings.maxPrep} step={5} onChange={(v) => set('maxPrep', v)} />
            <Num label="Max. opakovaní jedla" value={settings.maxRepeats} onChange={(v) => set('maxRepeats', v)} />
          </div>
          <div className="mt-3">
            <Chip on={settings.batch} onClick={() => set('batch', !settings.batch)}>Varenie na 2 dni (obed, večera)</Chip>
          </div>
        </Section>

        <Section title="Obchody a akcie">
          <div className="flex flex-wrap gap-2">
            {STORES.map((s) => <Chip key={s} on={settings.stores.includes(s)} onClick={() => set('stores', toggle(settings.stores, s))}>{STORE_LABEL[s]}</Chip>)}
          </div>
          <span className="label mt-3">Nákupný košík</span>
          <div className="flex flex-wrap gap-2">
            <Chip on={settings.cartMode === 'split'} onClick={() => set('cartMode', 'split')}>Kombinácia – všade najlacnejšie</Chip>
            <Chip on={settings.cartMode === 'single'} onClick={() => set('cartMode', 'single')}>Všetko z jedného reťazca</Chip>
          </div>
          <span className="label mt-3">Akciové ceny</span>
          <div className="flex flex-wrap gap-2">
            {DEAL_MODES.map(([value, label]) => <Chip key={value} on={settings.dealMode === value} onClick={() => set('dealMode', value)}>{label}</Chip>)}
          </div>
          {settings.dealMode === 'prefer' && (
            <label className="mt-3 block">
              <span className="label">Váha akcií: {Math.round(settings.dealWeight * 100)} %</span>
              <input type="range" min={0} max={1} step={0.1} value={settings.dealWeight} className="w-full accent-emerald-600"
                onChange={(e) => set('dealWeight', Number(e.target.value))} />
            </label>
          )}
          {settings.dealMode === 'only' && <p className="mt-2 text-xs text-stone-500">Každé jedlo obsahuje aspoň jednu surovinu v akcii.</p>}
        </Section>

        <Section title="Mám doma (nekupovať)">
          <input className="input" placeholder="Hľadať surovinu…" value={pantryQuery} onChange={(e) => setPantryQuery(e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-2">
            {pantryOptions.map((i) => <Chip key={i.id} on={settings.pantry.includes(i.id)} onClick={() => set('pantry', toggle(settings.pantry, i.id))}>{i.name}</Chip>)}
            {!pantryOptions.length && <p className="text-xs text-stone-500">Zadajte aspoň 2 písmená názvu suroviny.</p>}
          </div>
        </Section>
      </div>
    </aside>
  );
}
