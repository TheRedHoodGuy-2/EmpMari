// ============================================================
// @mariabelle/parser — Public API
// ============================================================

export { normalize } from './normalize.js';
export { match } from './engine.js';
export { createRegistry } from './registry.js';
export { registerTensuraTemplates } from './templates/tensura.js';

export type {
  LineRule,
  LiteralRule,
  CaptureRule,
  Template,
  ParseResult,
  MatchFailure,
  ParseTrace,
  Registry,
} from './types.js';
