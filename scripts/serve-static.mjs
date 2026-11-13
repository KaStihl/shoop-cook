// Serves the static build (./out) the way GitHub Pages does, under the same base path. Usage: npm run preview:static
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
const port = Number(process.env.PORT) || 4173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain' };

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  if (!path.startsWith(`${base}/`) && path !== base) {
    response.writeHead(302, { location: `${base}/` }).end();
    return;
  }
  let file = join(out, normalize(path.slice(base.length)));
  if (!file.startsWith(out)) file = out;
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) file = join(out, '404.html');
  response.writeHead(file.endsWith('404.html') ? 404 : 200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(port, () => console.log(`Statická verzia beží na http://localhost:${port}${base}/`));
