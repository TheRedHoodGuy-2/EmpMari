// ============================================================
// @mariabelle/identifier — Sender classifier
//
// Needs Supabase. Has a 2-minute in-memory cache.
// Does NOT perform auto-discovery — the bot does that.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { getNumber, normalizeJid, isGroupJid, isSelf } from './jid.js';
import type { ClassifyResult, Classifier } from './types.js';

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

type CacheEntry = {
  result: ClassifyResult;
  expiresAt: number;
};

// Row shape returned from known_bots SELECT
type KnownBotRow = {
  id: string;
  jid: string;
  number: string;
  status: 'verified' | 'unverified';
  created_at: string;
};

/**
 * Creates a sender classifier bound to a Supabase client and self number.
 *
 * classify() logic:
 *   1. Compute normalized JID + number
 *   2. If isSelf → return immediately as 'self'
 *   3. Check 2-minute in-memory cache
 *   4. Query known_bots by normalizedJid
 *   5. Cache and return result
 *
 * autoDiscovered is always false here. The bot sets it to true
 * after calling insertUnverifiedBot() on a successful parse match.
 */
export function createClassifier(
  db: SupabaseClient,
  selfNumber: string,
): Classifier {
  const cache = new Map<string, CacheEntry>();

  async function classify(senderJid: string): Promise<ClassifyResult> {
    const normalizedJid = normalizeJid(senderJid);
    const number        = getNumber(senderJid);
    const isGroup       = isGroupJid(senderJid);

    // Step 2 — self check (no DB, no cache needed)
    if (isSelf(senderJid, selfNumber)) {
      return {
        jid: senderJid,
        normalizedJid,
        number,
        senderType: 'self',
        isGroup,
        autoDiscovered: false,
      };
    }

    // Step 3 — cache check
    const cached = cache.get(normalizedJid);
    if (cached !== undefined && Date.now() < cached.expiresAt) {
      return cached.result;
    }

    // Step 4 — DB lookup
    const { data } = await db
      .from('known_bots')
      .select('id, jid, number, status, created_at')
      .eq('jid', normalizedJid)
      .maybeSingle();

    const row = data as KnownBotRow | null;

    const result: ClassifyResult = {
      jid: senderJid,
      normalizedJid,
      number,
      senderType: row !== null ? 'bot' : 'unknown',
      isGroup,
      autoDiscovered: false,
    };

    // Step 5 — cache result
    cache.set(normalizedJid, {
      result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return result;
  }

  function invalidate(senderJid: string): void {
    cache.delete(normalizeJid(senderJid));
  }

  return { classify, invalidate };
}

/**
 * Insert a JID into known_bots as 'unverified'.
 * Silently ignores if the JID already exists (ON CONFLICT DO NOTHING).
 *
 * Called by the bot when:
 *   - senderType is 'unknown'
 *   - AND the message parsed as a recognised bot template
 */
export async function insertUnverifiedBot(
  db: SupabaseClient,
  jid: string,
): Promise<void> {
  const number = getNumber(jid);
  await db
    .from('known_bots')
    .upsert(
      { jid, number, status: 'unverified' },
      { onConflict: 'jid', ignoreDuplicates: true },
    );
}
