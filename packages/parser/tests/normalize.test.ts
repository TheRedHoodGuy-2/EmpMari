import { describe, it, expect } from 'vitest';
import { normalize } from '../src/normalize.js';

describe('normalize', () => {
  // ── Step 1: Math Unicode decoding ────────────────────────────

  it('decodes Mathematical Bold Capital A (U+1D400) → A', () => {
    // \uD835\uDC00 is the UTF-16 surrogate pair for U+1D400
    expect(normalize('\uD835\uDC00')).toBe('A');
  });

  it('decodes Mathematical Bold Small a (U+1D41A) → a', () => {
    // U+1D41A = surrogate pair \uD835\uDC1A
    expect(normalize('\uD835\uDC1A')).toBe('a');
  });

  it('decodes Mathematical Bold Digit 0 (U+1D7CE) → 0', () => {
    // U+1D7CE = surrogate pair \uD835\uDFCE
    expect(normalize('\uD835\uDFCE')).toBe('0');
  });

  it('decodes entire Mathematical Bold uppercase alphabet', () => {
    // U+1D400–U+1D419 (A–Z in Math Bold)
    let bold = '';
    for (let cp = 0x1D400; cp <= 0x1D419; cp++) {
      bold += String.fromCodePoint(cp);
    }
    expect(normalize(bold)).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  });

  it('decodes entire Mathematical Bold lowercase alphabet', () => {
    let bold = '';
    for (let cp = 0x1D41A; cp <= 0x1D433; cp++) {
      bold += String.fromCodePoint(cp);
    }
    expect(normalize(bold)).toBe('abcdefghijklmnopqrstuvwxyz');
  });

  it('decodes Mathematical Bold digits 0-9', () => {
    let digits = '';
    for (let cp = 0x1D7CE; cp <= 0x1D7D7; cp++) {
      digits += String.fromCodePoint(cp);
    }
    expect(normalize(digits)).toBe('0123456789');
  });

  it('handles surrogate pairs correctly (codePointAt, not charCodeAt)', () => {
    // A string built from codepoints > 0xFFFF must round-trip correctly.
    // If we used charCodeAt() we would see two separate code units and
    // produce garbage. This test verifies surrogate pair handling.
    const input = String.fromCodePoint(0x1D400) + String.fromCodePoint(0x1D41A);
    expect(normalize(input)).toBe('Aa');
  });

  it('decodes Mathematical Sans-Serif Bold Capital A (U+1D5D4) → A', () => {
    expect(normalize(String.fromCodePoint(0x1D5D4))).toBe('A');
  });

  it('decodes Mathematical Monospace Small z (U+1D6A3) → z', () => {
    expect(normalize(String.fromCodePoint(0x1D6A3))).toBe('z');
  });

  it('decodes Mathematical Italic Small h (U+210E, Planck constant) → h', () => {
    expect(normalize('\u210E')).toBe('h');
  });

  it('decodes Script Capital B (U+212C, ℬ) → B', () => {
    expect(normalize('\u212C')).toBe('B');
  });

  it('decodes Double-Struck Capital C (U+2102, ℂ) → C', () => {
    expect(normalize('\u2102')).toBe('C');
  });

  it('decodes Mathematical Monospace Capital Z (U+1D689) → Z', () => {
    expect(normalize(String.fromCodePoint(0x1D689))).toBe('Z');
  });

  // ── Step 2: Zero-width character stripping ────────────────────

  it('strips U+200B (zero-width space)', () => {
    expect(normalize('hel\u200Blo')).toBe('hello');
  });

  it('strips U+200C (zero-width non-joiner)', () => {
    expect(normalize('hel\u200Clo')).toBe('hello');
  });

  it('strips U+200D (zero-width joiner)', () => {
    expect(normalize('hel\u200Dlo')).toBe('hello');
  });

  it('strips U+FEFF (byte order mark / zero-width no-break space)', () => {
    expect(normalize('\uFEFFhello')).toBe('hello');
  });

  it('strips U+00AD (soft hyphen)', () => {
    expect(normalize('hel\u00ADlo')).toBe('hello');
  });

  it('strips U+2060 (word joiner)', () => {
    expect(normalize('hel\u2060lo')).toBe('hello');
  });

  it('strips U+180E (Mongolian vowel separator)', () => {
    expect(normalize('hel\u180Elo')).toBe('hello');
  });

  // ── Step 3: Line ending normalisation ────────────────────────

  it('converts \\r\\n to \\n', () => {
    expect(normalize('line1\r\nline2')).toBe('line1\nline2');
  });

  it('converts bare \\r to \\n', () => {
    expect(normalize('line1\rline2')).toBe('line1\nline2');
  });

  it('leaves \\n unchanged', () => {
    expect(normalize('line1\nline2')).toBe('line1\nline2');
  });

  // ── Step 4: Trailing whitespace per line ──────────────────────

  it('removes trailing space from a line', () => {
    expect(normalize('hello   ')).toBe('hello');
  });

  it('removes trailing tab from a line', () => {
    expect(normalize('hello\t')).toBe('hello');
  });

  it('preserves leading whitespace (only trailing is trimmed)', () => {
    expect(normalize('  hello  ')).toBe('  hello');
  });

  // ── Step 5: Trailing newline ──────────────────────────────────

  it('removes trailing newline', () => {
    expect(normalize('hello\n')).toBe('hello');
  });

  it('removes multiple trailing newlines', () => {
    expect(normalize('hello\n\n\n')).toBe('hello');
  });

  it('does not remove newlines in the middle', () => {
    expect(normalize('line1\nline2\n')).toBe('line1\nline2');
  });

  // ── Combined ──────────────────────────────────────────────────

  it('handles bold unicode + zero-width + \\r\\n combined', () => {
    // Build: Math Bold "Hello" with a ZW in the middle, CRLF line ending,
    // and a trailing space on the second line.
    const boldH = String.fromCodePoint(0x1D407); // 𝐇
    const boldE = String.fromCodePoint(0x1D404); // 𝐄
    const boldL = String.fromCodePoint(0x1D40B); // 𝐋
    const boldO = String.fromCodePoint(0x1D40E); // 𝐎

    const input =
      boldH + boldE + boldL + boldL + boldO + '\u200B' + '\r\n' + 'world   ';
    expect(normalize(input)).toBe('HELLO\nworld');
  });

  it('empty string returns empty string', () => {
    expect(normalize('')).toBe('');
  });

  it('plain ASCII is returned unchanged', () => {
    expect(normalize('hello world')).toBe('hello world');
  });
});
