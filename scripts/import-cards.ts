/**
 * Import cards from all_cards.json (output of scrape.js) into Supabase card_db.
 *
 * Usage:
 *   npx tsx --env-file=apps/whatsapp-bot/.env scripts/import-cards.ts ./scripts/all_cards.json
 *
 * Safe to run multiple times — upserts on card_id.
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// ── Env ───────────────────────────────────────────────────────
const url = process.env['SUPABASE_URL'];
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = createClient(url, key);

// ── Types matching scrape.js output ──────────────────────────
type ScraperCard = {
  id:           string;
  name:         string;
  series:       string;
  tier:         string | number;
  stars:        number;
  img:          string;
  description:  string;
  event:        string | null;
  wishlistCount: number;
  owners:       string[];
  creatorInfo?: { username?: string };
};

type ScraperOutput = {
  meta: { scrapedAt: string; totalCards: number; source: string };
  cards: ScraperCard[];
};

// ── Main ──────────────────────────────────────────────────────
const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: npx tsx scripts/import-cards.ts <path-to-all_cards.json>');
  process.exit(1);
}

console.log(`\n📦 Reading ${filePath}…`);
const raw: ScraperOutput = JSON.parse(readFileSync(filePath, 'utf8')) as ScraperOutput;
const { meta, cards } = raw;

console.log(`   Cards in file : ${cards.length.toLocaleString()}`);
console.log(`   Scraped at    : ${meta.scrapedAt}`);
console.log(`   Source        : ${meta.source}\n`);

const BATCH = 500;
let imported = 0;
let errors   = 0;

for (let i = 0; i < cards.length; i += BATCH) {
  const batch = cards.slice(i, i + BATCH).map(c => ({
    card_id:        c.id,
    name:           c.name,
    series:         c.series ?? null,
    tier:           String(c.tier).toUpperCase(),
    stars:          c.stars ?? null,
    image_url:      c.img ?? null,
    description:    c.description ?? null,
    event:          c.event ?? null,
    wishlist_count: c.wishlistCount ?? 0,
    owner_names:    JSON.stringify(c.owners ?? []),
    scraped_at:     meta.scrapedAt,
    updated_at:     new Date().toISOString(),
  }));

  const { error } = await db
    .from('card_db')
    .upsert(batch, { onConflict: 'card_id' });

  if (error) {
    console.error(`   ❌ Batch ${i}–${i + batch.length} failed:`, error.message);
    errors += batch.length;
  } else {
    imported += batch.length;
    const pct = ((imported / cards.length) * 100).toFixed(1);
    process.stdout.write(`\r   Imported ${imported.toLocaleString()} / ${cards.length.toLocaleString()} (${pct}%) `);
  }
}

console.log(`\n\n✅ Done — ${imported.toLocaleString()} cards imported, ${errors} errors`);
if (errors > 0) process.exit(1);
