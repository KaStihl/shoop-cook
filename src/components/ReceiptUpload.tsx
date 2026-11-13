'use client';

import { useState } from 'react';
import { api, eur } from '@/lib/client';
import { STORES, STORE_LABEL, type Store } from '@/lib/types';

interface ReceiptResult {
  total: number;
  created: number;
  mapped: number;
  store: Store;
  date: string | null;
  items: { name: string; packText: string | null; price: number }[];
}

const TILE_WIDTH = 1000;
const TILE_HEIGHT = 1400;
const OVERLAP = 80;

/** Receipts are very tall: the photo is scaled to a readable width and cut into overlapping tiles for the vision model. */
async function toTiles(file: File): Promise<{ data: string; mediaType: string }[]> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, TILE_WIDTH / bitmap.width);
  const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
  const tiles: { data: string; mediaType: string }[] = [];
  for (let top = 0; top < height && tiles.length < 10; top += TILE_HEIGHT - OVERLAP) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.min(TILE_HEIGHT, height - top);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Prehliadač nedokáže spracovať obrázok.');
    context.drawImage(bitmap, 0, top / scale, bitmap.width, canvas.height / scale, 0, 0, width, canvas.height);
    tiles.push({ data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1], mediaType: 'image/jpeg' });
    if (top + TILE_HEIGHT >= height) break;
  }
  return tiles;
}

export function ReceiptUpload({ onDone }: { onDone: () => void }) {
  const [store, setStore] = useState<Store | 'auto'>('auto');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ReceiptResult | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setMessage(null);
    setResult(null);
    try {
      const images = await toTiles(file);
      const response = await api<ReceiptResult>('/api/admin/receipt', { method: 'POST', body: JSON.stringify({ images, store: store === 'auto' ? undefined : store }) });
      setResult(response);
      setMessage(`${STORE_LABEL[response.store]}${response.date ? `, ${response.date}` : ''}: uložených ${response.total} položiek (${response.created} nových).`);
      onDone();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Bloček sa nepodarilo spracovať.');
    }
    setBusy(false);
  };

  return (
    <section className="card p-4">
      <h2 className="font-bold">Bloček z nákupu</h2>
      <p className="mt-1 text-xs text-stone-500">
        Odfoťte pokladničný bloček z Kauflandu alebo Lidla. Ceny z neho sa uložia ako referenčné ceny obchodu a použijú sa v košíku. Fotografia sa odošle na rozpoznanie do Claude API a neukladá sa.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={`chip ${store === 'auto' ? 'chip-on' : ''}`} onClick={() => setStore('auto')}>Obchod rozpoznať</button>
        {STORES.map((s) => <button key={s} type="button" className={`chip ${store === s ? 'chip-on' : ''}`} onClick={() => setStore(s)}>{STORE_LABEL[s]}</button>)}
        <label className={`btn btn-primary ${busy ? 'pointer-events-none opacity-60' : ''}`}>
          {busy ? 'Čítam bloček…' : 'Nahrať fotku bločku'}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy}
            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file); }} />
        </label>
      </div>
      {message && <p className="mt-3 text-sm text-stone-700" role="status">{message}</p>}
      {result && (
        <ul className="mt-2 max-h-56 divide-y divide-stone-100 overflow-auto rounded-xl bg-stone-50 px-3 text-xs">
          {result.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-3 py-1.5">
              <span>{item.name}{item.packText ? ` · ${item.packText}` : ''}</span><span className="shrink-0 font-semibold">{eur(item.price)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
