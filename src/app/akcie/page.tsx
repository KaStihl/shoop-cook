'use client';

import { useEffect, useState } from 'react';
import { api, dateSk, eur } from '@/lib/client';
import { STORES, STORE_LABEL, type DealItem, type Store } from '@/lib/types';

interface DealsResponse {
  items: DealItem[];
  total: number;
  pageSize: number;
}

const STORE_STYLE: Record<Store, string> = { kaufland: 'bg-red-50 text-red-700', lidl: 'bg-blue-50 text-blue-700', billa: 'bg-yellow-50 text-yellow-800', tesco: 'bg-sky-50 text-sky-800' };

export default function DealsPage() {
  const [query, setQuery] = useState('');
  const [store, setStore] = useState<Store | ''>('');
  const [dealsOnly, setDealsOnly] = useState(true);
  const [mappedOnly, setMappedOnly] = useState(false);
  const [items, setItems] = useState<DealItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const url = (offset: number) =>
    `/api/deals?${new URLSearchParams({ q: query, store, deals: dealsOnly ? '1' : '0', mapped: mappedOnly ? '1' : '0', offset: String(offset) })}`;

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      api<DealsResponse>(url(0))
        .then((data) => { setItems(data.items); setTotal(data.total); setError(null); })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
    // `url` is derived from exactly these four filters.
  }, [query, store, dealsOnly, mappedOnly]);

  const more = async () => {
    setLoading(true);
    try {
      const data = await api<DealsResponse>(url(items.length));
      setItems((prev) => [...prev, ...data.items]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Načítanie zlyhalo.');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-4">
        <h1 className="text-lg font-bold">Ponuka tohto týždňa</h1>
        <input className="input" type="search" placeholder="Hľadať produkt, napr. kuracie prsia" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Hľadať produkt" />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`chip ${store === '' ? 'chip-on' : ''}`} onClick={() => setStore('')}>Všetky obchody</button>
          {STORES.map((s) => <button key={s} type="button" className={`chip ${store === s ? 'chip-on' : ''}`} onClick={() => setStore(s)}>{STORE_LABEL[s]}</button>)}
          <button type="button" aria-pressed={dealsOnly} className={`chip ${dealsOnly ? 'chip-on' : ''}`} onClick={() => setDealsOnly(!dealsOnly)}>Len akcie</button>
          <button type="button" aria-pressed={mappedOnly} className={`chip ${mappedOnly ? 'chip-on' : ''}`} onClick={() => setMappedOnly(!mappedOnly)}>Len suroviny na varenie</button>
        </div>
        <p className="text-xs text-stone-500" aria-live="polite">{loading ? 'Načítavam…' : `${total} položiek`}</p>
      </section>

      {error && <div role="alert" className="card border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {loading && !items.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-44" />)}</div>
      ) : !items.length && !error ? (
        <section className="card px-6 py-12 text-center text-sm text-stone-600">
          Nič sa nenašlo. Skúste iný výraz, vypnite filter „Len akcie“ alebo aktualizujte ponuku v časti Admin.
        </section>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {items.map((item) => (
            <li key={item.id} className="card flex flex-col p-3">
              <div className="mb-2 flex items-center justify-between gap-1">
                <span className={`badge ${STORE_STYLE[item.store]}`}>{STORE_LABEL[item.store]}</span>
                {item.dealPrice !== null && <span className="badge bg-red-600 text-white">−{Math.round((1 - item.dealPrice / item.price) * 100)} %</span>}
              </div>
              {item.image && <img src={item.image} alt="" loading="lazy" className="mx-auto mb-2 h-24 w-full object-contain" />}
              <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium leading-snug hover:underline">{item.name}</a>
              <p className="text-xs text-stone-500">{[item.brand, item.packText].filter(Boolean).join(' · ')}</p>
              <div className="mt-auto pt-2">
                <p className="text-lg font-bold">
                  {eur(item.dealPrice ?? item.price)}
                  {item.dealPrice !== null && <span className="ml-2 text-xs font-medium text-stone-400 line-through">{eur(item.price)}</span>}
                </p>
                <p className="text-xs text-stone-500">
                  {item.unitPrice !== null ? `${eur(item.unitPrice)}/kg·l` : 'jednotková cena neznáma'}
                  {item.validTo ? ` · do ${dateSk(item.validTo)}` : ''}
                </p>
                <p className="mt-1 text-[11px] text-stone-400">{item.ingredient ? `surovina: ${item.ingredient}` : 'nezaradené – nepoužíva sa v plánoch'}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {items.length < total && (
        <div className="text-center">
          <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => void more()}>{loading ? 'Načítavam…' : 'Načítať ďalšie'}</button>
        </div>
      )}
    </div>
  );
}
