import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { db, schema } from '@/db';
import { CLASSIFY_MODEL, hasLlm, llm } from '@/lib/anthropic';
import { classifyUnmapped } from '@/lib/classify';
import { upsertProducts, type RawProduct } from '@/lib/ingest';
import { STORES, type Store } from '@/lib/types';

export const dynamic = 'force-dynamic';

const Receipt = z.object({
  store: z.enum(['kaufland', 'lidl', 'other']),
  date: z.string().nullable(),
  items: z.array(z.object({
    name: z.string(),
    packText: z.string().nullable(),
    unitPrice: z.number(),
    dealUnitPrice: z.number().nullable(),
  })),
});

const SYSTEM = `Čítaš fotografiu pokladničného bločku zo slovenského obchodu (môže byť rozdelená na viac častí zhora nadol, časti sa mierne prekrývajú).
Vráť každú zakúpenú položku práve raz:
- "name": názov tak, ako je na bločku, skratky rozpíš len ak sú jednoznačné (napr. "Maslo 82% 250g").
- "packText": veľkosť balenia, ak je v názve alebo na riadku (napr. "250 g", "1 l"); pri váženom tovare "1 kg"; inak null.
- "unitPrice": bežná cena v EUR za 1 kus/balenie, pri váženom tovare cena za 1 kg (nie súčet riadku).
- "dealUnitPrice": ak za položkou nasleduje riadok so zľavou, jednotková cena po zľave; inak null.
Vynechaj zálohy za obaly, tašky, vrátenia, medzisúčty, DPH a platobné údaje.
"store" urč z hlavičky bločku, "date" je dátum nákupu vo formáte RRRR-MM-DD.`;

const HOME: Record<Store, string> = { kaufland: 'https://www.kaufland.sk', lidl: 'https://www.lidl.sk' };
const MEDIA = ['image/jpeg', 'image/png', 'image/webp'] as const;
const isStore = (value: string): value is Store => (STORES as string[]).includes(value);

/** Reads a receipt photo with the vision model and stores its prices as reference offers of that store. */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!hasLlm()) throw new Error('Čítanie bločkov vyžaduje ANTHROPIC_API_KEY v .env.local.');
    const body = (await request.json()) as { images?: { data?: string; mediaType?: string }[]; store?: string };
    const images = (body.images ?? []).filter((i): i is { data: string; mediaType: (typeof MEDIA)[number] } =>
      typeof i.data === 'string' && i.data.length > 0 && (MEDIA as readonly string[]).includes(i.mediaType ?? ''));
    if (!images.length || images.length > 10) throw new Error('Nahrajte fotografiu bločku (JPG, PNG alebo WebP).');

    const content: Anthropic.ContentBlockParam[] = [
      ...images.map((image): Anthropic.ImageBlockParam => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })),
      { type: 'text', text: 'Prepíš položky z tohto bločku.' },
    ];
    const response = await llm().messages.parse({
      model: CLASSIFY_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(Receipt) },
    });
    const receipt = response.parsed_output;
    if (response.stop_reason === 'refusal' || !receipt) throw new Error('Bloček sa nepodarilo prečítať.');
    const storeName = isStore(body.store ?? '') ? (body.store as Store) : receipt.store;
    if (!isStore(storeName)) throw new Error('Na bločku sa nepodarilo rozpoznať Kaufland ani Lidl – vyberte obchod ručne.');
    if (!receipt.items.length) throw new Error('Na fotografii sa nenašli žiadne položky. Skúste ostrejšiu fotku.');

    const date = receipt.date && /^\d{4}-\d{2}-\d{2}$/.test(receipt.date) ? receipt.date : null;
    const items: RawProduct[] = receipt.items.map((item) => {
      const deal = item.dealUnitPrice !== null && item.dealUnitPrice > 0 && item.dealUnitPrice < item.unitPrice ? item.dealUnitPrice : null;
      return {
        store: storeName, name: item.name, packText: item.packText, price: item.unitPrice, dealPrice: deal,
        validFrom: deal ? date : null, category: 'Bloček', sourceUrl: HOME[storeName],
      };
    });
    const now = new Date().toISOString();
    const result = upsertProducts(items, now);
    const mapped = await classifyUnmapped(() => undefined);
    db.insert(schema.refreshLog).values({
      store: storeName, startedAt: now, finishedAt: now, status: 'import', itemCount: result.total, newCount: result.created,
      message: `Bloček${date ? ` z ${date}` : ''}: ${result.total} položiek, ${result.created} nových`,
    }).run();
    return Response.json({ ...result, store: storeName, date, mapped, items: items.map((i) => ({ name: i.name, packText: i.packText ?? null, price: i.dealPrice ?? i.price })) });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${(error.cause as NodeJS.ErrnoException).code ?? error.cause.message})` : '';
    return Response.json({ error: error instanceof Error ? `${error.message}${cause}` : 'Bloček sa nepodarilo spracovať.' }, { status: 400 });
  }
}
