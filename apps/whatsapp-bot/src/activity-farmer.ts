// ============================================================
// Activity Farmer — keeps group activity scores high so the
// humaniser favours faster, more aggressive claiming.
//
// Strategy (to be spec'd by architect):
//   - Monitor groups whose activity score is below a threshold
//   - Send humanised messages at random intervals to boost score
//   - Only active during configured hours
//   - Respects the global send queue (500ms gap)
//   - Never sends in real groups while test mode is active
//
// NOT YET IMPLEMENTED — stub only.
// Ask the architect to spec Section X before building.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WASocket } from '@whiskeysockets/baileys';

export type ActivityFarmerConfig = {
  targetGroups:      string[];   // group JIDs to farm
  minScoreThreshold: number;     // only farm if score < this (0.0–1.0)
  activeHoursUTC:    [number, number]; // e.g. [8, 22] = 8am–10pm UTC
  intervalMinMs:     number;     // min ms between farming messages
  intervalMaxMs:     number;     // max ms between farming messages
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createActivityFarmer(_db: SupabaseClient, _sock: WASocket) {
  // TODO: implement after architect specs this module
  return {
    start(_config: ActivityFarmerConfig): void {
      console.warn('[ACTIVITY-FARMER] Not yet implemented — stub only');
    },
    stop(): void {
      // no-op
    },
  };
}

export type ActivityFarmer = ReturnType<typeof createActivityFarmer>;
