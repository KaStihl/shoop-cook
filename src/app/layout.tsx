import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import './globals.css';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const metadata: Metadata = {
  title: 'JedloKôš – zdravý jedálniček a najlacnejší nákup',
  description: 'Týždenný jedálniček a nákupný košík optimalizovaný podľa aktuálnych akcií Kaufland, Lidl, Billa a Tesco.',
  // The manifest makes the app installable on phones and tablets ("Add to Home Screen").
  manifest: `${BASE}/manifest.webmanifest`,
  icons: { icon: `${BASE}/icon.svg`, apple: `${BASE}/icon.svg` },
  appleWebApp: { capable: true, title: 'JedloKôš', statusBarStyle: 'default' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#059669' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sk">
      <body className="font-sans antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
