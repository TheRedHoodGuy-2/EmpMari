import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActivityLogEntry, ActivityScore } from './types.js';

const WINDOW_MINUTES         = 60;
const FULL_ACTIVITY_THRESHOLD = 4; // 4+ msgs in window = score 1.0

export function createActivityLog(supabase: SupabaseClient) {
  return {
    // Call this every time YOU send a message
    async record(entry: ActivityLogEntry): Promise<void> {
      const { error } = await supabase.from('activity_log').insert({
        group_id:   entry.groupId,
        message_id: entry.messageId,
      });
      if (error) console.error('[ACTIVITY-LOG] Record failed:', error.message);
    },

    // Returns 0.0 (inactive) to 1.0 (very active) for a specific GC
    async getScore(groupId: string): Promise<ActivityScore> {
      const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('activity_log')
        .select('id', { count: 'exact' })
        .eq('group_id', groupId)
        .gte('created_at', since);

      if (error) {
        console.error('[ACTIVITY-LOG] Score query failed:', error.message);
        return { groupId, messageCount: 0, score: 0, windowMinutes: WINDOW_MINUTES };
      }

      const count = data?.length ?? 0;
      const score = Math.min(1.0, count / FULL_ACTIVITY_THRESHOLD);

      return { groupId, messageCount: count, score, windowMinutes: WINDOW_MINUTES };
    },
  };
}

export type ActivityLog = ReturnType<typeof createActivityLog>;
