-- Migration 007: claim_mode on control_config
-- claim_mode: 'auto'   = claim every spawn, ignore humaniser
--             'manual' = apply humaniser + tier filters
--
-- claim_tiers: JSON array of enabled tiers, e.g. ["1","2","3","4","5","6","S"]
-- Remove a tier from the array to stop claiming it in manual mode.

ALTER TABLE control_config
  ADD COLUMN IF NOT EXISTS claim_mode  text NOT NULL DEFAULT 'auto'
    CHECK (claim_mode IN ('auto', 'manual')),
  ADD COLUMN IF NOT EXISTS claim_tiers jsonb NOT NULL DEFAULT '["1","2","3","4","5","6","S"]'::jsonb;

UPDATE control_config
SET
  claim_mode  = COALESCE(claim_mode,  'auto'),
  claim_tiers = COALESCE(claim_tiers, '["1","2","3","4","5","6","S"]'::jsonb)
WHERE singleton = 'X';
