-- ============================================================
-- Mariabelle V2 — Full Schema
-- Run this in Supabase SQL Editor. All statements are idempotent.
-- ============================================================

-- ── players ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS players (
  jid        text        PRIMARY KEY,
  number     text        NOT NULL,
  moniker    text,
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS players_number_idx ON players (number);

-- ── groups ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  group_id   text        PRIMARY KEY,
  name       text,
  updated_at timestamptz DEFAULT now()
);

-- ── known_bots ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS known_bots (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  jid        text        UNIQUE NOT NULL,
  lid        text        UNIQUE,
  number     text        NOT NULL,
  moniker    text,
  status     text        DEFAULT 'verified'
             CHECK (status IN ('verified', 'unverified'))
);
ALTER TABLE known_bots ADD COLUMN IF NOT EXISTS moniker text;
ALTER TABLE known_bots ADD COLUMN IF NOT EXISTS lid     text UNIQUE;

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
ALTER TABLE parse_log ADD COLUMN IF NOT EXISTS sender_number     text;   -- resolved phone digits (not LID)

-- Indexes
CREATE INDEX IF NOT EXISTS parse_log_created_at_idx   ON parse_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parse_log_message_id   ON parse_log (message_id);
CREATE INDEX IF NOT EXISTS idx_parse_log_quoted_id    ON parse_log (quoted_message_id);
CREATE INDEX IF NOT EXISTS idx_parse_log_group_id     ON parse_log (group_id);
CREATE INDEX IF NOT EXISTS idx_parse_log_sender_jid   ON parse_log (sender_jid);

-- ── card_events ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS card_events (
  id                   uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at           timestamptz DEFAULT now(),
  group_id             text        NOT NULL,
  spawn_id             text        UNIQUE NOT NULL,
  card_name            text,
  tier                 text,
  price                int,
  issue                int,
  image_url            text,
  spawn_log_id         uuid        REFERENCES parse_log(id),
  -- Humaniser decision
  decision_should_claim boolean,
  decision_reason      text,
  decision_delay_ms    int,
  -- Claim outcome
  claimed              boolean     DEFAULT false,
  claim_source         text        CHECK (claim_source IN ('bot', 'other')),
  claimed_at           timestamptz,
  claimer_jid          text,
  claim_log_id         uuid        REFERENCES parse_log(id)
);
ALTER TABLE card_events ADD COLUMN IF NOT EXISTS decision_should_claim boolean;
ALTER TABLE card_events ADD COLUMN IF NOT EXISTS decision_reason       text;
ALTER TABLE card_events ADD COLUMN IF NOT EXISTS decision_delay_ms     int;
ALTER TABLE card_events ADD COLUMN IF NOT EXISTS claim_source          text CHECK (claim_source IN ('bot', 'other'));

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE players      ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups       ENABLE ROW LEVEL SECURITY;
ALTER TABLE known_bots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE parse_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_events  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='players'    AND policyname='service role all on players')    THEN CREATE POLICY "service role all on players"    ON players    FOR ALL    TO service_role USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='players'    AND policyname='anon read players')             THEN CREATE POLICY "anon read players"             ON players    FOR SELECT TO anon        USING (true);               END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='groups'     AND policyname='service role all on groups')    THEN CREATE POLICY "service role all on groups"    ON groups     FOR ALL    TO service_role USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='groups'     AND policyname='anon read groups')              THEN CREATE POLICY "anon read groups"              ON groups     FOR SELECT TO anon        USING (true);               END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='known_bots' AND policyname='service role all on known_bots') THEN CREATE POLICY "service role all on known_bots" ON known_bots FOR ALL    TO service_role USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='known_bots' AND policyname='anon read known_bots')          THEN CREATE POLICY "anon read known_bots"          ON known_bots FOR SELECT TO anon        USING (true);               END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='parse_log'  AND policyname='service role all on parse_log') THEN CREATE POLICY "service role all on parse_log" ON parse_log  FOR ALL    TO service_role USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='parse_log'  AND policyname='anon read parse_log')           THEN CREATE POLICY "anon read parse_log"           ON parse_log  FOR SELECT TO anon        USING (true);               END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='card_events' AND policyname='service role all on card_events') THEN CREATE POLICY "service role all on card_events" ON card_events FOR ALL TO service_role USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='card_events' AND policyname='anon read card_events')         THEN CREATE POLICY "anon read card_events"         ON card_events FOR SELECT TO anon       USING (true);               END IF;
END $$;

-- ── Realtime ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'known_bots'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE known_bots;
  END IF;
END $$;

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
