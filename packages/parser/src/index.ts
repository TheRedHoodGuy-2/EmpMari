// ============================================================
// @mariabelle/parser — Public API
// ============================================================

export { normalize } from './normalize.js';
export { match, multiMatch } from './engine.js';
export { createRegistry } from './registry.js';
export { registerTensuraTemplates } from './templates/tensura.js';

export type {
  LineRule,
  LiteralRule,
  CaptureRule,
  Template,
  MultiTemplate,
  ParseResult,
  MatchFailure,
  ParseTrace,
  Registry,
} from './types.js';
