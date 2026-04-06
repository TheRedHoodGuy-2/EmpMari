// ============================================================
// Logger — writes parse results to Supabase parse_log
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParseTrace } from '@mariabelle/parser';
import type { SenderType } from '@mariabelle/identifier';

type WriteParseLogParams = {
  groupId:     string | null;
  senderJid:   string;
  senderType:  SenderType;
  rawText:     string;
  trace:       ParseTrace;
  autoFlagged: boolean;
};

export async function writeParseLog(
  db: SupabaseClient,
  params: WriteParseLogParams,
): Promise<void> {
  const { error } = await db.from('parse_log').insert({
    group_id:    params.groupId,
    sender_jid:  params.senderJid,
    sender_type: params.senderType,
    raw_text:    params.rawText,
    line_count:  params.trace.lines.length,
    template_id: params.trace.result?.templateId ?? null,
    fields_json: params.trace.result?.fields     ?? null,
    trace_json:  params.trace,
    auto_flagged: params.autoFlagged,
  });

  if (error) {
    // Log but don't crash — a DB write failure must not kill the bot.
    console.error('[DB] parse_log insert failed:', error.message);
  }
}
