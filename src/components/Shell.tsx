'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { IS_STATIC, api, dateSk } from '@/lib/client';
import type { Freshness, MetaResponse } from '@/lib/types';

const NAV = [
  { href: '/', label: 'Plán', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
  { href: '/recepty', label: 'Recepty', icon: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5' },
  { href: '/chladnicka', label: 'Chladnička', icon: 'M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM4 10h16M8 5v2M8 13v4' },
  { href: '/kosik', label: 'Košík', icon: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0' },
  { href: '/akcie', label: 'Akcie', icon: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01' },
  ...(IS_STATIC ? [] : [{ href: '/admin', label: 'Admin', icon: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' }]),
];
const ADMIN_HINT = IS_STATIC ? 'Dáta sa obnovujú automaticky raz denne.' : 'Aktualizujte ponuku v časti Admin.';

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname().replace(/(.)\/$/, '$1');
  const [freshness, setFreshness] = useState<Freshness | null>(null);

  useEffect(() => {
    api<MetaResponse>('/api/meta').then((meta) => setFreshness(meta.freshness)).catch(() => setFreshness(null));
  }, [pathname]);

  const banner = !freshness ? null
    : freshness.productCount === 0 ? 'Databáza je prázdna. Spustite „npm run seed“ alebo aktualizáciu ponuky v časti Admin.'
    : freshness.stale ? `Ceny sú staršie ako 8 dní (posledná aktualizácia ${dateSk(freshness.lastUpdate)}). ${ADMIN_HINT}`
    : freshness.seedOnly ? 'Zobrazujú sa ukážkové dáta. Pre reálne ceny spustite aktualizáciu v časti Admin.'
    : null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur print:hidden">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-brand-900">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">J</span>
            JedloKôš
          </Link>
          <nav className="hidden gap-1 sm:flex">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${pathname === item.href ? 'bg-brand-50 text-brand-700' : 'text-stone-600 hover:bg-stone-100'}`}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {banner && (
        <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900 print:hidden">
          {banner} {!IS_STATIC && pathname !== '/admin' && <Link href="/admin" className="font-semibold underline">Otvoriť Admin</Link>}
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">{children}</main>

      <footer className="mx-auto w-full max-w-7xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 text-xs leading-relaxed text-stone-500 sm:pb-6">
        Ceny sú orientačné a v predajni sa môžu líšiť. JedloKôš nie je prepojený so spoločnosťami Kaufland, Lidl, Billa ani Tesco a nie je nimi prevádzkovaný.
      </footer>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden print:hidden">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${pathname === item.href ? 'text-brand-700' : 'text-stone-500'}`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={item.icon} />
            </svg>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
