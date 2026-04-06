'use client';

import { useState, useCallback } from 'react';
import type { ParseTrace } from '@mariabelle/parser';
import ParseTraceView from '@/components/parse-trace';
import ParseLogFeed from '@/components/parse-log-feed';

export default function ParserPage() {
  const [raw, setRaw]       = useState('');
  const [trace, setTrace]   = useState<ParseTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const runParse = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setTrace(null);
    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTrace(await res.json() as ParseTrace);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Called when user clicks a row in the live feed
  const handleFeedClick = useCallback((text: string) => {
    setRaw(text);
    void runParse(text);
  }, [runParse]);

  return (
    <div className="fade-up">
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Parser Playground</h1>
          <span className="badge green">
            <span className="live-dot" />
            Live
          </span>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          Paste raw WhatsApp text → see the full parse trace. Click any row on the right to load it.
        </p>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 18, alignItems: 'start' }}>

        {/* LEFT — input + trace */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Input card */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <span className="section-label">Raw message text</span>
            </div>
            <textarea
              value={raw}
              onChange={e => setRaw(e.target.value)}
              placeholder={"Paste a raw WhatsApp message here…\n\nBold unicode (𝐋𝐢𝐤𝐞 𝐭𝐡𝐢𝐬) will be decoded automatically."}
              style={{
                width: '100%', minHeight: 150,
                background: 'transparent', border: 'none', outline: 'none',
                padding: '12px 16px', resize: 'vertical',
                fontFamily: 'monospace', fontSize: 13,
                color: 'var(--text)', lineHeight: 1.6,
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void runParse(raw);
                }
              }}
            />
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn btn-primary" onClick={() => void runParse(raw)} disabled={loading || !raw.trim()}>
                {loading ? 'Parsing…' : 'Parse'}
              </button>
              {raw && (
                <button className="btn btn-ghost" onClick={() => { setRaw(''); setTrace(null); setError(null); }}>
                  Clear
                </button>
              )}
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Ctrl+Enter</span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              padding: '12px 16px', borderRadius: 10,
              background: 'var(--red-dim)', border: '1px solid rgba(239,68,68,0.2)',
              color: 'var(--red)', fontSize: 13,
            }}>
              Error: {error}
            </div>
          )}

          {/* Parse trace */}
          {trace && (
            <div className="card fade-up-1">
              <div className="section-label" style={{ marginBottom: 14 }}>Parse Trace</div>
              <ParseTraceView trace={trace} />
            </div>
          )}
        </div>

        {/* RIGHT — live feed */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'sticky', top: 0 }}>
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span className="section-label" style={{ flex: 1 }}>Live Feed</span>
            <span className="live-dot" />
          </div>
          <ParseLogFeed onRowClick={handleFeedClick} />
        </div>

      </div>
    </div>
  );
}
