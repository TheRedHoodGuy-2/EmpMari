import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabase
    .from('control_config')
    .select('claim_mode,claim_tiers')
    .eq('singleton', 'X')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    claim_mode:  data?.claim_mode  ?? 'auto',
    claim_tiers: data?.claim_tiers ?? ['1','2','3','4','5','6','S'],
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as { claim_mode?: string; claim_tiers?: string[] };

  const patch: Record<string, unknown> = {};
  if (body.claim_mode  !== undefined) {
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

  const { data, error } = await supabase
    .from('control_config')
    .upsert({ singleton: 'X', ...patch }, { onConflict: 'singleton' })
    .select('claim_mode,claim_tiers')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
