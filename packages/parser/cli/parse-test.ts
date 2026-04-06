#!/usr/bin/env tsx
// ============================================================
// @mariabelle/parser — CLI tool
//
//   npx tsx cli/parse-test.ts --text "raw message here"
//   npx tsx cli/parse-test.ts --file ./path/to/message.txt
//   npx tsx cli/parse-test.ts --demo
// ============================================================

import { readFileSync } from 'fs';
import { normalize } from '../src/normalize.js';
import { createRegistry } from '../src/registry.js';
import type { Template, ParseTrace, MatchFailure } from '../src/types.js';

// ── Invisible-char display tags ───────────────────────────────
const INVISIBLE_TAGS: Array<[RegExp, string]> = [
  [/\u200B/g, '[ZW]'],
  [/\u200C/g, '[ZWN]'],
  [/\u200D/g, '[ZWJ]'],
  [/\uFEFF/g, '[BOM]'],
  [/\u00AD/g, '[SHY]'],
  [/\u2060/g, '[WJ]'],
  [/\u180E/g, '[MGS]'],
  [/\r\n/g, '[CRLF]'],
  [/\r/g, '[CR]'],
];

function showInvisible(s: string): string {
  let out = s;
  for (const [re, tag] of INVISIBLE_TAGS) {
    out = out.replace(re, tag);
  }
  return out;
}

// ── Divider ───────────────────────────────────────────────────
const HR = '────────────────────────────────────────────────';

// ── Format and print a ParseTrace ────────────────────────────
function printTrace(trace: ParseTrace, source: string): void {
  console.log(HR);
  console.log(`SOURCE: ${source}\n`);

  // Raw input — show invisible chars
  console.log('RAW INPUT:');
  const rawLines = trace.raw.split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    console.log(`  [${i}] ${showInvisible(rawLines[i] ?? '')}`);
  }

  console.log('\nAFTER NORMALIZE:');
  for (let i = 0; i < trace.lines.length; i++) {
    console.log(`  [${i}] ${trace.lines[i] ?? ''}`);
  }

  console.log(`\nLINE COUNT: ${trace.lines.length}`);

  // Which templates were tried
  if (trace.attempts.length === 0 && trace.result === null) {
    console.log('\nCANDIDATES: (none — lineCount matched no registered template)');
  } else {
    const tried = new Set<string>();
    for (const a of trace.attempts) tried.add(a.templateId);
    if (trace.result) tried.add(trace.result.templateId);
    console.log(`\nCANDIDATES: ${[...tried].join(', ')}`);
  }

  // Per-template attempt details
  // Group failures by templateId in order encountered
  const failuresByTemplate = new Map<string, MatchFailure>();
  for (const f of trace.attempts) {
    if (!failuresByTemplate.has(f.templateId)) {
      failuresByTemplate.set(f.templateId, f);
    }
  }

  for (const [id, failure] of failuresByTemplate) {
    console.log(`\nTRYING: ${id}`);
    if (failure.line === -1) {
      console.log(`  ❌ lineCount mismatch — ${failure.reason}`);
    } else {
      // Show lines up to and including the failing line
      for (let i = 0; i < failure.line; i++) {
        console.log(`  [L${i}] ✅`);
      }
      console.log(`  [L${failure.line}] ❌ ${failure.reason}`);
    }
  }

  // If the result template was attempted, show its success
  if (trace.result) {
    const id = trace.result.templateId;
    console.log(`\nTRYING: ${id}`);
    for (let i = 0; i < trace.lines.length; i++) {
      console.log(`  [L${i}] ✅`);
    }
  }

  // Final result
  if (trace.result) {
    console.log(`\nRESULT: ✅ ${trace.result.templateId}`);
    console.log('  ' + JSON.stringify(trace.result.fields, null, 2).replace(/\n/g, '\n  '));
  } else {
    console.log('\nRESULT: ❌ null');
    if (trace.attempts.length > 0) {
      // Find the attempt that got furthest (highest line number)
      let closest: MatchFailure = trace.attempts[0]!;
      for (const a of trace.attempts) {
        if (a.line > closest.line) closest = a;
      }
      console.log(`  Closest: ${closest.templateId} failed at line ${closest.line}`);
      console.log(`  Reason: ${closest.reason}`);
    }
  }

  console.log(HR + '\n');
}

// ── Demo templates ────────────────────────────────────────────
function buildDemoRegistry() {
  const reg = createRegistry();

  // GREETING: 1 line — "Hello, {name}!"
  const greeting: Template = {
    id: 'GREETING',
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

  // PAIR: 2 lines — literal header, then a captured value
  const pair: Template = {
    id: 'PAIR',
    lineCount: 2,
    lines: [
      { type: 'literal', value: '---PAIR---' },
      {
        type: 'capture',
        prefix: 'value: ',
        suffix: '',
        key: 'value',
        pattern: /.+/,
      },
    ],
  };

  // TRIPLE: 3 lines — all literals
  const triple: Template = {
    id: 'TRIPLE',
    lineCount: 3,
    lines: [
      { type: 'literal', value: 'line one' },
      { type: 'literal', value: 'line two' },
      { type: 'literal', value: 'line three' },
    ],
  };

  reg.registerAll([greeting, pair, triple]);
  return reg;
}

// ── Main ──────────────────────────────────────────────────────
function main(): void {
  const args = process.argv.slice(2);

  if (args[0] === '--demo') {
    const reg = buildDemoRegistry();
    const demos: Array<{ input: string; source: string }> = [
      { input: 'Hello, Rimuru!', source: 'demo — GREETING' },
      { input: '---PAIR---\nvalue: Tensura', source: 'demo — PAIR' },
      { input: 'line one\nline two\nline three', source: 'demo — TRIPLE' },
    ];
    for (const { input, source } of demos) {
      const trace = reg.trace(input);
      printTrace(trace, source);
    }
    return;
  }

  let raw: string;
  let source: string;

  if (args[0] === '--text') {
    const text = args[1];
    if (!text) {
      console.error('Usage: parse-test.ts --text "your message"');
      process.exit(1);
    }
    raw = text;
    source = 'inline';
  } else if (args[0] === '--file') {
    const filepath = args[1];
    if (!filepath) {
      console.error('Usage: parse-test.ts --file ./path/to/file.txt');
      process.exit(1);
    }
    try {
      raw = readFileSync(filepath, 'utf8');
    } catch {
      console.error(`Could not read file: ${filepath}`);
      process.exit(1);
    }
    source = filepath;
  } else {
    console.log('Usage:');
    console.log('  parse-test.ts --text "message"');
    console.log('  parse-test.ts --file ./message.txt');
    console.log('  parse-test.ts --demo');
    console.log('\nNote: No templates are registered in standalone mode.');
    console.log('      The trace will show normalization output regardless.');

    // Still run a trace so the user can see normalization output
    if (args.length === 0) {
      // No args at all — just show usage
      return;
    }
    raw = args.join(' ');
    source = 'inline';
  }

  // No Tensura templates registered yet — engine ships empty.
  // The trace still shows normalization output, which is useful
  // for verifying that raw text is decoded correctly.
  const reg = createRegistry();
  const trace = reg.trace(raw);
  printTrace(trace, source);
}

main();
