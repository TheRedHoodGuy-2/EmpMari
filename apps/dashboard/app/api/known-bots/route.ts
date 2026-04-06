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

  const jids = (bots as { jid: string }[]).map(b => b.jid);

  // 2. Associated group_ids from parse_log
  const { data: groupRows } = await anonClient
    .from('parse_log')
    .select('sender_jid, group_id')
    .in('sender_jid', jids)
    .not('group_id', 'is', null);

  const gcMap = new Map<string, Set<string>>();
  for (const row of (groupRows ?? [])) {
    if (!row.group_id) continue;
    if (!gcMap.has(row.sender_jid)) gcMap.set(row.sender_jid, new Set());
    gcMap.get(row.sender_jid)!.add(row.group_id);
  }

  // 4. Group names from groups table
  const allGroupIds = Array.from(new Set((groupRows ?? []).map(r => r.group_id).filter(Boolean)));
  const gcNameMap = new Map<string, string>();
  if (allGroupIds.length > 0) {
    const { data: gcNameRows } = await anonClient
      .from('groups')
      .select('group_id, name')
      .in('group_id', allGroupIds);
    for (const g of (gcNameRows ?? [])) {
      if (g.name) gcNameMap.set(g.group_id, g.name);
    }
  }

  // 4. Assemble
  const result = (bots as {
    id: string; created_at: string; jid: string; number: string; status: string; moniker: string | null;
  }[]).map(b => ({
    ...b,
    groups: Array.from(gcMap.get(b.jid) ?? []).map(gcId => ({
      id:   gcId,
      name: gcNameMap.get(gcId) ?? null,
    })),
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
