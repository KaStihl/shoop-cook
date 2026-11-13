// Builds the static (GitHub Pages) version into ./out. API routes cannot be exported statically, so they are moved
// out of the app directory for the duration of the build; the browser answers those calls itself (src/lib/static-backend.ts).
// Usage: npm run build:static   (set NEXT_PUBLIC_BASE_PATH=/repo-name when the site is served from a sub-path)
import { execSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = join(root, 'src', 'app', 'api');
const parked = join(root, 'src', 'api.server-only');

if (!existsSync(join(root, 'public', 'data', 'catalog.json'))) {
  console.error('Chýbajú dáta: najprv spustite "npm run export".');
  process.exit(1);
}
if (existsSync(api)) renameSync(api, parked);
try {
  execSync(`"${process.execPath}" node_modules/next/dist/bin/next build`, { cwd: root, stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_STATIC: '1' } });
} finally {
  if (existsSync(parked)) renameSync(parked, api);
}
