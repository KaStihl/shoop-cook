'use client';

import Link from 'next/link';
import { useState } from 'react';
import { amount, dateSk, eur, useStored, type StoredPlan } from '@/lib/client';
import { STORE_LABEL, type CartLine } from '@/lib/types';

const quantity = (line: CartLine): string =>
  line.loose ? amount(line.packs * line.packGrams, line.liquid) : `${line.packs} × ${amount(line.packGrams, line.liquid)}`;

export default function CartPage() {
  const [stored, , ready] = useStored<StoredPlan | null>('jedlokos.plan', null);
  const [checked, setChecked] = useStored<string[]>('jedlokos.checked', []);
  const [copied, setCopied] = useState(false);

  if (!ready) return <div className="space-y-4" aria-busy="true"><div className="skeleton h-24" /><div className="skeleton h-72" /></div>;
  if (!stored || !stored.plan.cart.lines.length) {
    return (
      <section className="card grid place-items-center gap-3 px-6 py-16 text-center">
        <h1 className="text-xl font-bold">Košík je zatiaľ prázdny</h1>
        <p className="text-sm text-stone-600">Najprv si vygenerujte týždenný plán – nákupný zoznam sa vytvorí automaticky.</p>
        <Link href="/" className="btn btn-primary">Prejsť na plán</Link>
      </section>
    );
  }

  const { cart, generatedAt } = stored.plan;
  const stores = [...new Set(cart.lines.map((l) => l.store))];
  const toggle = (id: string) => setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const asText = () => stores.map((store) => {
    const lines = cart.lines.filter((l) => l.store === store);
    return `${STORE_LABEL[store]} (${eur(lines.reduce((a, l) => a + l.lineTotal, 0))})\n${lines.map((l) => `- ${l.name}: ${quantity(l)} – ${eur(l.lineTotal)}${l.isDeal ? ' (akcia)' : ''}${l.estimate ? ' (odhad ceny)' : ''}`).join('\n')}`;
  }).join('\n\n') + `\n\nSpolu: ${eur(cart.total)}`;

  const copy = async () => {
    await navigator.clipboard.writeText(asText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportCsv = () => {
    const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [
      ['Obchod', 'Kategória', 'Surovina', 'Produkt', 'Množstvo', 'Potrebné (g/ml)', 'Zvyšok (g/ml)', 'Jednotková cena €/kg', 'Cena €', 'Akcia', 'Odhad ceny'],
      ...cart.lines.map((l) => [STORE_LABEL[l.store], l.category, l.name, l.productName, quantity(l), l.neededGrams, l.leftoverGrams, l.unitPrice.toFixed(2), l.lineTotal.toFixed(2), l.isDeal ? 'áno' : 'nie', l.estimate ? 'áno' : 'nie']),
    ];
    const url = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(cell).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'jedlokos-nakup.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className="card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">Nákupný košík</h1>
            <p className="text-xs text-stone-500">Ceny z {dateSk(generatedAt)} · {checked.filter((id) => cart.lines.some((l) => l.ingredientId === id)).length}/{cart.lines.length} v košíku</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tracking-tight">{eur(cart.total)}</p>
            {cart.savings > 0 && <p className="text-xs font-semibold text-red-700">úspora oproti bežnej cene {eur(cart.savings)}</p>}
            {cart.estimateTotal > 0 && <p className="text-xs text-stone-500">z toho odhad {eur(cart.estimateTotal)}</p>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 print:hidden">
          <button type="button" className="btn btn-ghost" onClick={() => void copy()}>{copied ? 'Skopírované ✓' : 'Kopírovať ako text'}</button>
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>Tlačiť</button>
          <button type="button" className="btn btn-ghost" onClick={exportCsv}>Export CSV</button>
        </div>
      </section>

      {stores.map((store) => {
        const lines = cart.lines.filter((l) => l.store === store);
        const categories = [...new Set(lines.map((l) => l.category))];
        return (
          <section key={store} className="card overflow-hidden">
            <header className="flex items-baseline justify-between border-b border-stone-100 bg-stone-50/60 px-4 py-2.5">
              <h2 className="font-bold">{STORE_LABEL[store]}</h2>
              <span className="text-sm font-semibold">{eur(lines.reduce((a, l) => a + l.lineTotal, 0))}</span>
            </header>
            {categories.map((category) => (
              <div key={category}>
                <h3 className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{category}</h3>
                <ul className="divide-y divide-stone-100">
                  {lines.filter((l) => l.category === category).map((line) => {
                    const done = checked.includes(line.ingredientId);
                    return (
                      <li key={line.ingredientId}>
                        <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5">
                          <input type="checkbox" className="mt-1 h-4 w-4 accent-emerald-600" checked={done} onChange={() => toggle(line.ingredientId)} />
                          <span className={`min-w-0 flex-1 ${done ? 'text-stone-400 line-through' : ''}`}>
                            <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                              {line.name}
                              {line.isDeal && <span className="badge bg-red-50 text-red-700">akcia</span>}
                              {line.estimate && <span className="badge bg-stone-100 text-stone-600">odhad ceny</span>}
                            </span>
                            <span className="block text-xs text-stone-500">
                              {quantity(line)}{line.estimate ? '' : ` · ${line.productName}`} · {eur(line.unitPrice)}/{line.liquid ? 'l' : 'kg'}
                            </span>
                            <span className="block text-xs text-stone-400">
                              potrebné {amount(line.neededGrams, line.liquid)}{line.leftoverGrams > 0 ? ` · zvýši ${amount(line.leftoverGrams, line.liquid)}` : ''}
                            </span>
                          </span>
                          <span className="text-right text-sm font-semibold">
                            {eur(line.lineTotal)}
                            {line.savings > 0 && <span className="block text-xs font-medium text-red-700">−{eur(line.savings)}</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
