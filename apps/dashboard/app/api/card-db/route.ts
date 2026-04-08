import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Cache in globalThis so it survives Next.js HMR and isn't refetched on every request.
// Invalidated after 10 minutes so a fresh scrape is reflected without restarting the server.
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — card data rarely changes outside a scrape

declare global {
  // eslint-disable-next-line no-var
  var __cardDbCache: { data: unknown[]; fetchedAt: number } | undefined;
}

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  // Prefer service role (bypasses RLS), fall back to anon key (card_db is public-readable)
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) throw new Error('Missing Supabase URL or key in environment');
  return createClient(url, key);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bust = searchParams.get('bust') === '1';

  // Return cached data if still fresh
  if (!bust && globalThis.__cardDbCache) {
    const age = Date.now() - globalThis.__cardDbCache.fetchedAt;
    if (age < CACHE_TTL_MS) {
      return NextResponse.json(globalThis.__cardDbCache.data, {
        headers: { 'X-Cache': 'HIT', 'X-Cache-Age': String(Math.floor(age / 1000)) },
      });
    }
  }

  let db;
  try { db = getClient(); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }

  const PAGE = 1000;
  const all: unknown[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await db
      .from('card_db')
      // description excluded — large text field, fetched on demand when modal opens
      .select('card_id,name,series,tier,stars,image_url,event,wishlist_count,owner_names,scraped_at')
      .order('name')
      .range(from, from + PAGE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  globalThis.__cardDbCache = { data: all, fetchedAt: Date.now() };

  return NextResponse.json(all, {
    headers: { 'X-Cache': 'MISS', 'X-Cache-Age': '0' },
  });
}
