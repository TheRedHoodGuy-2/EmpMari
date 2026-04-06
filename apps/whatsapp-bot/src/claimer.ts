// ============================================================
// Claimer — .claim fires EXACTLY ONCE per spawnId, ever.
// Delay comes from the humaniser decision, not from brackets.
// ============================================================

import type { WASocket } from '@whiskeysockets/baileys';
import type { TypingSimulator } from '@mariabelle/humaniser';

const attempted = new Set<string>(); // spawnIds we have sent .claim for

export function initClaimer(sock: WASocket, typingSim: TypingSimulator) {
  return {
    /**
     * @param spawnId   Card spawn ID
     * @param groupId   Group JID to send into
     * @param delayMs   Exact ms to show typing before firing (from humaniser.decide)
     */
    async claim(spawnId: string, groupId: string, delayMs: number): Promise<void> {
      if (attempted.has(spawnId)) {
        console.log(`[CLAIMER] ${spawnId} already attempted — skipping duplicate`);
        return;
      }
      attempted.add(spawnId);

      console.log(`[CLAIMER] composing for ${Math.round(delayMs / 1000)}s — ${spawnId}`);
      await typingSim.composingFor(groupId, delayMs);
      await sock.sendMessage(groupId, { text: `.claim ${spawnId}` });
      console.log(`[CLAIMER] .claim ${spawnId} sent`);
    },

    confirm(_spawnId: string): void {},
  };
}

export type Claimer = ReturnType<typeof initClaimer>;
