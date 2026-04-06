export interface SpawnEvent {
  spawnId:     string;
  groupId:     string;
  tier:        string;
  issue:       number;
  imageBuffer: Buffer | null;
  rawCaption:  string;
  senderJid:   string;
}

export type AbortReason =
  | 'already_claimed'  // CLAIM_SUCCESS / CLAIM_TAKEN seen for this spawnId
  | 'decision_no'      // humaniser said no
  | 'no_image'         // image required but missing
  | 'detector_error';  // card-detector threw

export interface ClaimAttempt {
  spawnId:       string;
  groupId:       string;
  decision:      'claim' | 'skip' | 'abort';
  abortReason?:  AbortReason;
  claimChance:   number;
  delayMs:       number;
  design:        string;
  activityScore: number;
  firedAt?:      Date;
}
