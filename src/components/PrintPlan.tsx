'use client';

import { Fragment } from 'react';
import { amount, eur } from '@/lib/client';
import { dateOfDay } from '@/lib/hybridlog';
import { DAY_LABEL, MEALS, MEAL_LABEL, STORE_LABEL, type CartLine, type Plan, type PlanSlot } from '@/lib/types';

export interface PrintParts { week: boolean; cart: boolean; recipes: boolean }
export const PRINT_PARTS: PrintParts = { week: true, cart: true, recipes: true };

const persons = (n: number): string => `${n} ${n < 5 ? 'osoby' : 'osôb'}`;
const SHORT_DAY = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'];
/** Blank lines in empty cells and at the end of the shopping list, for writing by hand. */
const WRITE_LINES = 3;
const EXTRA_CART_LINES = 8;

/** Dates of the printed week: a plan made at the weekend is for the coming week. */
function dayDate(plan: Plan, day: number): Date {
  const made = new Date(plan.generatedAt);
  const weekend = made.getDay() === 0 || made.getDay() === 6;
  const base = new Date(made.getFullYear(), made.getMonth(), made.getDate() + (weekend ? 7 : 0));
  return new Date(`${dateOfDay(day, base)}T12:00:00`);
}
const short = (date: Date): string => `${date.getDate()}. ${date.getMonth() + 1}.`;
const quantity = (line: CartLine): string =>
  line.loose ? amount(line.packs * line.packGrams, line.liquid) : `${line.packs} × ${amount(line.packGrams, line.liquid)}`;

function Lines({ count }: { count: number }) {
  return <>{Array.from({ length: count }, (_, i) => <span key={i} className="block h-[6.5mm] border-b border-dotted border-stone-400" />)}</>;
}

/** The week as one landscape page: every meal of every day, planned or left blank to fill in by hand. */
function Week({ plan, people }: { plan: Plan; people: number }) {
  const slotAt = (day: number, meal: string) => plan.slots.find((s) => s.day === day && s.meal === meal);
  const first = dayDate(plan, 0);
  const last = dayDate(plan, 6);
  return (
    <section className="print-week">
      <header className="mb-2 flex items-baseline justify-between border-b-2 border-stone-900 pb-1">
        <h1 className="text-[15pt] font-bold">Jedálniček {short(first)} – {short(last)} {last.getFullYear()}</h1>
        <p className="text-[9pt] text-stone-600">
          {people > 1 ? `${persons(people)} · ` : ''}hodnoty na osobu · nákup {eur(plan.cart.total)} z {eur(plan.budget)}
        </p>
      </header>
      <table className="w-full table-fixed border-collapse text-[8.5pt] leading-snug">
        <colgroup><col className="w-[19mm]" />{DAY_LABEL.map((d) => <col key={d} />)}</colgroup>
        <thead>
          <tr>
            <th className="border border-stone-500 p-1" />
            {DAY_LABEL.map((label, day) => (
              <th key={label} className="border border-stone-500 bg-stone-100 p-1 text-left font-semibold">
                {label} <span className="font-normal text-stone-500">{short(dayDate(plan, day))}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MEALS.map((meal) => (
            <tr key={meal}>
              <th className="border border-stone-500 bg-stone-100 p-1 text-left align-top font-semibold">{MEAL_LABEL[meal]}</th>
              {DAY_LABEL.map((_, day) => {
                const slot = slotAt(day, meal);
                const leftover = slot && day > 0 && slotAt(day - 1, meal)?.recipeId === slot.recipeId;
                return (
                  <td key={day} className="h-[29mm] border border-stone-500 p-1 align-top">
                    {slot ? (
                      <>
                        <span className="block font-semibold">{slot.name}</span>
                        <span className="block text-[7.5pt] text-stone-600">
                          {leftover ? `zvyšok z ${SHORT_DAY[day - 1]}` : `${slot.prepMinutes} min`} · {slot.kcal} kcal · B {slot.protein} g
                        </span>
                      </>
                    ) : <Lines count={WRITE_LINES} />}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <th className="border border-stone-500 bg-stone-100 p-1 text-left align-top font-semibold">Spolu</th>
            {plan.days.map((d, day) => (
              <td key={day} className="border border-stone-500 p-1 align-top text-[7.5pt] text-stone-600">
                {d.kcal} kcal · B {d.protein} g<br />{eur(d.cost)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[7.5pt] text-stone-500">B = bielkoviny. Spolu počíta len naplánované jedlá; prázdne políčka si doplňte ručne.</p>
    </section>
  );
}

function Cart({ plan, pantry }: { plan: Plan; pantry: string[] }) {
  const stores = [...new Set(plan.cart.lines.map((l) => l.store))];
  return (
    <section className="print-page">
      <header className="mb-3 flex items-baseline justify-between border-b-2 border-stone-900 pb-1">
        <h1 className="text-[15pt] font-bold">Nákupný zoznam</h1>
        <p className="text-[9pt] text-stone-600">spolu {eur(plan.cart.total)}{plan.cart.savings > 0 ? ` · ušetríte ${eur(plan.cart.savings)}` : ''}</p>
      </header>
      <div className="columns-2 gap-[10mm] text-[9pt] leading-snug">
        {stores.map((store) => {
          const lines = plan.cart.lines.filter((l) => l.store === store);
          return (
            <div key={store} className="mb-3">
              <h2 className="flex justify-between border-b border-stone-500 font-bold break-after-avoid">
                <span>{STORE_LABEL[store]}</span><span>{eur(lines.reduce((a, l) => a + l.lineTotal, 0))}</span>
              </h2>
              {[...new Set(lines.map((l) => l.category))].map((category) => (
                <Fragment key={category}>
                  <h3 className="mt-1.5 text-[7.5pt] font-semibold uppercase tracking-wide text-stone-500 break-after-avoid">{category}</h3>
                  {lines.filter((l) => l.category === category).map((line) => (
                    <p key={line.ingredientId} className="flex items-start gap-1.5 py-0.5 break-inside-avoid">
                      <span className="mt-[1.5pt] inline-block h-[3mm] w-[3mm] shrink-0 border border-stone-700" />
                      <span className="min-w-0 flex-1">{line.name} <span className="text-stone-500">· {quantity(line)}</span></span>
                      <span className="shrink-0">{eur(line.lineTotal)}{line.isDeal ? ' akcia' : ''}</span>
                    </p>
                  ))}
                </Fragment>
              ))}
            </div>
          );
        })}
        <div className="mb-3 break-inside-avoid">
          <h2 className="border-b border-stone-500 font-bold">Doplniť ručne</h2>
          {Array.from({ length: EXTRA_CART_LINES }, (_, i) => (
            <p key={i} className="flex items-end gap-1.5">
              <span className="mb-[1pt] inline-block h-[3mm] w-[3mm] shrink-0 border border-stone-700" />
              <span className="block h-[6.5mm] flex-1 border-b border-dotted border-stone-400" />
            </p>
          ))}
        </div>
        {pantry.length > 0 && <p className="text-[8pt] text-stone-500 break-inside-avoid">Doma už máte: {pantry.join(', ')}</p>}
      </div>
    </section>
  );
}

function Recipe({ slot, uses, people }: { slot: PlanSlot; uses: PlanSlot[]; people: number }) {
  return (
    <article className="mb-[6mm] border-b border-stone-300 pb-[5mm] break-inside-avoid">
      <header className="flex items-baseline justify-between gap-4">
        <h2 className="text-[12pt] font-bold">{slot.name}</h2>
        <p className="shrink-0 text-[8pt] text-stone-600">
          {uses.map((u) => `${SHORT_DAY[u.day]} ${MEAL_LABEL[u.meal].toLowerCase()}`).join(', ')} · {slot.prepMinutes} min · {slot.kcal} kcal · B {slot.protein} g na osobu
        </p>
      </header>
      <div className="mt-1.5 grid grid-cols-[55mm_1fr] gap-[6mm] text-[9pt] leading-snug">
        <div>
          <p className="text-[7.5pt] font-semibold uppercase tracking-wide text-stone-500">Suroviny{people > 1 ? ` pre ${persons(people)}` : ''}</p>
          <ul>{slot.ingredients.map((i) => <li key={i.id} className="flex justify-between gap-2"><span>{i.name}</span><span className="shrink-0 text-stone-600">{amount(i.grams * people)}</span></li>)}</ul>
        </div>
        <div>
          <p className="text-[7.5pt] font-semibold uppercase tracking-wide text-stone-500">Postup</p>
          <ol className="list-decimal space-y-0.5 pl-4">
            {slot.steps.map((step, i) => <li key={i}>{step.startsWith('https://') ? `Pôvodný recept: ${step.replace(/^https:\/\/(www\.)?/, '')}` : step}</li>)}
          </ol>
        </div>
      </div>
    </article>
  );
}

function Recipes({ plan, people }: { plan: Plan; people: number }) {
  const byRecipe = new Map<number, PlanSlot[]>();
  for (const day of DAY_LABEL.keys()) {
    for (const meal of MEALS) {
      const slot = plan.slots.find((s) => s.day === day && s.meal === meal);
      if (slot) byRecipe.set(slot.recipeId, [...(byRecipe.get(slot.recipeId) ?? []), slot]);
    }
  }
  return (
    <section className="print-page">
      <header className="mb-3 border-b-2 border-stone-900 pb-1"><h1 className="text-[15pt] font-bold">Recepty</h1></header>
      {[...byRecipe.values()].map((uses) => <Recipe key={uses[0].recipeId} slot={uses[0]} uses={uses} people={people} />)}
    </section>
  );
}

/** What gets printed from the plan page; hidden on screen. */
export function PrintPlan({ plan, people, parts, pantry }: { plan: Plan; people: number; parts: PrintParts; pantry: string[] }) {
  return (
    <div className="hidden text-stone-900 print:block">
      {parts.week && <Week plan={plan} people={people} />}
      {parts.cart && plan.cart.lines.length > 0 && <Cart plan={plan} pantry={pantry} />}
      {parts.recipes && plan.slots.length > 0 && <Recipes plan={plan} people={people} />}
    </div>
  );
}
