-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS bot_heartbeat (
  singleton   char(1)   PRIMARY KEY DEFAULT 'X' CHECK (singleton = 'X'),
  pinged_at   timestamptz NOT NULL DEFAULT now(),
  latency_ms  integer   NOT NULL DEFAULT 0,
  status      text      NOT NULL DEFAULT 'offline'  -- 'online' | 'offline'
);

-- Insert the one row if not present
INSERT INTO bot_heartbeat (singleton, pinged_at, latency_ms, status)
VALUES ('X', now(), 0, 'offline')
ON CONFLICT (singleton) DO NOTHING;
