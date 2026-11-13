import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'JedloKôš – zdravý jedálniček a najlacnejší nákup',
  description: 'Týždenný jedálniček a nákupný košík optimalizovaný podľa aktuálnych akcií Kaufland a Lidl.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#059669' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sk">
      <body className="font-sans antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
