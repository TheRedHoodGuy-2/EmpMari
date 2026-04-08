-- Migration 006: player_cards table
-- Stores each player's card collection as seen from .col command.
-- Entire collection for a jid+gc combo is replaced on each .col run.

CREATE TABLE IF NOT EXISTS player_cards (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  jid        text        NOT NULL,
  card_id    text        REFERENCES card_db(card_id) ON DELETE SET NULL,
  card_name  text        NOT NULL,
  tier       integer     NOT NULL,
  gc_id      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_cards_jid_gc ON player_cards (jid, gc_id);
CREATE INDEX IF NOT EXISTS player_cards_card_id ON player_cards (card_id);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE player_cards;
