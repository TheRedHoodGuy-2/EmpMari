import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClaimInput, ClaimDecision, HumaniserConfigRow } from './types.js';

export function createHumaniser(supabase: SupabaseClient) {
  let configCache: HumaniserConfigRow[] = [];
  let cacheLoadedAt = 0;
  const CACHE_TTL = 5 * 60 * 1000;

  async function loadConfig(): Promise<void> {
    if (Date.now() - cacheLoadedAt < CACHE_TTL && configCache.length > 0) return;
    const { data, error } = await supabase.from('humaniser_config').select('*');
    if (error) {
      console.error('[HUMANISER] Config load failed:', error.message);
      return;
    }
    configCache = data as HumaniserConfigRow[];
    cacheLoadedAt = Date.now();
    console.log(`[HUMANISER] Config loaded — ${configCache.length} rules`);
  }

  function findConfig(tier: string, design: string, issue: number): HumaniserConfigRow | null {
    const issueStr = String(issue);
    const candidates = [
      // exact tier + exact design + exact issue
      configCache.find(r => r.tier === tier && r.design === design && r.issue === issueStr),
      // exact tier + exact design + any issue
      configCache.find(r => r.tier === tier && r.design === design && r.issue === 'any'),
      // exact tier + any design + exact issue
      configCache.find(r => r.tier === tier && r.design === 'any' && r.issue === issueStr),
      // exact tier + any design + any issue
      configCache.find(r => r.tier === tier && r.design === 'any' && r.issue === 'any'),
    ];
    return candidates.find(Boolean) ?? null;
  }

  function weightedDelay(minMs: number, maxMs: number, activityScore: number): number {
    // Higher activity = faster (toward min). Uses sqrt weighting to bias faster.
    const range  = maxMs - minMs;
    const factor = 1 - Math.pow(activityScore, 0.5);
    const raw    = minMs + range * factor;
    // ±300ms jitter so it never fires at the exact same time
    const jitter = (Math.random() - 0.5) * 600;
    return Math.round(Math.max(minMs, Math.min(maxMs, raw + jitter)));
  }

  return {
    async decide(input: ClaimInput): Promise<ClaimDecision> {
      await loadConfig();

      const design = input.design === 'unknown' ? 'new' : input.design;
      const config = findConfig(input.tier, design, input.issue);

      if (!config) {
        return {
          shouldClaim: false,
          claimChance: 0,
          delayMs:     15000,
          configUsed:  'none',
          reason:      `No config found for T${input.tier} ${design} #${input.issue}`,
        };
      }

      const activityModifier = input.activityScore >= 0.5
        ? config.activity_bonus   *  input.activityScore
        : -(config.activity_penalty * (1 - input.activityScore));

      const finalChance = Math.max(0, Math.min(100,
        config.claim_chance + Math.round(activityModifier),
      ));

      const roll        = Math.floor(Math.random() * 100);
      const shouldClaim = roll < finalChance;
      const delayMs     = weightedDelay(config.delay_min_ms, config.delay_max_ms, input.activityScore);

      return {
        shouldClaim,
        claimChance: finalChance,
        delayMs,
        configUsed: config.notes ?? `T${config.tier} ${config.design} #${config.issue}`,
        reason: shouldClaim
          ? `Roll ${roll} < ${finalChance}% — claiming in ${Math.round(delayMs / 1000)}s`
          : `Roll ${roll} >= ${finalChance}% — skipping`,
      };
    },

    // Pre-warm: call at boot so decide() is instant when first card spawns
    async warmCache(): Promise<void> {
      await loadConfig();
    },

    // Force cache refresh (e.g. after dashboard updates config)
    invalidateCache(): void {
      cacheLoadedAt = 0;
    },
  };
}

export type Humaniser = ReturnType<typeof createHumaniser>;
