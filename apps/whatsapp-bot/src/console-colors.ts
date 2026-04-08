/**
 * Monkey-patches console.log/warn/error with ANSI colours.
 * Zero dependencies. Call patchConsole() once at the top of index.ts.
 *
 * Tags like [CARD], [CLAIM], [CONN] etc. each get a distinct colour.
 * Pino/Baileys JSON lines pass through unmodified.
 */

const R = '\x1b[0m';
const DIM = '\x1b[2m';

const C = {
  white:   '\x1b[97m',
  grey:    '\x1b[90m',
  red:     '\x1b[91m',
  green:   '\x1b[92m',
  yellow:  '\x1b[93m',
  blue:    '\x1b[94m',
  magenta: '\x1b[95m',
  cyan:    '\x1b[96m',
  orange:  '\x1b[38;5;214m',
  purple:  '\x1b[38;5;141m',
  teal:    '\x1b[38;5;80m',
  pink:    '\x1b[38;5;213m',
  lime:    '\x1b[38;5;154m',
  amber:   '\x1b[38;5;220m',
};

const TAG_COLORS: Record<string, string> = {
  // Bot lifecycle
  CONN:    C.cyan,
  BOT:     C.cyan,
  HEALTH:  C.lime,
  PING:    C.pink,

  // Claiming
  CARD:    C.yellow,
  CLAIM:   C.green,
  SKIP:    C.grey,
  RETRY:   C.orange,
  QUEUE:   C.purple,

  // Collections / series
  COL:     C.teal,
  SERIES:  C.blue,
  GSCAN:   C.magenta,

  // Infra
  SEND:    C.teal,
  SCHED:   C.purple,
  DB:      C.blue,
  NTFY:    C.orange,
  TEST:    C.magenta,

  // Levels
  INFO:    C.white,
  WARN:    C.amber,
  ERROR:   C.red,
};

function ts(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${DIM}${C.grey}${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${R}`;
}

function parseTag(msg: string): { tag: string; rest: string } {
  const m = msg.match(/^\[([A-Z_0-9]+)\]\s*(.*)/s);
  if (m) return { tag: m[1]!, rest: m[2]! };
  return { tag: 'INFO', rest: msg };
}

function fmt(args: unknown[]): string {
  return args
    .map(a => {
      if (typeof a === 'string') return a;
      if (a instanceof Error)   return `${a.message}\n${a.stack ?? ''}`;
      return JSON.stringify(a);
    })
    .join(' ');
}

function isJsonLine(msg: string): boolean {
  const t = msg.trimStart();
  return t.startsWith('{') || t.startsWith('[{');
}

function colorLine(raw: string, level: 'log' | 'warn' | 'error'): string {
  if (isJsonLine(raw)) return raw; // Baileys/pino structured logs — untouched

  if (level === 'error') {
    const { tag, rest } = parseTag(raw);
    return `${ts()} ${C.red}[${tag}]${R} ${C.red}${rest}${R}`;
  }
  if (level === 'warn') {
    const { tag, rest } = parseTag(raw);
    return `${ts()} ${C.amber}[${tag}]${R} ${C.amber}${rest}${R}`;
  }

  const { tag, rest } = parseTag(raw);
  const tagCol = TAG_COLORS[tag] ?? C.white;
  return `${ts()} ${tagCol}[${tag}]${R} ${C.white}${rest}${R}`;
}

export function patchConsole(): void {
  console.log = (...args: unknown[]) => {
    const msg = fmt(args);
    const out = isJsonLine(msg) ? msg : colorLine(msg, 'log');
    process.stdout.write(out + '\n');
  };

  console.warn = (...args: unknown[]) => {
    process.stdout.write(colorLine(fmt(args), 'warn') + '\n');
  };

  console.error = (...args: unknown[]) => {
    process.stderr.write(colorLine(fmt(args), 'error') + '\n');
  };

  console.info = console.log;
}
