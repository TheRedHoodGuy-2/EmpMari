-- ============================================================
-- Mariabelle V2 — Full Schema
-- Run this in Supabase SQL Editor. All statements are idempotent.
-- ============================================================

-- ── known_bots ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS known_bots (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  jid        text        UNIQUE NOT NULL,
  number     text        NOT NULL,
  status     text        DEFAULT 'verified'
             CHECK (status IN ('verified', 'unverified'))
);

-- ── parse_log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parse_log (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at         timestamptz DEFAULT now(),
  group_id           text,
  sender_jid         text,
  sender_type        text,
  message_id         text,
  quoted_message_id  text,
  has_image          boolean     DEFAULT false,
  raw_text           text        NOT NULL,
  line_count         int,
  template_id        text,
  fields_json        jsonb,
  trace_json         jsonb       NOT NULL,
  auto_flagged       boolean     DEFAULT false
);

-- Add new columns to existing table (idempotent)
ALTER TABLE parse_log ADD COLUMN IF NOT EXISTS message_id        text;
ALTER TABLE parse_log ADD COLUMN IF NOT EXISTS quoted_message_id text;
ALTER TABLE parse_log ADD COLUMN IF NOT EXISTS has_image         boolean DEFAULT false;
ALTER TABLE parse_log ADD COLUMN IF NOT EXISTS auto_flagged      boolean DEFAULT false;

-- Indexes
CREATE INDEX IF NOT EXISTS parse_log_created_at_idx   ON parse_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parse_log_message_id   ON parse_log (message_id);
CREATE INDEX IF NOT EXISTS idx_parse_log_quoted_id    ON parse_log (quoted_message_id);
CREATE INDEX IF NOT EXISTS idx_parse_log_group_id     ON parse_log (group_id);
CREATE INDEX IF NOT EXISTS idx_parse_log_sender_jid   ON parse_log (sender_jid);

-- ── card_events ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS card_events (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   timestamptz DEFAULT now(),
  group_id     text        NOT NULL,
  spawn_id     text        UNIQUE NOT NULL,
  card_name    text,
  tier         text,
  price        int,
  issue        int,
  image_url    text,
  spawn_log_id uuid        REFERENCES parse_log(id),
  claimed      boolean     DEFAULT false,
  claimed_at   timestamptz,
  claimer_jid  text,
  claim_log_id uuid        REFERENCES parse_log(id)
);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE known_bots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE parse_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_events  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role all on known_bots"
  ON known_bots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon read known_bots"
  ON known_bots FOR SELECT TO anon USING (true);

CREATE POLICY "service role all on parse_log"
  ON parse_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon read parse_log"
  ON parse_log FOR SELECT TO anon USING (true);

CREATE POLICY "service role all on card_events"
  ON card_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon read card_events"
  ON card_events FOR SELECT TO anon USING (true);

-- ── Realtime ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'parse_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE parse_log;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'card_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE card_events;
  END IF;
END $$;
