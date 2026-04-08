import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase as anonClient } from '@/lib/supabase';

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set in .env.local');
  return createClient(url, key);
}

export async function GET() {
  // 1. All bots
  const { data: bots, error } = await anonClient
    .from('known_bots')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!bots || bots.length === 0) return NextResponse.json([]);

  // 2. All known groups (for name lookup)
  const { data: gcRows } = await anonClient
    .from('groups')
    .select('group_id, name');
  const gcNameMap = new Map<string, string | null>(
    (gcRows ?? []).map(g => [g.group_id as string, g.name as string | null])
  );

  // 3. Per-bot: find distinct group_ids from parse_log where sender_jid contains bot number.
  //    JID format is "<number>@s.whatsapp.net" or "<number>@lid" — number is the reliable key.
  const typedBots = bots as { id: string; created_at: string; jid: string; number: string; status: string; moniker: string | null }[];

  const result = await Promise.all(typedBots.map(async (bot) => {
    // Search parse_log for this bot's number in sender_jid (handles JID format variations)
    const { data: logRows } = await anonClient
      .from('parse_log')
      .select('group_id')
      .like('sender_jid', `%${bot.number}%`)
      .not('group_id', 'is', null)
      .limit(1000);

    const seenGroupIds = new Set<string>();
    for (const r of (logRows ?? [])) {
      if (r.group_id) seenGroupIds.add(r.group_id as string);
    }

    const groups = Array.from(seenGroupIds).map(gcId => ({
      id:   gcId,
      name: gcNameMap.get(gcId) ?? null,
    }));

    return { ...bot, groups };
  }));

  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const body = await req.json() as { jid?: string; number?: string; status?: string };
  const { jid, number, status = 'verified' } = body;

  if (!jid || !number) {
    return NextResponse.json({ error: 'jid and number are required' }, { status: 400 });
  }

  let db;
  try { db = serviceClient(); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }

  const { data, error } = await db
    .from('known_bots')
    .upsert({ jid, number, status }, { onConflict: 'jid' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, moniker: null, groups: [] });
}
