'use client';
import type { ParseTrace, MatchFailure } from '@mariabelle/parser';

// ── Invisible char tagging ─────────────────────────────────────
const INVISIBLE: Array<[RegExp, string]> = [
  [/\u200B/g, '[ZW]'],
  [/\u200C/g, '[ZWN]'],
  [/\u200D/g, '[ZWJ]'],
  [/\uFEFF/g, '[BOM]'],
  [/\u00AD/g, '[SHY]'],
  [/\u2060/g, '[WJ]'],
  [/\u180E/g, '[MGS]'],
];

function tagInvisible(s: string): string {
  // Escape HTML first so we can safely inject a span.
  const escaped = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = escaped;
  for (const [re, tag] of INVISIBLE) {
    out = out.replace(re, `<span style="color:var(--amber);font-size:11px">${tag}</span>`);
  }
  return out;
}

// ── Component ─────────────────────────────────────────────────

type Props = { trace: ParseTrace };

export default function ParseTraceView({ trace }: Props) {
  // Build ordered attempt list — first failure per template, in encounter order
  const attemptOrder: string[] = [];
  const failureByTemplate = new Map<string, MatchFailure>();
  for (const f of trace.attempts) {
    if (!failureByTemplate.has(f.templateId)) {
      failureByTemplate.set(f.templateId, f);
      attemptOrder.push(f.templateId);
    }
  }

  const candidateIds = [
    ...attemptOrder,
    ...(trace.result ? [trace.result.templateId] : []),
  ];

  return (
    <div style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7 }}>

      {/* RAW INPUT */}
      <div style={{ marginBottom: 14 }}>
        <div className="section-label" style={{ marginBottom: 4 }}>Raw Input</div>
        {trace.raw.split('\n').map((line, i) => (
          <div key={i} style={{ color: 'var(--muted)' }}>
            <span style={{ marginRight: 8, opacity: 0.5 }}>[{i}]</span>
            <span dangerouslySetInnerHTML={{ __html: tagInvisible(line) }} />
          </div>
        ))}
      </div>

      {/* AFTER NORMALIZE */}
      <div style={{ marginBottom: 14 }}>
        <div className="section-label" style={{ marginBottom: 4 }}>After Normalize</div>
        {trace.lines.map((line, i) => (
          <div key={i} style={{ color: 'var(--text)' }}>
            <span style={{ marginRight: 8, opacity: 0.5 }}>[{i}]</span>
            {line || <span style={{ opacity: 0.3 }}>(empty line)</span>}
          </div>
        ))}
      </div>

      {/* LINE COUNT + CANDIDATES */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
        <div>
          <span className="section-label">Line count </span>
          <span style={{ color: 'var(--blue)', fontWeight: 600 }}>{trace.lines.length}</span>
        </div>
        <div>
          <span className="section-label">Candidates </span>
          {candidateIds.length === 0
            ? <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>none</span>
            : <span style={{ color: 'var(--text)' }}>{candidateIds.join(', ')}</span>
          }
        </div>
      </div>

      {/* Per-template attempts (failures) */}
      {attemptOrder.map(id => {
        const failure = failureByTemplate.get(id)!;
        return (
          <div key={id} style={{
            marginBottom: 10, padding: '10px 14px',
            background: 'var(--surface2)', borderRadius: 8,
            border: '1px solid var(--border)',
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              ❌ <span style={{ color: 'var(--amber)' }}>TRYING: {id}</span>
            </div>
            {failure.line === -1 ? (
              <div style={{ color: 'var(--red)', fontSize: 11 }}>lineCount mismatch — {failure.reason}</div>
            ) : (
              <>
                {Array.from({ length: failure.line }, (_, i) => (
                  <div key={i} style={{ color: 'var(--green)', fontSize: 11 }}>✅ [L{i}]</div>
                ))}
                <div style={{ color: 'var(--red)', fontSize: 11 }}>
                  ❌ [L{failure.line}] {failure.reason}
                </div>
              </>
            )}
          </div>
        );
      })}

      {/* Successful template */}
      {trace.result && (
        <div style={{
          marginBottom: 10, padding: '10px 14px',
          background: 'var(--surface2)', borderRadius: 8,
          border: '1px solid rgba(16,185,129,0.2)',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            ✅ <span style={{ color: 'var(--green)' }}>TRYING: {trace.result.templateId}</span>
          </div>
          {trace.lines.map((_, i) => (
            <div key={i} style={{ color: 'var(--green)', fontSize: 11 }}>✅ [L{i}]</div>
          ))}
        </div>
      )}

      {/* RESULT */}
      <div style={{
        marginTop: 14, padding: '14px 16px', borderRadius: 10,
        background: trace.result ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
        border: `1px solid ${trace.result ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
      }}>
        {trace.result ? (
          <>
            <div style={{ color: 'var(--green)', fontWeight: 700, marginBottom: 10 }}>
              ✅ {trace.result.templateId}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {Object.entries(trace.result.fields as Record<string, unknown>).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: 'var(--muted)', paddingRight: 16, verticalAlign: 'top', fontSize: 11 }}>{k}</td>
                    <td style={{ color: 'var(--text)', fontSize: 11 }}>{JSON.stringify(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <>
            <div style={{ color: 'var(--red)', fontWeight: 700, marginBottom: 4 }}>❌ No match</div>
            {trace.attempts.length > 0 && (() => {
              const closest = trace.attempts.reduce<MatchFailure>((best, a) =>
                a.line > best.line ? a : best,
                trace.attempts[0]!,
              );
              return (
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                  Closest: {closest.templateId} failed at line {closest.line} — {closest.reason}
                </div>
              );
            })()}
            {trace.attempts.length === 0 && (
              <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                No templates registered — engine ships empty (add templates after validation).
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
