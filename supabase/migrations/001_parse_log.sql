-- ============================================================
-- Migration 001 — parse_log table
--
-- This is the ONLY table needed for the parser validation phase.
-- All other tables (card_events, bot_health, etc.) will be added
-- when card claiming begins.
--
-- Run this in the Supabase SQL Editor (Project → SQL Editor).
-- ============================================================

CREATE TABLE IF NOT EXISTS parse_log (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   timestamptz DEFAULT now(),
  group_id     text,
  sender_jid   text,
  raw_text     text        NOT NULL,
  template_id  text,                    -- null if no template matched
  fields_json  jsonb,                   -- parsed fields; null if no match
  trace_json   jsonb       NOT NULL,    -- full ParseTrace always stored
  line_count   int
);

-- Index for the realtime feed query (newest first, filtered by group).
CREATE INDEX IF NOT EXISTS parse_log_created_at_idx
  ON parse_log (created_at DESC);

-- Enable Row Level Security (RLS).
-- During development we allow all operations from the service role.
-- Tighten this when moving to production.
ALTER TABLE parse_log ENABLE ROW LEVEL SECURITY;

-- Allow the service role (whatsapp-bot) to insert rows.
CREATE POLICY "service role can insert"
  ON parse_log FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Allow the service role to select rows.
CREATE POLICY "service role can select"
  ON parse_log FOR SELECT
  TO service_role
  USING (true);

-- Allow the anon role (dashboard) to select rows.
-- The dashboard only reads — it never writes to this table directly.
CREATE POLICY "anon can select"
  ON parse_log FOR SELECT
  TO anon
  USING (true);

-- Enable Supabase Realtime on this table so the dashboard can
-- subscribe to INSERT events without polling.
-- Run in Supabase Dashboard → Database → Replication, OR via SQL:
-- ALTER PUBLICATION supabase_realtime ADD TABLE parse_log;
