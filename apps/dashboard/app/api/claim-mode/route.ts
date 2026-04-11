import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabase
    .from('control_config')
    .select('claim_mode,claim_tiers,claim_speed')
    .eq('singleton', 'X')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    claim_mode:  data?.claim_mode  ?? 'auto',
    claim_tiers: data?.claim_tiers ?? ['1','2','3','4','5','6','S'],
    claim_speed: data?.claim_speed ?? 1.0,
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as { claim_mode?: string; claim_tiers?: string[]; claim_speed?: number };

  const patch: Record<string, unknown> = {};
  if (body.claim_mode !== undefined) {
    if (body.claim_mode !== 'auto' && body.claim_mode !== 'manual')
      return NextResponse.json({ error: 'claim_mode must be auto or manual' }, { status: 400 });
    patch['claim_mode'] = body.claim_mode;
  }
  if (body.claim_tiers !== undefined) {
    if (!Array.isArray(body.claim_tiers))
      return NextResponse.json({ error: 'claim_tiers must be an array' }, { status: 400 });
    const valid = new Set(['1','2','3','4','5','6','S']);
    const tiers = body.claim_tiers.map(String).filter(t => valid.has(t));
    patch['claim_tiers'] = tiers;
  }
  if (body.claim_speed !== undefined) {
    const speed = Number(body.claim_speed);
    if (isNaN(speed) || speed < 0.1 || speed > 3.0)
      return NextResponse.json({ error: 'claim_speed must be between 0.1 and 3.0' }, { status: 400 });
    patch['claim_speed'] = speed;
  }

  const { data, error } = await supabase
    .from('control_config')
    .upsert({ singleton: 'X', ...patch }, { onConflict: 'singleton' })
    .select('claim_mode,claim_tiers,claim_speed')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}