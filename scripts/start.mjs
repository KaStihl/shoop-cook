// One-step launcher: installs dependencies and seeds the database on first run, starts the server and opens the browser.
// Usage: double-click start.bat (Windows) or run `npm run app`. Set PORT to change the port, NO_OPEN=1 to skip the browser.
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3000;
const url = `http://localhost:${port}`;
const run = (command) => execSync(command, { cwd: root, stdio: 'inherit' });
const node = (...args) => `"${process.execPath}" ${args.join(' ')}`;

async function responds() {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

function openBrowser() {
  if (process.env.NO_OPEN) return;
  const command = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  try {
    execSync(command, { stdio: 'ignore' });
  } catch {
    console.log(`Otvorte v prehliadači: ${url}`);
  }
}

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error(`JedloKôš potrebuje Node.js 24 alebo novší (nainštalovaný je ${process.versions.node}). Stiahnite ho z https://nodejs.org`);
  process.exit(1);
}

if (await responds()) {
  console.log(`JedloKôš už beží na ${url}.`);
  openBrowser();
  process.exit(0);
}

if (!existsSync(join(root, 'node_modules', 'next'))) {
  console.log('Prvé spustenie: inštalujem závislosti (môže trvať pár minút)…');
  run('npm install');
}
if (!existsSync(join(root, 'data', 'jedlokos.db'))) {
  console.log('Pripravujem databázu s ukážkovými cenami…');
  run(node('--env-file-if-exists=.env.local', '--import', 'tsx', 'scripts/seed.ts'));
}

console.log(`Spúšťam JedloKôš na ${url} – okno nechajte otvorené, zatvorením aplikáciu ukončíte.`);
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], { cwd: root, stdio: 'inherit' });
server.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill());

for (let attempt = 0; attempt < 90; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (await responds()) {
    openBrowser();
    break;
  }
}
