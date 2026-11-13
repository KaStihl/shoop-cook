import https from 'node:https';
import zlib from 'node:zlib';

const USER_AGENT = 'JedloKosBot/1.0 (osobny planovac jedal; respektuje robots.txt)';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface HttpResult {
  status: number;
  body: string;
}

/** Plain HTTPS GET. Built-in fetch rejects the very large response headers some retail sites send. */
function httpGet(url: string, redirects = 5): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'user-agent': USER_AGENT, 'accept-language': 'sk', 'accept-encoding': 'gzip, br', accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
      maxHeaderSize: 256 * 1024,
      timeout: 30000,
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location && redirects > 0) {
        response.resume();
        httpGet(new URL(location, url).toString(), redirects - 1).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        try {
          const raw = Buffer.concat(chunks);
          const encoding = response.headers['content-encoding'];
          const decoded = encoding === 'gzip' ? zlib.gunzipSync(raw) : encoding === 'br' ? zlib.brotliDecompressSync(raw) : raw;
          resolve({ status, body: decoded.toString('utf8') });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Časový limit požiadavky vypršal')));
    request.on('error', reject);
  });
}

/** Raised when a site refuses automated access (bot challenge, robots.txt disallow). Never retried or bypassed. */
export class BlockedError extends Error {}

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

const toRegex = (pattern: string): RegExp =>
  new RegExp('^' + pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\$$/, '$')).join('.*'));

function parseRobots(text: string): Rule[] {
  const rules: Rule[] = [];
  let applies = false;
  let lastWasAgent = false;
  for (const line of text.split('\n')) {
    const [rawField, ...rest] = line.split('#')[0].split(':');
    const field = rawField.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (field === 'user-agent') {
      const matches = value === '*' || value.toLowerCase().includes('jedlokosbot');
      applies = lastWasAgent ? applies || matches : matches;
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (applies && value && (field === 'disallow' || field === 'allow')) {
      rules.push({ allow: field === 'allow', pattern: value, regex: toRegex(value) });
    }
  }
  return rules;
}

function isAllowed(rules: Rule[], url: URL): boolean {
  // Query-parameter rules such as "*?offset=*" are read conservatively: they apply wherever the parameter appears.
  const candidates = [url.pathname + url.search, ...[...url.searchParams.keys()].map((k) => `${url.pathname}?${k}=${url.searchParams.get(k)}`)];
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!candidates.some((c) => rule.regex.test(c))) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

/** Polite per-site HTTP client: robots.txt, fixed minimum delay between requests, retry with exponential backoff. */
export class Fetcher {
  private rules: Rule[] | null = null;
  private last = 0;

  constructor(readonly origin: string, private readonly minDelayMs = 1500) {}

  private async raw(url: string): Promise<HttpResult> {
    const wait = this.last + this.minDelayMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.last = Date.now();
    return httpGet(url);
  }

  private async loadRobots(): Promise<Rule[]> {
    if (this.rules) return this.rules;
    const res = await this.raw(`${this.origin}/robots.txt`);
    if (res.status === 401 || res.status === 403) {
      throw new BlockedError('Web blokuje automatický prístup (ochrana proti robotom), robots.txt sa nedá overiť.');
    }
    this.rules = res.status === 200 ? parseRobots(res.body) : [];
    return this.rules;
  }

  async allowed(url: string): Promise<boolean> {
    return isAllowed(await this.loadRobots(), new URL(url, this.origin));
  }

  async get(pathOrUrl: string): Promise<string> {
    const url = new URL(pathOrUrl, this.origin).toString();
    if (!(await this.allowed(url))) throw new BlockedError(`robots.txt zakazuje ${new URL(url).pathname}`);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(2000 * 2 ** attempt);
      try {
        const res = await this.raw(url);
        if (res.status === 403 || res.status === 401) throw new BlockedError('Web blokuje automatický prístup (ochrana proti robotom).');
        if (res.status === 429 || res.status >= 500) { lastError = new Error(`HTTP ${res.status}`); continue; }
        if (res.status !== 200) throw new Error(`HTTP ${res.status} pre ${url}`);
        return res.body;
      } catch (error) {
        if (error instanceof BlockedError || (error instanceof Error && error.message.startsWith('HTTP 4'))) throw error;
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /**
   * Renders a JavaScript-driven page in headless Chromium (Playwright). Used only for pages robots.txt allows
   * and only when the static HTML carries no products. Returns null when no browser is installed.
   */
  async render(pathOrUrl: string): Promise<string | null> {
    const url = new URL(pathOrUrl, this.origin).toString();
    if (!(await this.allowed(url))) return null;
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ userAgent: USER_AGENT, locale: 'sk-SK' });
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
        return await page.content();
      } finally {
        await browser.close();
      }
    } catch {
      return null;
    }
  }
}
