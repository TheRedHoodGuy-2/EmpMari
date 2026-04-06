import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set in .env.local');
  return createClient(url, key);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let db;
  try { db = serviceClient(); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }

  const body = await req.json() as { status?: string };
  const { data, error } = await db
    .from('known_bots')
    .update({ status: body.status })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let db;
  try { db = serviceClient(); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }

  const { error } = await db
    .from('known_bots')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
