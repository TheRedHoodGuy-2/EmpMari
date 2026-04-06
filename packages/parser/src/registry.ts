// ============================================================
// @mariabelle/parser — registry
// ============================================================

import { match } from './engine.js';
import type { Template, ParseResult, ParseTrace, Registry } from './types.js';

/**
 * Creates an independent template registry.
 * Each call to createRegistry() returns a fresh instance — no shared state.
 *
 * Design choice: registry stores templates in insertion order.
 * match() tries them in that order (first match wins), so the caller
 * controls priority by registration order.
 */
export function createRegistry(): Registry {
  const templates: Template[] = [];

  function register(template: Template): void {
    templates.push(template);
  }

  function registerAll(ts: Template[]): void {
    for (const t of ts) {
      templates.push(t);
    }
  }

  function get(id: string): Template | undefined {
    return templates.find(t => t.id === id);
  }

  function getAll(): Template[] {
    // Return a shallow copy so external code cannot mutate the internal array.
    return [...templates];
  }

  function parse(raw: string): ParseResult | null {
    return match(raw, templates, false);
  }

  function trace(raw: string): ParseTrace {
    return match(raw, templates, true);
  }

  return { register, registerAll, get, getAll, parse, trace };
}
