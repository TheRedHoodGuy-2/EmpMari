import { describe, it, expect } from 'vitest';
import { getNumber, normalizeJid, isGroupJid, isSelf, formatDisplay } from '../src/jid.js';

describe('getNumber', () => {
  it('strips :N suffix and @domain', () => {
    expect(getNumber('447911234567:3@s.whatsapp.net')).toBe('447911234567');
  });

  it('strips @domain when no :N suffix', () => {
    expect(getNumber('447911234567@s.whatsapp.net')).toBe('447911234567');
  });

  it('returns unchanged when already a plain number', () => {
    expect(getNumber('447911234567')).toBe('447911234567');
  });

  it('handles group JID (strips @g.us)', () => {
    expect(getNumber('12345678901234567890@g.us')).toBe('12345678901234567890');
  });
});

describe('normalizeJid', () => {
  it('removes :N device suffix but keeps @domain', () => {
    expect(normalizeJid('447911234567:3@s.whatsapp.net')).toBe('447911234567@s.whatsapp.net');
  });

  it('returns unchanged when no :N suffix', () => {
    expect(normalizeJid('447911234567@s.whatsapp.net')).toBe('447911234567@s.whatsapp.net');
  });

  it('handles plain number with :N but no @domain', () => {
    expect(normalizeJid('447911234567:3')).toBe('447911234567');
  });
});

describe('isGroupJid', () => {
  it('returns true for @g.us JIDs', () => {
    expect(isGroupJid('12345678901234567890@g.us')).toBe(true);
  });

  it('returns false for @s.whatsapp.net JIDs', () => {
    expect(isGroupJid('447911234567@s.whatsapp.net')).toBe(false);
  });

  it('returns false for plain numbers', () => {
    expect(isGroupJid('447911234567')).toBe(false);
  });
});

describe('isSelf', () => {
  it('returns true when number matches (with @domain)', () => {
    expect(isSelf('447911234567@s.whatsapp.net', '447911234567')).toBe(true);
  });

  it('returns true when number matches (with :N and @domain)', () => {
    expect(isSelf('447911234567:3@s.whatsapp.net', '447911234567')).toBe(true);
  });

  it('returns false when number does not match', () => {
    expect(isSelf('447911234567@s.whatsapp.net', '447999999999')).toBe(false);
  });
});

describe('formatDisplay', () => {
  it('prepends + to a plain number extracted from full JID', () => {
    expect(formatDisplay('447911234567@s.whatsapp.net')).toBe('+447911234567');
  });

  it('prepends + to a plain number', () => {
    expect(formatDisplay('447911234567')).toBe('+447911234567');
  });

  it('works with :N suffix', () => {
    expect(formatDisplay('447911234567:3@s.whatsapp.net')).toBe('+447911234567');
  });
});
