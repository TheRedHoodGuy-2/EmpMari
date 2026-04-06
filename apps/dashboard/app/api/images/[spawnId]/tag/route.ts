import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
  const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '';
  return createClient(url, key);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ spawnId: string }> },
): Promise<NextResponse> {
  const { spawnId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('designTag' in body) ||
    typeof (body as Record<string, unknown>)['designTag'] !== 'string'
  ) {
    return NextResponse.json({ error: 'Body must be { designTag: string }' }, { status: 400 });
  }

  const designTag = ((body as { designTag: string }).designTag).trim();
  if (!designTag) {
    return NextResponse.json({ error: 'designTag must not be empty' }, { status: 400 });
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('card_images')
    .update({ design_tag: designTag })
    .eq('spawn_id', spawnId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
