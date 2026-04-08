// ============================================================
// @mariabelle/parser — registry
// ============================================================

import { match, multiMatch } from './engine.js';
import type { Template, MultiTemplate, ParseResult, ParseTrace, Registry } from './types.js';

/**
 * Creates an independent template registry.
 * Each call to createRegistry() returns a fresh instance — no shared state.
 *
 * Design choice: registry stores templates in insertion order.
 * match() tries them in that order (first match wins), so the caller
 * controls priority by registration order.
 */
export function createRegistry(): Registry {
  const templates:      Template[]      = [];
  const multiTemplates: MultiTemplate[] = [];

  function register(template: Template): void {
    templates.push(template);
  }

  function registerAll(ts: Template[]): void {
    for (const t of ts) {
      templates.push(t);
    }
  }

  function registerMulti(template: MultiTemplate): void {
    multiTemplates.push(template);
  }

  function get(id: string): Template | undefined {
    return templates.find(t => t.id === id);
  }

  function getAll(): Template[] {
    return [...templates];
  }

  function parse(raw: string): ParseResult | null {
    // Try fixed-line templates first, then multi-line templates
    return match(raw, templates, false) ?? multiMatch(raw, multiTemplates);
  }

  function trace(raw: string): ParseTrace {
    const fixed = match(raw, templates, true);
    if (fixed.result !== null) return fixed;
    // Try multi-line templates — result replaces null in the trace
    const multiResult = multiMatch(raw, multiTemplates);
    return { ...fixed, result: multiResult };
  }

  return { register, registerAll, registerMulti, get, getAll, parse, trace };
}
