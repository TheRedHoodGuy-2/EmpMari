-- ============================================================
-- Migration 002 — groups + players tables
--
-- groups: stores WhatsApp group metadata (name fetched via Baileys)
-- players: stores phone number + push name (moniker) per JID
--
-- Run in Supabase SQL Editor after 001_parse_log.sql
-- ============================================================

-- ── groups ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS groups (
  group_id    text        PRIMARY KEY,           -- e.g. 120363xxx@g.us
  name        text,                              -- group subject from Baileys
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access on groups"
    ON groups FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "anon can select groups"
    ON groups FOR SELECT TO anon
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Realtime for live group name updates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'groups'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE groups;
  END IF;
END $$;

-- ── players ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS players (
  jid         text        PRIMARY KEY,           -- normalized e.g. 628xxx@s.whatsapp.net
  number      text        NOT NULL,              -- digits only, no @
  moniker     text,                              -- push name from WhatsApp (display name)
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS players_number_idx ON players (number);

ALTER TABLE players ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access on players"
    ON players FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "anon can select players"
    ON players FOR SELECT TO anon
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'players'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE players;
  END IF;
END $$;
