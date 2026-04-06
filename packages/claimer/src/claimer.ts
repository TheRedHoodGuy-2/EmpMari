import type { WASocket } from '@whiskeysockets/baileys';
import type { SupabaseClient } from '@supabase/supabase-js';
import { detectCard } from '@mariabelle/card-detector';
import type { ActivityLog } from '@mariabelle/activity-log';
import type { Humaniser } from '@mariabelle/humaniser';
import type { SpawnEvent, ClaimAttempt } from './types.js';

export function createClaimer(
  sock:        WASocket,
  supabase:    SupabaseClient,
  activityLog: ActivityLog,
  humaniser:   Humaniser,
) {
  const attempted = new Set<string>(); // spawnIds we have attempted
  const confirmed = new Set<string>(); // spawnIds confirmed claimed by anyone

  return {
    // Call when CLAIM_SUCCESS or CLAIM_TAKEN is parsed for any spawnId
    confirm(spawnId: string): void {
      confirmed.add(spawnId);
      console.log(`[CLAIMER] ${spawnId} confirmed claimed — any pending attempt aborted`);
    },

    async attempt(event: SpawnEvent): Promise<ClaimAttempt> {
      const { spawnId, groupId, tier, issue, imageBuffer } = event;

      // ── Guard: already attempted ──────────────────────────
      if (attempted.has(spawnId)) {
        console.log(`[CLAIMER] ${spawnId} already attempted — skipping duplicate`);
        return {
          spawnId, groupId, decision: 'skip',
          abortReason: 'already_claimed',
          claimChance: 0, delayMs: 0,
          design: 'unknown', activityScore: 0,
        };
      }
      attempted.add(spawnId);

      // ── Step 1: Detect card design ────────────────────────
      let design: 'new' | 'old' | 'unknown' = 'unknown';
      if (imageBuffer) {
        try {
          const detection = await detectCard(imageBuffer);
          design = detection.generation === 'new' ? 'new'
                 : detection.generation === 'old' ? 'old'
                 : 'unknown';
          console.log(`[CLAIMER] Design: ${design} (${detection.confidence})`);
        } catch (e: unknown) {
          console.error('[CLAIMER] Detector error:', e instanceof Error ? e.message : String(e));
        }
      }

      // ── Step 2: Get activity score for this GC ────────────
      const activity = await activityLog.getScore(groupId);
      console.log(
        `[CLAIMER] Activity in GC: ${activity.messageCount} msgs → score ${activity.score.toFixed(2)}`,
      );

      // ── Step 3: Humaniser decision ────────────────────────
      const decision = await humaniser.decide({ tier, design, issue, activityScore: activity.score });
      console.log(`[CLAIMER] Decision: ${decision.reason}`);

      if (!decision.shouldClaim) {
        return {
          spawnId, groupId, decision: 'skip',
          claimChance: decision.claimChance,
          delayMs: 0, design, activityScore: activity.score,
        };
      }

      // ── Step 4: Abort check before delay ──────────────────
      if (confirmed.has(spawnId)) {
        console.log(`[CLAIMER] ${spawnId} already claimed before delay — aborting`);
        return {
          spawnId, groupId, decision: 'abort',
          abortReason: 'already_claimed',
          claimChance: decision.claimChance,
          delayMs: 0, design, activityScore: activity.score,
        };
      }

      // ── Step 5: Typing simulation + delay ─────────────────
      console.log(`[CLAIMER] Typing... delay ${Math.round(decision.delayMs / 1000)}s`);
      await sock.sendPresenceUpdate('composing', groupId);

      // Wait the full delay, checking for abort every 500ms
      const start = Date.now();
      while (Date.now() - start < decision.delayMs) {
        await new Promise<void>(r => setTimeout(r, 500));
        if (confirmed.has(spawnId)) {
          await sock.sendPresenceUpdate('paused', groupId);
          console.log(`[CLAIMER] ${spawnId} claimed mid-delay — aborting`);
          return {
            spawnId, groupId, decision: 'abort',
            abortReason: 'already_claimed',
            claimChance: decision.claimChance,
            delayMs: Date.now() - start,
            design, activityScore: activity.score,
          };
        }
      }

      // ── Step 6: Final abort check then fire ───────────────
      await sock.sendPresenceUpdate('paused', groupId);

      if (confirmed.has(spawnId)) {
        console.log(`[CLAIMER] ${spawnId} claimed just before fire — aborting`);
        return {
          spawnId, groupId, decision: 'abort',
          abortReason: 'already_claimed',
          claimChance: decision.claimChance,
          delayMs: decision.delayMs,
          design, activityScore: activity.score,
        };
      }

      await sock.sendMessage(groupId, { text: `.claim ${spawnId}` });
      console.log(`[CLAIMER] .claim ${spawnId} fired`);

      // ── Step 7: Retry if no confirmation after 35-50s ─────
      const retryDelay = 35000 + Math.pow(Math.random(), 0.5) * 15000;
      await new Promise<void>(r => setTimeout(r, retryDelay));

      if (!confirmed.has(spawnId)) {
        console.log(`[CLAIMER] No confirmation after ${Math.round(retryDelay / 1000)}s — final retry`);
        await sock.sendMessage(groupId, { text: `.claim ${spawnId}` });
      }

      return {
        spawnId, groupId, decision: 'claim',
        claimChance: decision.claimChance,
        delayMs: decision.delayMs,
        design, activityScore: activity.score,
        firedAt: new Date(),
      };
    },
  };
}

export type Claimer = ReturnType<typeof createClaimer>;
