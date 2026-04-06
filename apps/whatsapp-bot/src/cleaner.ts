// ============================================================
// Cleaner — enriches stale/incomplete identities in the DB.
//
// Problems it fixes:
//   1. known_bots rows with jid = @lid  → resolve to real phone JID + number
//   2. known_bots rows with null moniker → back-fill from players table
//   3. groups rows with null name        → re-fetch from Baileys
//
// Trigger: .cleanids in the test GC, or call clean() at boot.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WASocket } from '@whiskeysockets/baileys';

export function createCleaner(
  db:     SupabaseClient,
  sock:   WASocket,
  lidMap: Map<string, string>,
) {

  // ── 1. Resolve a single @lid to a phone JID ────────────────
  async function resolveLid(lid: string): Promise<string | null> {
    if (!lid.endsWith('@lid')) return lid;
    if (lidMap.has(lid)) return lidMap.get(lid)!;
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID(lid);
      if (pn) { lidMap.set(lid, pn); return pn; }
    } catch { /* not yet synced */ }
    return null;
  }

  // ── 2. Fix known_bots with @lid jids ──────────────────────
  async function fixBotLids(): Promise<{ fixed: number; stuck: number }> {
    const { data, error } = await db
      .from('known_bots')
      .select('id, jid, lid, number')
      .like('jid', '%@lid');

    if (error || !data?.length) return { fixed: 0, stuck: 0 };

    let fixed = 0, stuck = 0;
    for (const bot of data) {
      const phonePn = await resolveLid(bot.jid);
      if (!phonePn || phonePn === bot.jid) { stuck++; continue; }

      const { error: upErr } = await db
        .from('known_bots')
        .update({ jid: phonePn, lid: bot.jid, number: phonePn.split('@')[0] })
        .eq('id', bot.id);

      upErr ? stuck++ : fixed++;
      if (!upErr) console.log(`[CLEANER] LID fixed: ${bot.jid} → ${phonePn}`);
    }
    return { fixed, stuck };
  }

  // ── 3. Back-fill null monikers from players table ─────────
  async function fixBotMonikers(): Promise<{ fixed: number }> {
    const { data: bots } = await db
      .from('known_bots')
      .select('id, jid')
      .is('moniker', null);

    if (!bots?.length) return { fixed: 0 };

    const jids = bots.map((b: { jid: string }) => b.jid);
    const { data: players } = await db
      .from('players')
      .select('jid, moniker')
      .in('jid', jids)
      .not('moniker', 'is', null);

    if (!players?.length) return { fixed: 0 };

    const monikerMap = new Map(players.map((p: { jid: string; moniker: string }) => [p.jid, p.moniker]));
    let fixed = 0;

    for (const bot of bots) {
      const moniker = monikerMap.get(bot.jid);
      if (!moniker) continue;
      const { error } = await db
        .from('known_bots')
        .update({ moniker })
        .eq('id', bot.id);
      if (!error) { fixed++; console.log(`[CLEANER] Moniker fixed: ${bot.jid} → "${moniker}"`); }
    }
    return { fixed };
  }

  // ── 4. Re-fetch group names for groups with null name ──────
  async function fixGroupNames(): Promise<{ fixed: number }> {
    const { data: groups } = await db
      .from('groups')
      .select('group_id')
      .is('name', null);

    if (!groups?.length) return { fixed: 0 };

    let fixed = 0;
    for (const g of groups) {
      try {
        const meta = await sock.groupMetadata(g.group_id);
        if (!meta?.subject) continue;
        const { error } = await db
          .from('groups')
          .update({ name: meta.subject, updated_at: new Date().toISOString() })
          .eq('group_id', g.group_id);
        if (!error) { fixed++; console.log(`[CLEANER] Group fixed: ${g.group_id} → "${meta.subject}"`); }
      } catch { /* group may no longer be accessible */ }
    }
    return { fixed };
  }

  // ── Full clean run ─────────────────────────────────────────
  async function clean(): Promise<string> {
    console.log('[CLEANER] Starting full clean…');
    const lids     = await fixBotLids();
    const monikers = await fixBotMonikers();
    const gcNames  = await fixGroupNames();
    const summary  =
      `LIDs: ${lids.fixed} fixed, ${lids.stuck} stuck\n` +
      `Monikers: ${monikers.fixed} filled\n` +
      `Groups: ${gcNames.fixed} named`;
    console.log(`[CLEANER] Done\n${summary}`);
    return summary;
  }

  return { clean, resolveLid };
}

export type Cleaner = ReturnType<typeof createCleaner>;
