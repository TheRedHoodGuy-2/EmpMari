export interface ClaimInput {
  tier:          string;          // '1'-'6' or 'S'
  design:        'new' | 'old' | 'unknown';
  issue:         number;
  activityScore: number;          // 0.0 to 1.0 from activity-log
}

export interface ClaimDecision {
  shouldClaim:  boolean;
  claimChance:  number;           // final % after activity adjustment
  delayMs:      number;           // exact ms to wait before firing
  configUsed:   string;           // which config row matched (for logging)
  reason:       string;           // human readable
}

export interface HumaniserConfigRow {
  id:               string;
  tier:             string;
  design:           string;
  issue:            string;
  claim_chance:     number;
  activity_bonus:   number;
  activity_penalty: number;
  delay_min_ms:     number;
  delay_max_ms:     number;
  notes:            string | null;
}
