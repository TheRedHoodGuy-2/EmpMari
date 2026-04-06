import { describe, it, expect } from 'vitest';
import { match } from '../src/engine.js';
import { createRegistry } from '../src/registry.js';
import type { Template, ParseTrace } from '../src/types.js';

// ── Shared test templates ─────────────────────────────────────
// All templates use simple, non-Tensura formats.

const T_LITERAL_1: Template = {
  id: 'LITERAL_1',
  lineCount: 1,
  lines: [{ type: 'literal', value: 'exact match' }],
};

const T_CAPTURE_1: Template = {
  id: 'CAPTURE_1',
  lineCount: 1,
  lines: [
    {
      type: 'capture',
      prefix: 'Hello, ',
      suffix: '!',
      key: 'name',
      pattern: /[A-Za-z ]+/,
    },
  ],
};

const T_CAPTURE_NUM: Template = {
  id: 'CAPTURE_NUM',
  lineCount: 1,
  lines: [
    {
      type: 'capture',
      prefix: 'count: ',
      suffix: '',
      key: 'n',
      pattern: /\d+/,
      transform: (raw) => Number(raw),
    },
  ],
};

const T_MULTI: Template = {
  id: 'MULTI',
  lineCount: 3,
  lines: [
    { type: 'literal', value: '--- header ---' },
    {
      type: 'capture',
      prefix: 'name: ',
      suffix: '',
      key: 'name',
      pattern: /.+/,
    },
    { type: 'literal', value: '--- end ---' },
  ],
};

const T_VALIDATE: Template = {
  id: 'VALIDATE',
  lineCount: 1,
  lines: [
    {
      type: 'capture',
      prefix: 'val: ',
      suffix: '',
      key: 'n',
      pattern: /\d+/,
      transform: (raw) => Number(raw),
    },
  ],
  validate: (fields) => (fields['n'] as number) > 10,
};

const T_SHAPE: Template<{ value: number; doubled: number }> = {
  id: 'SHAPE',
  lineCount: 1,
  lines: [
    {
      type: 'capture',
      prefix: 'x: ',
      suffix: '',
      key: 'x',
      pattern: /\d+/,
      transform: (raw) => Number(raw),
    },
  ],
  shape: (fields) => ({
    value: fields['x'] as number,
    doubled: (fields['x'] as number) * 2,
  }),
};

// A template that matches any single line — used to test priority.
const T_GREEDY: Template = {
  id: 'GREEDY',
  lineCount: 1,
  lines: [
    {
      type: 'capture',
      prefix: '',
      suffix: '',
      key: 'anything',
      pattern: /.*/,
    },
  ],
};

// ── Tests ─────────────────────────────────────────────────────

describe('match — lineCount filtering', () => {
  it('returns null when input has too many lines', () => {
    const result = match('exact match\nextra line', [T_LITERAL_1]);
    expect(result).toBeNull();
  });

  it('returns null when input has too few lines', () => {
    const result = match('', [T_MULTI]);
    expect(result).toBeNull();
  });

  it('returns null immediately with zero candidates (no templates registered)', () => {
    const result = match('anything', []);
    expect(result).toBeNull();
  });
});

describe('match — literal rules', () => {
  it('exact literal match succeeds', () => {
    const result = match('exact match', [T_LITERAL_1]);
    expect(result).not.toBeNull();
    expect(result!.templateId).toBe('LITERAL_1');
  });

  it('one-char difference causes literal failure', () => {
    const result = match('exact matcH', [T_LITERAL_1]);
    expect(result).toBeNull();
  });

  it('extra leading space causes literal failure', () => {
    const result = match(' exact match', [T_LITERAL_1]);
    expect(result).toBeNull();
  });
});

describe('match — capture rules', () => {
  it('missing prefix → null', () => {
    const result = match('Goodbye, Alice!', [T_CAPTURE_1]);
    expect(result).toBeNull();
  });

  it('missing suffix → null', () => {
    // Line ends with '.' instead of '!'
    const result = match('Hello, Alice.', [T_CAPTURE_1]);
    expect(result).toBeNull();
  });

  it('pattern fully consumes slot → match', () => {
    const result = match('Hello, Alice!', [T_CAPTURE_1]);
    expect(result).not.toBeNull();
    expect(result!.fields).toMatchObject({ name: 'Alice' });
  });

  it('pattern leaves leftover chars → null ("123abc" vs /\\d+/)', () => {
    // count: 123abc — slot is "123abc", pattern /\d+/ matches "123" but
    // leaves "abc" unconsumed → should fail.
    const result = match('count: 123abc', [T_CAPTURE_NUM]);
    expect(result).toBeNull();
  });

  it('pattern with no match → null', () => {
    // slot "abc" doesn't match /\d+/ at all
    const result = match('count: abc', [T_CAPTURE_NUM]);
    expect(result).toBeNull();
  });

  it('transform is applied: Number("42") → 42', () => {
    const result = match('count: 42', [T_CAPTURE_NUM]);
    expect(result).not.toBeNull();
    expect(result!.fields).toMatchObject({ n: 42 });
    expect(typeof (result!.fields as { n: unknown }).n).toBe('number');
  });

  it('empty suffix means slice to end of line', () => {
    const result = match('count: 999', [T_CAPTURE_NUM]);
    expect(result).not.toBeNull();
    expect((result!.fields as { n: number }).n).toBe(999);
  });
});

describe('match — validate', () => {
  it('validate passes when condition is met', () => {
    const result = match('val: 42', [T_VALIDATE]);
    expect(result).not.toBeNull();
  });

  it('validate fails when condition is not met → null', () => {
    const result = match('val: 5', [T_VALIDATE]);
    expect(result).toBeNull();
  });
});

describe('match — priority', () => {
  it('first registered template wins when both match', () => {
    // T_LITERAL_1 matches "exact match", T_GREEDY also matches it.
    // T_LITERAL_1 is first → should win.
    const result = match('exact match', [T_LITERAL_1, T_GREEDY]);
    expect(result!.templateId).toBe('LITERAL_1');
  });

  it('if first template fails, second template is tried', () => {
    // T_LITERAL_1 requires "exact match", but input is different.
    // T_GREEDY matches anything → should win.
    const result = match('something else', [T_LITERAL_1, T_GREEDY]);
    expect(result!.templateId).toBe('GREEDY');
  });
});

describe('match — shape', () => {
  it('template.shape transforms the fields object', () => {
    const result = match('x: 7', [T_SHAPE]);
    expect(result).not.toBeNull();
    expect(result!.fields).toMatchObject({ value: 7, doubled: 14 });
  });
});

describe('match — multi-line template', () => {
  it('multi-line template matches when all rules pass', () => {
    const input = '--- header ---\nname: Rimuru\n--- end ---';
    const result = match(input, [T_MULTI]);
    expect(result).not.toBeNull();
    expect(result!.fields).toMatchObject({ name: 'Rimuru' });
  });

  it('multi-line template fails if one line mismatches', () => {
    const input = '--- header ---\nname: Rimuru\n--- WRONG ---';
    const result = match(input, [T_MULTI]);
    expect(result).toBeNull();
  });
});

describe('match — debug mode returns ParseTrace', () => {
  it('returns a ParseTrace object when debug=true', () => {
    const trace = match('exact match', [T_LITERAL_1], true);
    expect(trace).toHaveProperty('raw');
    expect(trace).toHaveProperty('normalized');
    expect(trace).toHaveProperty('lines');
    expect(trace).toHaveProperty('attempts');
    expect(trace).toHaveProperty('result');
  });

  it('trace.result is set on success', () => {
    const trace = match('exact match', [T_LITERAL_1], true);
    expect(trace.result).not.toBeNull();
    expect(trace.result!.templateId).toBe('LITERAL_1');
  });

  it('trace.result is null on failure', () => {
    const trace = match('wrong text', [T_LITERAL_1], true);
    expect(trace.result).toBeNull();
  });

  it('trace.attempts contains the failure when a template was tried', () => {
    const trace = match('wrong text', [T_LITERAL_1], true);
    expect(trace.attempts.length).toBeGreaterThan(0);
    expect(trace.attempts[0]!.templateId).toBe('LITERAL_1');
    expect(trace.attempts[0]!.line).toBe(0);
  });

  it('trace.attempts is empty when no candidates matched lineCount', () => {
    // T_MULTI needs 3 lines; input has 1 — no candidates, no attempts.
    const trace = match('only one line', [T_MULTI], true);
    expect(trace.attempts).toHaveLength(0);
    expect(trace.result).toBeNull();
  });

  it('trace.attempts records failures in order', () => {
    // Both T_LITERAL_1 and T_CAPTURE_1 expect 1 line.
    // "count: 5" fails both.
    const trace = match('count: 5', [T_LITERAL_1, T_CAPTURE_1], true);
    const ids = trace.attempts.map(a => a.templateId);
    expect(ids[0]).toBe('LITERAL_1');
    expect(ids[1]).toBe('CAPTURE_1');
  });

  it('trace.raw preserves original string before normalization', () => {
    // Bold 'A' (U+1D400) should appear in raw but be decoded in normalized.
    const boldA = String.fromCodePoint(0x1D400);
    const trace = match(boldA + 'exact match'.slice(1), [T_LITERAL_1], true);
    expect(trace.raw).toContain(boldA);
    // normalized replaces bold A → A
    expect(trace.normalized).not.toContain(boldA);
  });
});

describe('registry', () => {
  it('registry.parse uses registered templates', () => {
    const reg = createRegistry();
    reg.register(T_LITERAL_1);
    expect(reg.parse('exact match')).not.toBeNull();
    expect(reg.parse('wrong')).toBeNull();
  });

  it('registry.trace returns ParseTrace', () => {
    const reg = createRegistry();
    reg.register(T_LITERAL_1);
    const trace: ParseTrace = reg.trace('exact match');
    expect(trace.result).not.toBeNull();
  });

  it('registry.get returns registered template by id', () => {
    const reg = createRegistry();
    reg.register(T_LITERAL_1);
    expect(reg.get('LITERAL_1')).toBe(T_LITERAL_1);
    expect(reg.get('MISSING')).toBeUndefined();
  });

  it('registry.getAll returns all registered templates', () => {
    const reg = createRegistry();
    reg.registerAll([T_LITERAL_1, T_CAPTURE_1]);
    expect(reg.getAll()).toHaveLength(2);
  });
});
