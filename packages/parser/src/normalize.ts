// ============================================================
// @mariabelle/parser — normalize
//
// Pure function. Converts math Unicode text to plain ASCII.
// Same input always produces the same output.
// No dependencies outside this package.
// ============================================================

// ── Step 1: Build math-Unicode → ASCII lookup map ────────────
//
// Unicode Mathematical Alphanumeric Symbols (U+1D400–U+1D7FF)
// encode styled text (Bold, Italic, Script, etc.) using codepoints
// outside the BMP. These arrive as surrogate pairs in JS strings.
//
// We iterate with codePointAt() (not charCodeAt()) so surrogate
// pairs are read as a single codepoint value > 0xFFFF.
//
// Design choice: the map is built once at module load; no per-call
// allocation. We use a plain Map<number,string> keyed by codepoint.

const MATH_MAP: ReadonlyMap<number, string> = buildMathMap();

function buildMathMap(): Map<number, string> {
  const map = new Map<number, string>();

  // Helper: add a contiguous block starting at `start`,
  // mapping to ASCII chars starting at `asciiBase` for `count` chars.
  function addBlock(start: number, asciiBase: number, count: number): void {
    for (let i = 0; i < count; i++) {
      map.set(start + i, String.fromCharCode(asciiBase + i));
    }
  }

  // ── Clean alphabet blocks (no holes) ─────────────────────────
  // Each block is 26 uppercase OR 26 lowercase letters in sequence.
  // "Clean" = no codepoints in the range are pre-empted by other
  // Unicode characters, so the simple offset formula works.

  // Mathematical Bold
  addBlock(0x1D400, 0x41, 26); // A-Z
  addBlock(0x1D41A, 0x61, 26); // a-z

  // Mathematical Bold Italic
  addBlock(0x1D468, 0x41, 26);
  addBlock(0x1D482, 0x61, 26);

  // Mathematical Bold Script
  addBlock(0x1D4D0, 0x41, 26);
  addBlock(0x1D4EA, 0x61, 26);

  // Mathematical Bold Fraktur
  addBlock(0x1D56C, 0x41, 26);
  addBlock(0x1D586, 0x61, 26);

  // Mathematical Sans-Serif
  addBlock(0x1D5A0, 0x41, 26);
  addBlock(0x1D5BA, 0x61, 26);

  // Mathematical Sans-Serif Bold
  addBlock(0x1D5D4, 0x41, 26);
  addBlock(0x1D5EE, 0x61, 26);

  // Mathematical Sans-Serif Italic
  addBlock(0x1D608, 0x41, 26);
  addBlock(0x1D622, 0x61, 26);

  // Mathematical Sans-Serif Bold Italic
  addBlock(0x1D63C, 0x41, 26);
  addBlock(0x1D656, 0x61, 26);

  // Mathematical Monospace
  addBlock(0x1D670, 0x41, 26);
  addBlock(0x1D68A, 0x61, 26);

  // Mathematical Double-Struck Small (no holes)
  addBlock(0x1D552, 0x61, 26);

  // Mathematical Fraktur Small (no holes)
  addBlock(0x1D51E, 0x61, 26);

  // ── Italic (has one hole: small h) ───────────────────────────
  // Italic Capital A-Z: clean (0x1D434–0x1D44D)
  addBlock(0x1D434, 0x41, 26);
  // Italic Small a-g: 0x1D44E–0x1D454
  addBlock(0x1D44E, 0x61, 7);
  // 0x1D455 is unassigned (h → U+210E, Planck constant)
  map.set(0x210E, 'h');
  // Italic Small i-z: 0x1D456–0x1D467
  addBlock(0x1D456, 0x69, 18);

  // ── Script Capital (many holes) ──────────────────────────────
  // Holes replaced by pre-existing Unicode letterlike symbols.
  addBlock(0x1D49C, 0x41, 1); // A
  map.set(0x212C, 'B');        // ℬ
  addBlock(0x1D49E, 0x43, 2); // C, D
  map.set(0x2130, 'E');        // ℰ
  map.set(0x2131, 'F');        // ℱ
  addBlock(0x1D4A2, 0x47, 1); // G
  map.set(0x210B, 'H');        // ℋ
  map.set(0x2110, 'I');        // ℐ
  addBlock(0x1D4A5, 0x4A, 2); // J, K
  map.set(0x2112, 'L');        // ℒ
  map.set(0x2133, 'M');        // ℳ
  addBlock(0x1D4A9, 0x4E, 4); // N, O, P, Q
  map.set(0x211B, 'R');        // ℛ
  addBlock(0x1D4AE, 0x53, 8); // S, T, U, V, W, X, Y, Z

  // ── Script Small (three holes) ───────────────────────────────
  addBlock(0x1D4B6, 0x61, 4); // a, b, c, d
  map.set(0x212F, 'e');        // ℯ
  addBlock(0x1D4BB, 0x66, 1); // f
  map.set(0x210A, 'g');        // ℊ
  addBlock(0x1D4BD, 0x68, 7); // h, i, j, k, l, m, n
  map.set(0x2134, 'o');        // ℴ
  // p is at 0x1D4C5 (0x1D4C4 is unassigned)
  addBlock(0x1D4C5, 0x70, 11); // p, q, r, s, t, u, v, w, x, y, z

  // ── Fraktur Capital (three holes) ────────────────────────────
  addBlock(0x1D504, 0x41, 2); // A, B
  map.set(0x212D, 'C');        // ℭ
  addBlock(0x1D507, 0x44, 4); // D, E, F, G
  map.set(0x210C, 'H');        // ℌ
  map.set(0x2111, 'I');        // ℑ
  addBlock(0x1D50D, 0x4A, 8); // J, K, L, M, N, O, P, Q
  map.set(0x211C, 'R');        // ℜ
  addBlock(0x1D516, 0x53, 5); // S, T, U, V, W
  addBlock(0x1D51B, 0x58, 2); // X, Y
  map.set(0x2128, 'Z');        // ℨ

  // ── Double-Struck Capital (seven holes) ──────────────────────
  addBlock(0x1D538, 0x41, 2); // A, B
  map.set(0x2102, 'C');        // ℂ
  addBlock(0x1D53B, 0x44, 4); // D, E, F, G
  map.set(0x210D, 'H');        // ℍ
  addBlock(0x1D540, 0x49, 5); // I, J, K, L, M
  map.set(0x2115, 'N');        // ℕ
  addBlock(0x1D546, 0x4F, 1); // O
  map.set(0x2119, 'P');        // ℙ
  map.set(0x211A, 'Q');        // ℚ
  map.set(0x211D, 'R');        // ℝ
  addBlock(0x1D54A, 0x53, 5); // S, T, U, V, W
  addBlock(0x1D54F, 0x58, 2); // X, Y
  map.set(0x2124, 'Z');        // ℤ

  // ── Digit blocks ─────────────────────────────────────────────
  addBlock(0x1D7CE, 0x30, 10); // Bold digits 0-9
  addBlock(0x1D7D8, 0x30, 10); // Double-Struck digits 0-9
  addBlock(0x1D7E2, 0x30, 10); // Sans-Serif digits 0-9
  addBlock(0x1D7EC, 0x30, 10); // Sans-Serif Bold digits 0-9
  addBlock(0x1D7F6, 0x30, 10); // Monospace digits 0-9

  return map;
}

// ── Zero-width / invisible characters ────────────────────────
// Compiled once. Matches all the specified invisible chars.
const ZW_RE = /[\u200B\u200C\u200D\uFEFF\u00AD\u2060\u180E]/g;

// ── normalize ────────────────────────────────────────────────

/**
 * Converts a raw WhatsApp message string to plain ASCII-normalised text.
 *
 * Steps (in order):
 *   1. Decode Unicode mathematical font variants → plain ASCII
 *   2. Strip zero-width / invisible characters
 *   3. Normalise line endings (\r\n, \r → \n)
 *   4. Trim trailing whitespace from every line
 *   5. Remove trailing newline from the whole string
 */
export function normalize(raw: string): string {
  // ── 1. Decode math Unicode ─────────────────────────────────
  // We must use codePointAt() and advance by 2 for surrogate pairs
  // (codepoints > U+FFFF). charCodeAt() would see only half a pair
  // and produce garbage output.
  let decoded = '';
  for (let i = 0; i < raw.length; ) {
    const cp = raw.codePointAt(i);
    // codePointAt cannot return undefined when i < raw.length
    if (cp === undefined) break;
    const mapped = MATH_MAP.get(cp);
    decoded += mapped !== undefined ? mapped : String.fromCodePoint(cp);
    // Surrogate pair = 2 UTF-16 code units; BMP char = 1.
    i += cp > 0xFFFF ? 2 : 1;
  }

  // ── 2. Strip zero-width chars ─────────────────────────────
  // Reset lastIndex is automatic since we use string.replace (not exec).
  decoded = decoded.replace(ZW_RE, '');

  // ── 3. Normalise line endings ─────────────────────────────
  // Replace \r\n first (Windows), then bare \r (old Mac).
  decoded = decoded.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // ── 4. Trim trailing whitespace from every line ───────────
  // trimEnd() removes spaces, tabs, and other whitespace-category chars
  // from the right of each line, but not the newline separators.
  decoded = decoded.split('\n').map(l => l.trimEnd()).join('\n');

  // ── 5. Remove trailing newline ────────────────────────────
  // A message ending with a blank line would leave a trailing \n
  // after step 4. Strip all trailing newlines so the result is clean.
  decoded = decoded.replace(/\n+$/, '');

  return decoded;
}
