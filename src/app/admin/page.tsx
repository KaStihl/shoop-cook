'use client';

import { useCallback, useEffect, useState } from 'react';
import { ReceiptUpload } from '@/components/ReceiptUpload';
import { api } from '@/lib/client';
import { STORES, STORE_LABEL, type Freshness, type Store } from '@/lib/types';

interface LogRow {
  id: number;
  store: Store;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  itemCount: number;
  newCount: number;
  message: string | null;
}

interface Status {
  stores: { store: Store; total: number; deals: number; mapped: number; lastScrape: string | null; last: LogRow | null }[];
  unmapped: number;
  recipes: number;
  logs: LogRow[];
  running: boolean;
  lines: string[];
  freshness: Freshness;
  hasLlm: boolean;
}

interface Ingredient {
  id: string;
  name: string;
  category: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  nutritionSource: string;
  baselinePrice: number | null;
  baselinePack: number;
}

const STATUS_LABEL: Record<string, [string, string]> = {
  ok: ['aktualizované', 'bg-brand-50 text-brand-700'], import: ['import', 'bg-brand-50 text-brand-700'], seed: ['ukážkové dáta', 'bg-stone-100 text-stone-600'],
  running: ['prebieha', 'bg-blue-50 text-blue-700'], blocked: ['blokované', 'bg-amber-50 text-amber-800'], empty: ['bez dát', 'bg-amber-50 text-amber-800'],
  error: ['chyba', 'bg-red-50 text-red-700'],
};
const SOURCE_LABEL: Record<string, string> = { builtin: 'vstavané', off: 'Open Food Facts', manual: 'manuálne', none: 'chýba' };
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sk-SK', { dateStyle: 'short', timeStyle: 'short' }) : 'nikdy');

function IngredientRow({ item, onSaved }: { item: Ingredient; onSaved: () => void }) {
  const [draft, setDraft] = useState(item);
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const dirty = JSON.stringify(draft) !== JSON.stringify(item);
  const field = (key: 'kcal' | 'protein' | 'carbs' | 'fat' | 'baselinePrice', width = 'w-16') => (
    <td className="px-1 py-1">
      <input className={`input !px-2 !py-1 ${width}`} type="number" step="0.1" min="0" aria-label={`${item.name} ${key}`} value={draft[key] ?? ''}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value === '' ? null : Number(e.target.value) })} />
    </td>
  );
  const save = async () => {
    setState('saving');
    try {
      await api('/api/admin/ingredients', { method: 'PUT', body: JSON.stringify(draft) });
      setState('idle');
      onSaved();
    } catch {
      setState('error');
    }
  };
  return (
    <tr className="border-t border-stone-100">
      <td className="px-2 py-1 text-sm">{item.name}<span className="block text-[11px] text-stone-400">{SOURCE_LABEL[item.nutritionSource] ?? item.nutritionSource}</span></td>
      {field('kcal')}{field('protein')}{field('carbs')}{field('fat')}{field('baselinePrice', 'w-20')}
      <td className="px-1 py-1">
        <button type="button" className="btn btn-ghost !px-2 !py-1 text-xs" disabled={!dirty || state === 'saving'} onClick={() => void save()}>
          {state === 'saving' ? '…' : state === 'error' ? 'Chyba' : 'Uložiť'}
        </button>
      </td>
    </tr>
  );
}

export default function AdminPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [importStore, setImportStore] = useState<Store>('kaufland');
  const [importFormat, setImportFormat] = useState<'csv' | 'json'>('csv');
  const [importText, setImportText] = useState('');
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const load = useCallback(() => api<Status>('/api/admin/status').then(setStatus).catch((e: Error) => setError(e.message)), []);
  const loadIngredients = useCallback(() => api<Ingredient[]>('/api/admin/ingredients').then(setIngredients).catch((e: Error) => setError(e.message)), []);

  useEffect(() => { void load(); void loadIngredients(); }, [load, loadIngredients]);
  useEffect(() => {
    if (!status?.running) return;
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  }, [status?.running, load]);

  const refresh = async (stores?: Store[]) => {
    setError(null);
    try {
      await api('/api/admin/refresh', { method: 'POST', body: JSON.stringify({ stores }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aktualizáciu sa nepodarilo spustiť.');
    }
  };

  const runImport = async () => {
    setImportMessage(null);
    try {
      const result = await api<{ total: number; created: number }>('/api/admin/import', { method: 'POST', body: JSON.stringify({ store: importStore, format: importFormat, text: importText }) });
      setImportMessage(`Importovaných ${result.total} položiek (${result.created} nových).`);
      setImportText('');
      await load();
    } catch (e) {
      setImportMessage(e instanceof Error ? e.message : 'Import zlyhal.');
    }
  };

  if (!status) {
    return error
      ? <div role="alert" className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      : <div className="space-y-4" aria-busy="true"><div className="skeleton h-40" /><div className="skeleton h-64" /></div>;
  }

  const shown = (ingredients ?? []).filter((i) => i.name.includes(filter.toLowerCase()));
  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">Správa dát</h1>
            <p className="text-xs text-stone-500">
              Posledná aktualizácia: {time(status.freshness.lastUpdate)} · {status.freshness.productCount} produktov · {status.unmapped} nezaradených · {status.recipes} receptov v knižnici
            </p>
          </div>
          <button type="button" className="btn btn-primary" disabled={status.running} onClick={() => void refresh()}>{status.running ? 'Aktualizujem…' : 'Aktualizovať všetko'}</button>
        </div>
        {status.freshness.stale && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Dáta sú staršie ako 8 dní alebo chýbajú – spustite aktualizáciu.</p>}
        {!status.hasLlm && <p className="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600">ANTHROPIC_API_KEY nie je nastavený: mapovanie beží len podľa kľúčových slov a recepty zostavuje pravidlový generátor.</p>}
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {status.stores.map((s) => {
            const [label, style] = STATUS_LABEL[s.last?.status ?? ''] ?? ['bez záznamu', 'bg-stone-100 text-stone-600'];
            return (
              <div key={s.store} className="rounded-xl border border-stone-200 p-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">{STORE_LABEL[s.store]}</h2>
                  <span className={`badge ${style}`}>{label}</span>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs text-stone-500">
                  <div><dd className="text-base font-bold text-stone-900">{s.total}</dd><dt>produktov</dt></div>
                  <div><dd className="text-base font-bold text-stone-900">{s.deals}</dd><dt>v akcii</dt></div>
                  <div><dd className="text-base font-bold text-stone-900">{s.mapped}</dd><dt>zaradených</dt></div>
                </dl>
                <p className="mt-2 text-xs text-stone-500">Naposledy: {time(s.lastScrape)}</p>
                {s.last?.message && <p className="mt-1 text-xs text-stone-600">{s.last.message}</p>}
                <button type="button" className="btn btn-ghost mt-2 w-full !py-1.5" disabled={status.running} onClick={() => void refresh([s.store])}>Aktualizovať {STORE_LABEL[s.store]}</button>
              </div>
            );
          })}
        </div>

        {status.lines.length > 0 && (
          <pre className="mt-4 max-h-56 overflow-auto rounded-xl bg-stone-900 p-3 text-[11px] leading-relaxed text-stone-100" aria-live="polite">{status.lines.join('\n')}</pre>
        )}
      </section>

      <ReceiptUpload onDone={() => void load()} />

      <section className="card p-4">
        <h2 className="font-bold">Import ponuky</h2>
        <p className="mt-1 text-xs text-stone-500">
          Pre obchody, ktoré blokujú automatické sťahovanie. CSV stĺpce: name, brand, ean, pack, price, deal_price, valid_from, valid_to, category, image, url. JSON: pole objektov s rovnakými kľúčmi.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {STORES.map((s) => <button key={s} type="button" className={`chip ${importStore === s ? 'chip-on' : ''}`} onClick={() => setImportStore(s)}>{STORE_LABEL[s]}</button>)}
          {(['csv', 'json'] as const).map((f) => <button key={f} type="button" className={`chip ${importFormat === f ? 'chip-on' : ''}`} onClick={() => setImportFormat(f)}>{f.toUpperCase()}</button>)}
          <label className="chip">
            Nahrať súbor
            <input type="file" accept=".csv,.json,text/csv,application/json" className="sr-only"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) void file.text().then((t) => { setImportText(t); setImportFormat(file.name.endsWith('.json') ? 'json' : 'csv'); }); }} />
          </label>
        </div>
        <textarea className="input mt-3 h-32 font-mono text-xs" value={importText} onChange={(e) => setImportText(e.target.value)} aria-label="Dáta na import"
          placeholder={'name,pack,price,deal_price,valid_to\nKuracie prsia,500 g,4.49,3.49,2026-11-19'} />
        <div className="mt-2 flex items-center gap-3">
          <button type="button" className="btn btn-primary" disabled={!importText.trim()} onClick={() => void runImport()}>Importovať</button>
          {importMessage && <span className="text-sm text-stone-700" role="status">{importMessage}</span>}
        </div>
      </section>

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold">Suroviny: výživové hodnoty a cenník bežných cien</h2>
            <p className="text-xs text-stone-500">Hodnoty na 100 g. Bežná cena (€/kg·l) sa použije len vtedy, keď surovina nemá aktuálnu cenu z obchodu.</p>
          </div>
          <input className="input max-w-52" placeholder="Filtrovať…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrovať suroviny" />
        </div>
        {!ingredients ? <div className="skeleton mt-3 h-40" /> : !shown.length ? <p className="mt-3 text-sm text-stone-500">Žiadna surovina nezodpovedá filtru.</p> : (
          <div className="mt-3 max-h-[28rem] overflow-auto">
            <table className="w-full min-w-[34rem] text-left">
              <thead className="sticky top-0 bg-white text-[11px] uppercase tracking-wide text-stone-500">
                <tr><th className="px-2 py-1">Surovina</th><th className="px-1">kcal</th><th className="px-1">B</th><th className="px-1">S</th><th className="px-1">T</th><th className="px-1">€/kg</th><th /></tr>
              </thead>
              <tbody>{shown.map((item) => <IngredientRow key={`${item.id}:${JSON.stringify(item)}`} item={item} onSaved={() => void loadIngredients()} />)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-4">
        <h2 className="font-bold">História aktualizácií</h2>
        {!status.logs.length ? <p className="mt-2 text-sm text-stone-500">Zatiaľ neprebehla žiadna aktualizácia.</p> : (
          <ul className="mt-2 divide-y divide-stone-100 text-sm">
            {status.logs.map((log) => (
              <li key={log.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                <span><span className="font-medium">{STORE_LABEL[log.store]}</span> · {STATUS_LABEL[log.status]?.[0] ?? log.status} · {log.itemCount} položiek</span>
                <span className="text-xs text-stone-500">{time(log.startedAt)}{log.message ? ` · ${log.message}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
