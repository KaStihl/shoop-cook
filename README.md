# JedloKôš
Týždenný zdravý jedálniček + nákupný košík z najlacnejších surovín podľa aktuálnych akcií Kaufland, Lidl, Billa a Tesco (Billa a Tesco zatiaľ len cez import alebo bloček) (Next.js, TypeScript, Tailwind, SQLite/Drizzle).
1. Spustenie (Node.js 24+): dvojklik na `start.bat` (alebo `npm run app`) – nainštaluje, pripraví dáta, spustí server a otvorí prehliadač; ručne `npm i && npm run seed && npm run dev` → http://localhost:3000 (seed = 30 ukážkových položiek, len kým nie sú reálne dáta).
2. Reálne ceny: `npm run refresh` (voliteľne `-- --store=lidl`, `-- --cron` = denne o 06:00) alebo tlačidlo v `/admin`; dáta staršie ako 8 dní zobrazia varovanie.
3. AI (voliteľné): `ANTHROPIC_API_KEY` v `.env.local` zapne klasifikáciu produktov (claude-haiku-5-5) a návrh receptov (claude-sonnet-5-5); bez kľúča beží pravidlový generátor.
4. Crawlery (`src/lib/crawlers`) rešpektujú robots.txt, limitujú rýchlosť a opakujú s backoffom; Playwright sa použije len pre JS stránky (`npx playwright install chromium`).
5. Kaufland.sk momentálne vracia robotom overovaciu stránku – crawler ju neobchádza, stav je „blokované“ a ponuku možno nahrať cez import CSV/JSON alebo fotku bločku v `/admin`; referenčné recepty z yummybox.sk: `npm run recipes`.
6. Obrazovky: `/` plán + nastavenia (localStorage), `/recepty` knižnica receptov (vlastný recept, recept z URL, zaradenie do dňa), `/kosik` košík (odškrtávanie, text, tlač, CSV), `/akcie` ponuka, `/admin` aktualizácia, import, výživové hodnoty a cenník.
7. Logika: `src/lib/planner.ts` (greedy + lokálne výmeny), `recipes.ts` (LLM navrhuje, kód overuje, knižnica receptov), `catalog.ts` (ceny, balenia, košík).
8. Databáza `data/jedlokos.db` používa vstavaný `node:sqlite` (žiadne natívne moduly); test: `npm test`, typy: `npm run typecheck`, build: `npm run build`.
9. Ceny sú orientačné a v predajni sa môžu líšiť; aplikácia nie je prepojená so spoločnosťami Kaufland ani Lidl.
