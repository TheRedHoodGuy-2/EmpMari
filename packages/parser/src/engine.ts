// ============================================================
// @mariabelle/parser — engine
//
// match()        — try a list of templates against raw text
// matchTemplate  — internal per-template matcher (not exported)
// ============================================================

import { normalize } from './normalize.js';
import type {
  Template,
  LineRule,
  ParseResult,
  ParseTrace,
  MatchFailure,
} from './types.js';

// ── matchTemplate ─────────────────────────────────────────────
// Returns a ParseResult on success, or a MatchFailure on the
// first line that fails to match.
//
// Design choice: we return a discriminated union rather than
// throwing, so the caller can accumulate failures for tracing.

type MatchSuccess = { ok: true; result: ParseResult };
type MatchError   = { ok: false; failure: MatchFailure };
type MatchOutcome = MatchSuccess | MatchError;

function matchTemplate(
  lines: string[],
  template: Template,
): MatchOutcome {
  const fields: Record<string, unknown> = {};

  for (let i = 0; i < template.lines.length; i++) {
    const rule = template.lines[i] as LineRule;
    const line = lines[i] as string;

    if (rule.type === 'literal') {
      if (line !== rule.value) {
        return {
          ok: false,
          failure: {
            templateId: template.id,
            line: i,
            reason: `literal mismatch — expected "${rule.value}", got "${line}"`,
          },
        };
      }
      continue;
    }

    // rule.type === 'capture'
    if (!line.startsWith(rule.prefix)) {
      return {
        ok: false,
        failure: {
          templateId: template.id,
          line: i,
          reason: `missing prefix "${rule.prefix}"`,
        },
      };
    }

    // Check suffix — when suffix is "" we slice to end (no suffix check needed).
    // Design choice: an empty suffix means "nothing required after the slot",
    // so we skip the endsWith check entirely to avoid false negatives on
    // lines that do end with "".
    if (rule.suffix !== '' && !line.endsWith(rule.suffix)) {
      return {
        ok: false,
        failure: {
          templateId: template.id,
          line: i,
          reason: `missing suffix "${rule.suffix}"`,
        },
      };
    }

    // Extract the slot: content between prefix and suffix.
    const slotEnd =
      rule.suffix === '' ? line.length : line.length - rule.suffix.length;
    const slot = line.slice(rule.prefix.length, slotEnd);

    // Run the pattern against the slot.
    // We require the pattern to consume the ENTIRE slot (no leftover).
    const m = rule.pattern.exec(slot);
    if (m === null) {
      return {
        ok: false,
        failure: {
          templateId: template.id,
          line: i,
          reason: `pattern ${rule.pattern} did not match slot "${slot}"`,
        },
      };
    }

    if (m[0].length !== slot.length) {
      return {
        ok: false,
        failure: {
          templateId: template.id,
          line: i,
          reason: `pattern ${rule.pattern} left ${slot.length - m[0].length} unconsumed char(s) in slot "${slot}"`,
        },
      };
    }

    // Store the captured value — apply transform if provided.
    // Design choice: transform receives slot (= m[0]) as a string.
    // The transform type is (raw: string) => unknown, which matches.
    fields[rule.key] = rule.transform ? rule.transform(slot) : slot;
  }

  // All lines passed. Run cross-field validation if provided.
  if (template.validate && !template.validate(fields)) {
    return {
      ok: false,
      failure: {
        templateId: template.id,
        line: template.lines.length - 1,
        reason: `validate() returned false`,
      },
    };
  }

  // Apply shape transform if provided.
  const shaped = template.shape ? template.shape(fields) : fields;

  return {
    ok: true,
    result: { templateId: template.id, fields: shaped },
  };
}

// ── match (overloads) ─────────────────────────────────────────
// debug=false (default) → ParseResult | null
// debug=true            → ParseTrace (always returns a trace object)

export function match(
  raw: string,
  templates: Template[],
  debug: true,
): ParseTrace;
export function match(
  raw: string,
  templates: Template[],
  debug?: false,
): ParseResult | null;
export function match(
  raw: string,
  templates: Template[],
  debug?: boolean,
): ParseResult | ParseTrace | null;

export function match(
  raw: string,
  templates: Template[],
  debug = false,
): ParseResult | ParseTrace | null {
  const normalized = normalize(raw);
  const lines = normalized.split('\n');

  const candidates = templates.filter(t => t.lineCount === lines.length);

  const attempts: MatchFailure[] = [];

  for (const candidate of candidates) {
    const outcome = matchTemplate(lines, candidate);
    if (outcome.ok) {
      if (debug) {
        return {
          raw,
          normalized,
          lines,
          attempts,
          result: outcome.result,
        } satisfies ParseTrace;
      }
      return outcome.result;
    }
    attempts.push(outcome.failure);
  }

  // No match found.
  if (debug) {
    return {
      raw,
      normalized,
      lines,
      attempts,
      result: null,
    } satisfies ParseTrace;
  }

  // If no candidates existed (lineCount mismatch for all templates),
  // we still return null — nothing to trace.
  return null;
}
