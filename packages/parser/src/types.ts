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

// Registry interface (returned by createRegistry)
export type Registry = {
  register: (template: Template) => void;
  registerAll: (templates: Template[]) => void;
  get: (id: string) => Template | undefined;
  getAll: () => Template[];
  parse: (raw: string) => ParseResult | null;
  trace: (raw: string) => ParseTrace;
};
