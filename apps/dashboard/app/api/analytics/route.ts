import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get('group'); // null = global

  // Fetch all card_events (with created_at, group_id, tier, claimed)
  let query = supabase
    .from('card_events')
    .select('id, created_at, group_id, tier, claimed');

  if (groupId) query = query.eq('group_id', groupId);

  const { data: events, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  const DAY   = 86_400_000;
  const WEEK  = 7  * DAY;
  const MONTH = 30 * DAY;

  // ── Rankings: spawns per group per timeframe ───────────────
  const rankMap = new Map<string, { today: number; week: number; month: number; allTime: number }>();
  for (const e of (events ?? [])) {
    const age = now - new Date(e.created_at).getTime();
    if (!rankMap.has(e.group_id)) rankMap.set(e.group_id, { today: 0, week: 0, month: 0, allTime: 0 });
    const r = rankMap.get(e.group_id)!;
    r.allTime++;
    if (age <= MONTH) r.month++;
    if (age <= WEEK)  r.week++;
    if (age <= DAY)   r.today++;
  }

  // ── Fetch group names ──────────────────────────────────────
  const gcIds = Array.from(rankMap.keys());
  const { data: gcRows } = gcIds.length
    ? await supabase.from('groups').select('group_id, name').in('group_id', gcIds)
    : { data: [] };
  const gcNameMap = new Map((gcRows ?? []).map((g: { group_id: string; name: string | null }) => [g.group_id, g.name ?? g.group_id]));

  const rankings = Array.from(rankMap.entries()).map(([gcId, counts]) => ({
    group_id: gcId,
    name:     gcNameMap.get(gcId) ?? gcId,
    ...counts,
  })).sort((a, b) => b.allTime - a.allTime);

  // ── Hourly distribution (0–23) ────────────────────────────
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
  for (const e of (events ?? [])) {
    const h = new Date(e.created_at).getUTCHours();
    hourly[h]!.count++;
  }

  // ── Daily distribution (Mon=0 … Sun=6) ───────────────────
  const daily = Array.from({ length: 7 }, (_, d) => ({ day: d, count: 0 }));
  const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  for (const e of (events ?? [])) {
    const d = (new Date(e.created_at).getUTCDay() + 6) % 7; // shift so Mon=0
    daily[d]!.count++;
  }

  // ── Tier breakdown ─────────────────────────────────────────
  const tierMap = new Map<string, number>();
  for (const e of (events ?? [])) {
    const t = e.tier ?? '?';
    tierMap.set(t, (tierMap.get(t) ?? 0) + 1);
  }
  const tiers = Array.from(tierMap.entries())
    .map(([tier, count]) => ({ tier, count }))
    .sort((a, b) => b.count - a.count);

  // ── Summary ────────────────────────────────────────────────
  const total    = events?.length ?? 0;
  const claimed  = events?.filter(e => e.claimed).length ?? 0;
  const today    = events?.filter(e => now - new Date(e.created_at).getTime() <= DAY).length ?? 0;
  const thisWeek = events?.filter(e => now - new Date(e.created_at).getTime() <= WEEK).length ?? 0;

  return NextResponse.json({
    summary: { total, claimed, claimRate: total ? Math.round(claimed / total * 100) : 0, today, thisWeek },
    rankings,
    hourly,
    daily:  daily.map((d, i) => ({ ...d, label: DAY_LABELS[i]! })),
    tiers,
  });
}
