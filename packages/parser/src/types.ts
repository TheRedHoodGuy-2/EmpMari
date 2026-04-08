// ============================================================
// @mariabelle/parser — Types
// ============================================================

export type LiteralRule = {
  type: 'literal';
  value: string;
};

export type CaptureRule = {
  type: 'capture';
  prefix: string;
  suffix: string;
  key: string;
  pattern: RegExp;
  transform?: (raw: string) => unknown;
};

export type LineRule = LiteralRule | CaptureRule;

export type Template<T = Record<string, unknown>> = {
  id: string;
  lineCount: number;
  lines: LineRule[];
  validate?: (fields: Record<string, unknown>) => boolean;
  shape?: (fields: Record<string, unknown>) => T;
};

export type ParseResult<T = Record<string, unknown>> = {
  templateId: string;
  fields: T;
};

export type MatchFailure = {
  templateId: string;
  /** Line index where match failed. -1 means lineCount mismatch. */
  line: number;
  reason: string;
};

export type ParseTrace = {
  raw: string;
  normalized: string;
  lines: string[];
  attempts: MatchFailure[];
  result: ParseResult | null;
};

// ── MultiTemplate — for variable-line-count messages ─────────
// Used when a message has a known start pattern but a variable
// number of data lines (e.g. MY_SERIES, SERIES_LEADERBOARD).
// multiMatch() in engine.ts handles these separately.

export type MultiTemplate = {
  id: string;
  /** Return true if this line is the first line of the message */
  isStart: (line: string) => boolean;
  /** Return true if this line is the last line of the message */
  isEnd: (line: string) => boolean;
  /** Extract structured data from all lines */
  extract: (lines: string[]) => ParseResult | null;
};

// Registry interface (returned by createRegistry)
export type Registry = {
  register: (template: Template) => void;
  registerAll: (templates: Template[]) => void;
  registerMulti: (template: MultiTemplate) => void;
  get: (id: string) => Template | undefined;
  getAll: () => Template[];
  parse: (raw: string) => ParseResult | null;
  trace: (raw: string) => ParseTrace;
};
