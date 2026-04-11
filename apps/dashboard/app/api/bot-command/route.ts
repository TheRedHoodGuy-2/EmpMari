import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET — list recent commands and their status
export async function GET() {
  const { data, error } = await supabase
    .from('command_queue')
    .select('id,group_id,command,status,created_at,sent_at')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST — queue a command { group_id, text }
export async function POST(req: NextRequest) {
  const body = await req.json() as { group_id?: string; text?: string };
  if (!body.group_id || !body.text) {
    return NextResponse.json({ error: 'group_id and text required' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('command_queue')
    .insert({ group_id: body.group_id, command: body.text, status: 'pending' })
    .select('id,group_id,command,status,created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, row: data });
}

// DELETE — cancel all pending commands
export async function DELETE() {
  const { error } = await supabase
    .from('command_queue')
    .delete()
    .eq('status', 'pending');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}