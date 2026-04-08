-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS control_config (
  singleton            char(1) PRIMARY KEY DEFAULT 'X' CHECK (singleton = 'X'),
  heartbeat_at         timestamptz,
  connection_status    text NOT NULL DEFAULT 'unknown',
  last_send_latency_ms int
);

-- Insert the singleton row if not present
INSERT INTO control_config (singleton)
VALUES ('X')
ON CONFLICT (singleton) DO NOTHING;

-- If table already existed without these columns, add them safely
ALTER TABLE control_config
  ADD COLUMN IF NOT EXISTS heartbeat_at         timestamptz,
  ADD COLUMN IF NOT EXISTS connection_status    text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_send_latency_ms int;
