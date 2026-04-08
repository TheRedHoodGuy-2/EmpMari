import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const TTL_MS = 5 * 60 * 1000; // 5 min — people update more frequently

declare global {
  // eslint-disable-next-line no-var
  var __peopleCache: { data: unknown[]; fetchedAt: number } | undefined;
}

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  return createClient(url, key);
}

export async function GET(req: Request) {
  const bust = new URL(req.url).searchParams.get('bust') === '1';

  if (!bust && globalThis.__peopleCache) {
    const age = Date.now() - globalThis.__peopleCache.fetchedAt;
    if (age < TTL_MS) {
      return NextResponse.json(globalThis.__peopleCache.data, {
        headers: { 'X-Cache': 'HIT', 'X-Cache-Age': String(Math.floor(age / 1000)) },
      });
    }
  }

  const { data, error } = await db()
    .from('people')
    .select('id,jid,number,display_name,gcs,last_seen')
    .order('display_name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  globalThis.__peopleCache = { data: data ?? [], fetchedAt: Date.now() };
  return NextResponse.json(data ?? [], { headers: { 'X-Cache': 'MISS' } });
}
