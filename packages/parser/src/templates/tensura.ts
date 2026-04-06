// ============================================================
// Tensura WhatsApp Bot — Message Templates
//
// All string literals are taken from real paste-test samples.
// Lines marked VERIFY should be confirmed against a live message
// if any doubt exists about emoji codepoints or spacing.
// ============================================================

import type { Template } from '../types.js';
import type { Registry } from '../registry.js';

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
// Bot quotes the player's .claim message and replies.
// Real sample: "🎉 You claimed Risty!\n\n🀄 Name: Risty\n⭐ Tier: 1"
// 4 lines (L0–L3).
//
// ⚠️  VERIFY: exact line count, emoji, and whether "Name"/"Tier"
//     labels have bold markers (*) or not. Sample shows NO bold here.
const CLAIM_SUCCESS: Template = {
  id: 'CLAIM_SUCCESS',
  lineCount: 4,
  lines: [
    // L0 — ⚠️ VERIFY: 🎉 codepoint U+1F389
    {
      type: 'capture',
      prefix: '🎉 You claimed ',
      suffix: '!',
      key: 'cardName',
      pattern: /.+/,
    },
    // L1 blank
    { type: 'literal', value: '' },
    // L2 — confirmed: 🎴 U+1F3B4, no bold on "Name" unlike CARD_SPAWN
    {
      type: 'capture',
      prefix: '🎴 Name: ',
      suffix: '',
      key: 'nameConfirm',
      pattern: /.+/,
    },
    // L3 — note: no bold (*) on "Tier" unlike CARD_SPAWN
    {
      type: 'capture',
      prefix: '⭐ Tier: ',
      suffix: '',
      key: 'tier',
      pattern: /[1-9S]/,
      transform: (v: string): string | number => v === 'S' ? 'S' : parseInt(v, 10),
    },
  ],
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

// ─── Register all ─────────────────────────────────────────────
export function registerTensuraTemplates(registry: Registry): void {
  registry.register(BOT_PING);
  registry.register(CARD_SPAWN);
  registry.register(CLAIM_SUCCESS);
  registry.register(CLAIM_TAKEN);
  registry.register(PLAYER_CMD_CLAIM);
}
