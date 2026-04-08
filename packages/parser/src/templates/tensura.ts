// ============================================================
// Tensura WhatsApp Bot — Message Templates
//
// All string literals are taken from real paste-test samples.
// Lines marked VERIFY should be confirmed against a live message
// if any doubt exists about emoji codepoints or spacing.
// ============================================================

import type { Template, MultiTemplate, Registry } from '../types.js';

// ─── BOT_PING ────────────────────────────────────────────────
// Real sample — 2 lines:
//   Mata Mata!
//   > 144ms
// Confirmed from live dashboard trace.
const BOT_PING: Template = {
  id: 'BOT_PING',
  lineCount: 2,
  lines: [
    { type: 'literal', value: 'Mata Mata!' },
    {
      type: 'capture',
      prefix: '> ',   // ">" + space
      suffix: 'ms',
      key: 'pingMs',
      pattern: /\d+/,
      transform: Number,
    },
  ],
};

// ─── CARD_SPAWN ──────────────────────────────────────────────
// 9 lines (L0–L8). Real sample confirmed via paste test.
// L0:  🎊 A wild card has appeared! 🎊
// L1:  (blank)
// L2:  🀄 *Name*: <cardName>
// L3:  ⭐ *Tier*: <tier>
// L4:  💸 *Price*: $<price>
// L5:  🆔 *Spawn ID*: <spawnId>
// L6:  #️⃣ *Issue*: #<issue>
// L7:  (blank)
// L8:  Claim it with *`.claim <claimId>`*
//
// Cross-validation: spawnId must equal claimId.
// Shape strips claimId from the output fields.
//
// ⚠️  VERIFY: emoji codepoints on L0, L2, L3, L4, L5, L6.
//     The paste test confirmed these strings but double-check
//     that normalize() is not stripping any of these emoji.
//     Emoji are in the BMP (U+1F300–U+1FAFF) — normalize only
//     decodes U+1D400–U+1D7FF math variants, so emoji pass through.
const CARD_SPAWN: Template = {
  id: 'CARD_SPAWN',
  lineCount: 9,
  lines: [
    // L0
    { type: 'literal', value: '🎊 A wild card has appeared! 🎊' },
    // L1 blank
    { type: 'literal', value: '' },
    // L2 — confirmed: 🎴 U+1F3B4 (flower playing card), not 🀄
    {
      type: 'capture',
      prefix: '🎴 *Name*: ',
      suffix: '',
      key: 'cardName',
      pattern: /.+/,
    },
    // L3 — ⚠️ VERIFY: ⭐ codepoint U+2B50, space after colon
    {
      type: 'capture',
      prefix: '⭐ *Tier*: ',
      suffix: '',
      key: 'tier',
      pattern: /[1-9S]/,
      transform: (v: string): string | number => v === 'S' ? 'S' : parseInt(v, 10),
    },
    // L4 — ⚠️ VERIFY: 💸 codepoint U+1F4B8, $ immediately after colon+space
    {
      type: 'capture',
      prefix: '💸 *Price*: $',
      suffix: '',
      key: 'price',
      pattern: /\d+/,
      transform: Number,
    },
    // L5 — ⚠️ VERIFY: 🆔 codepoint U+1F194, space after colon
    {
      type: 'capture',
      prefix: '🆔 *Spawn ID*: ',
      suffix: '',
      key: 'spawnId',
      pattern: /[a-zA-Z0-9]+/,
    },
    // L6 — ⚠️ VERIFY: #️⃣ is U+0023 U+FE0F U+20E3 (keycap sequence), # before issue number
    {
      type: 'capture',
      prefix: '#️⃣ *Issue*: #',
      suffix: '',
      key: 'issue',
      pattern: /\d+/,
      transform: Number,
    },
    // L7 blank
    { type: 'literal', value: '' },
    // L8 — ⚠️ VERIFY: backtick, .claim, space, closing backtick+*
    {
      type: 'capture',
      prefix: 'Claim it with *`.claim ',
      suffix: '`*',
      key: 'claimId',
      pattern: /[a-zA-Z0-9]+/,
    },
  ],
  validate: (f): boolean => f['spawnId'] === f['claimId'],
  shape: (f) => ({
    cardName: f['cardName'],
    tier:     f['tier'],
    price:    f['price'],
    spawnId:  f['spawnId'],
    issue:    f['issue'],
    // claimId intentionally omitted — redundant after validation
  }),
};

// ─── CLAIM_SUCCESS ───────────────────────────────────────────
// Flexible multiMatch — scans all lines for the success marker so that
// extra lines added by Tensura (e.g. bonus messages, rank-ups) don't
// cause a miss. The rigid lineCount=4 approach breaks on format changes.
const CLAIM_SUCCESS: MultiTemplate = {
  id: 'CLAIM_SUCCESS',
  // Start: any line that begins with the success emoji
  isStart: (line) => line.startsWith('🎉 You claimed '),
  // End: we capture the tier line, but also stop after a few lines
  isEnd: (line) => /^⭐\s*Tier:\s*[1-9S]/i.test(line),
  extract: (lines) => {
    let cardName: string | null = null;
    let tier: string | number | null = null;

    for (const line of lines) {
      // "🎉 You claimed Risty!"
      if (!cardName) {
        const m = line.match(/^🎉\s*You claimed\s+(.+?)!?$/);
        if (m) { cardName = m[1]!.trim(); continue; }
      }
      // "⭐ Tier: 4"
      if (!tier) {
        const m = line.match(/^⭐\s*Tier:\s*([1-9S])/i);
        if (m) { tier = m[1] === 'S' ? 'S' : parseInt(m[1]!, 10); }
      }
    }

    if (!cardName) return null;
    return { templateId: 'CLAIM_SUCCESS', fields: { cardName, tier } };
  },
};

// ─── CLAIM_TAKEN ─────────────────────────────────────────────
// Bot replies when the card was already claimed.
// ⚠️  VERIFY: 😟 codepoint U+1F61F, exact punctuation.
const CLAIM_TAKEN: Template = {
  id: 'CLAIM_TAKEN',
  lineCount: 1,
  lines: [
    { type: 'literal', value: '😟 This card has already been claimed.' },
  ],
};

// ─── PLAYER_CMD_CLAIM ────────────────────────────────────────
// Player sends: ".claim f728c"
// Captured so we can link it to the bot's CLAIM_SUCCESS reply via
// quoted_message_id.
const PLAYER_CMD_CLAIM: Template = {
  id: 'PLAYER_CMD_CLAIM',
  lineCount: 1,
  lines: [
    {
      type: 'capture',
      prefix: '.claim ',
      suffix: '',
      key: 'spawnId',
      pattern: /[a-zA-Z0-9]+/,
    },
  ],
};

// ─── MY_SERIES ────────────────────────────────────────────────
// Sent when a player runs .myseries. Variable line count.
// First line:  📚 *My Series*
// Data lines:  - SeriesName *(count)*
// No explicit end line — last data line is the end.
//
// After normalize(): bold unicode → plain ASCII, so:
//   first line becomes: 📚 *My Series*
//   data lines:  - SeriesName *(count)*
const MY_SERIES: MultiTemplate = {
  id: 'MY_SERIES',
  isStart: (line) => line === '📚 *My Series*',
  isEnd: (line) => /^- .+ \*`\(\d+\)`\*$/.test(line),
  extract: (lines) => {
    const series: { name: string; count: number }[] = [];
    for (const line of lines.slice(1)) {
      const m = line.match(/^- (.+?) \*`\((\d+)\)`\*$/);
      if (m) series.push({ name: m[1]!, count: parseInt(m[2]!, 10) });
    }
    if (series.length === 0) return null;
    return { templateId: 'MY_SERIES', fields: { series } };
  },
};

// ─── SERIES_LEADERBOARD ───────────────────────────────────────
// Sent when a player runs .slb [series]. Variable line count.
// Start: ╔═ ❰ 🏆 TOP COLLECTORS ❱ ═╗  (after normalize: same)
// End:   ╚═════...═╝
// Series line: ║ 📚 Series: <name>
// Rank lines:  ║ 1. PlayerName
// Count lines: ║ └ N cards
const SERIES_LEADERBOARD: MultiTemplate = {
  id: 'SERIES_LEADERBOARD',
  isStart: (line) => line.includes('TOP COLLECTORS'),
  isEnd: (line) => /^╚[═]+╝$/.test(line),
  extract: (lines) => {
    let series = '';
    const leaders: { rank: number; name: string; count: number }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Series name
      const seriesMatch = line.match(/^║\s*📚\s*Series:\s*(.+)$/);
      if (seriesMatch) { series = seriesMatch[1]!.trim(); continue; }
      // Rank + name
      const rankMatch = line.match(/^║\s*(\d+)\.\s*(.+)$/);
      if (rankMatch) {
        // Look ahead for count line
        const nextLine = lines[i + 1] ?? '';
        const countMatch = nextLine.match(/^║\s*└\s*(\d+)\s*cards?$/i);
        leaders.push({
          rank:  parseInt(rankMatch[1]!, 10),
          name:  rankMatch[2]!.trim(),
          count: countMatch ? parseInt(countMatch[1]!, 10) : 0,
        });
        if (countMatch) i++; // skip the count line
      }
    }

    if (!series || leaders.length === 0) return null;
    return { templateId: 'SERIES_LEADERBOARD', fields: { series, leaders } };
  },
};

// ─── CARD_COLLECTION ──────────────────────────────────────────
// Sent when a player runs .col. Variable line count.
// Line 0: 🃏 *Your Card Collection*:
// Lines:  N. 🃏 *Card Name* (Tier: X)
// Owner = contextInfo.participant (Tensura bot replies to the person who ran .col)
const CARD_COLLECTION: MultiTemplate = {
  id: 'CARD_COLLECTION',
  isStart: (line) => line === '🃏 *Your Card Collection*:',
  isEnd:   (line) => /^\d+\.\s*🃏\s*\*.+\*\s*\(Tier:\s*\w+\)$/.test(line),
  extract: (lines) => {
    const cards: { name: string; tier: number }[] = [];
    for (const line of lines) {
      const m = line.match(/^\d+\.\s*🃏\s*\*(.+?)\*\s*\(Tier:\s*(\d+)\)/);
      if (m) cards.push({ name: m[1]!.trim(), tier: parseInt(m[2]!, 10) });
    }
    if (cards.length === 0) return null;
    return { templateId: 'CARD_COLLECTION', fields: { cards } };
  },
};

// ─── Register all ─────────────────────────────────────────────
export function registerTensuraTemplates(registry: Registry): void {
  registry.register(BOT_PING);
  registry.register(CARD_SPAWN);
  registry.registerMulti(CLAIM_SUCCESS);
  registry.register(CLAIM_TAKEN);
  registry.register(PLAYER_CMD_CLAIM);
  registry.registerMulti(MY_SERIES);
  registry.registerMulti(SERIES_LEADERBOARD);
  registry.registerMulti(CARD_COLLECTION);
}
