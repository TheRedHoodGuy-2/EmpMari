'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface ConfigRow {
  id:               string;
  tier:             string;
  design:           string;
  issue:            string;
  claim_chance:     number;
  activity_bonus:   number;
  activity_penalty: number;
  delay_min_ms:     number;
  delay_max_ms:     number;
  notes:            string | null;
}

type EditMap = Record<string, Partial<ConfigRow>>;
type SaveState = Record<string, 'idle' | 'saving' | 'saved' | 'error'>;

const TIER_ORDER: Record<string, number> = {
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, 'S': 7,
};

function msToS(ms: number): string { return `${(ms / 1000).toFixed(1)}s`; }
function sToMs(s: string):  number { return Math.round(parseFloat(s) * 1000); }

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    '1': { bg: '#1f2937', color: '#9ca3af' },
    '2': { bg: '#1e3a5f', color: '#60a5fa' },
    '3': { bg: '#1a3a1a', color: '#4ade80' },
    '4': { bg: '#3b2d00', color: '#fbbf24' },
    '5': { bg: '#4c1d1d', color: '#f87171' },
    '6': { bg: '#3b0764', color: '#c084fc' },
    'S': { bg: '#1a1a2e', color: '#818cf8' },
  };
  const s = colors[tier] ?? { bg: '#1f2937', color: '#9ca3af' };
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: 11, fontWeight: 700, padding: '2px 8px',
      borderRadius: 6, letterSpacing: '0.04em',
    }}>T{tier}</span>
  );
}

function NumberInput({
  value, onChange, min = 0, max = 100, step = 1,
}: {
  value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min} max={max} step={step}
      onChange={e => onChange(Number(e.target.value))}
      style={{
        width: 60, padding: '4px 6px', borderRadius: 6, fontSize: 12,
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        color: 'var(--text)', textAlign: 'right',
      }}
    />
  );
}

function DelayInput({ ms, onChange }: { ms: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState(String((ms / 1000).toFixed(1)));
  useEffect(() => { setRaw(String((ms / 1000).toFixed(1))); }, [ms]);
  return (
    <input
      type="number"
      value={raw}
      min={0} step={0.5}
      onChange={e => { setRaw(e.target.value); onChange(sToMs(e.target.value)); }}
      style={{
        width: 64, padding: '4px 6px', borderRadius: 6, fontSize: 12,
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        color: 'var(--text)', textAlign: 'right',
      }}
    />
  );
}

export default function ControlPage() {
  const [rows,      setRows]      = useState<ConfigRow[]>([]);
  const [edits,     setEdits]     = useState<EditMap>({});
  const [saveState, setSaveState] = useState<SaveState>({});
  const [loading,   setLoading]   = useState(true);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    const res  = await fetch('/api/humaniser-config');
    const data = await res.json() as ConfigRow[];
    setRows(data.sort((a, b) =>
      (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) ||
      a.design.localeCompare(b.design) ||
      a.issue.localeCompare(b.issue),
    ));
    setLoading(false);
  }, []);

  useEffect(() => { void loadRows(); }, [loadRows]);

  // Realtime subscription — updates rows live when DB changes
  useEffect(() => {
    const channel = supabase
      .channel('humaniser_config_changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'humaniser_config' },
        (payload) => {
          const updated = payload.new as ConfigRow;
          setRows(prev => prev.map(r => r.id === updated.id ? updated : r));
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  function edit(id: string, field: keyof ConfigRow, value: unknown) {
    setEdits(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  }

  function getVal<K extends keyof ConfigRow>(id: string, field: K, row: ConfigRow): ConfigRow[K] {
    const e = edits[id];
    if (e && field in e) return e[field] as ConfigRow[K];
    return row[field];
  }

  async function save(id: string) {
    const patch = edits[id];
    if (!patch || Object.keys(patch).length === 0) return;

    setSaveState(prev => ({ ...prev, [id]: 'saving' }));
    try {
      const res = await fetch(`/api/humaniser-config/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json() as ConfigRow;
      setRows(prev => prev.map(r => r.id === id ? updated : r));
      setEdits(prev => { const n = { ...prev }; delete n[id]; return n; });
      setSaveState(prev => ({ ...prev, [id]: 'saved' }));
      setTimeout(() => setSaveState(prev => ({ ...prev, [id]: 'idle' })), 2000);
    } catch {
      setSaveState(prev => ({ ...prev, [id]: 'error' }));
      setTimeout(() => setSaveState(prev => ({ ...prev, [id]: 'idle' })), 3000);
    }
  }

  async function refreshBot() {
    await fetch('/api/humaniser-config/invalidate', { method: 'POST' });
    setRefreshMsg('Bot cache will refresh within 5 minutes.');
    setTimeout(() => setRefreshMsg(null), 4000);
  }

  const th: React.CSSProperties = {
    padding: '8px 10px', textAlign: 'left', fontSize: 10,
    color: 'var(--muted)', fontWeight: 500,
    textTransform: 'uppercase', letterSpacing: '0.06em',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Control</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4, margin: '4px 0 0' }}>
            Humaniser config — claim decision matrix. Changes apply within 5 minutes.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {refreshMsg && (
            <span style={{ fontSize: 12, color: '#4ade80' }}>{refreshMsg}</span>
          )}
          <button
            onClick={() => void refreshBot()}
            style={{
              fontSize: 12, padding: '7px 14px', borderRadius: 8,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--muted)', cursor: 'pointer',
            }}
          >
            Refresh bot config
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading config…</div>
      ) : (
        <div style={{
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                <th style={th}>Tier</th>
                <th style={th}>Design</th>
                <th style={th}>Issue</th>
                <th style={{ ...th, textAlign: 'right' }}>Claim %</th>
                <th style={{ ...th, textAlign: 'right' }}>Act. bonus</th>
                <th style={{ ...th, textAlign: 'right' }}>Act. penalty</th>
                <th style={{ ...th, textAlign: 'right' }}>Delay min</th>
                <th style={{ ...th, textAlign: 'right' }}>Delay max</th>
                <th style={th}>Notes</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const state   = saveState[row.id] ?? 'idle';
                const dirty   = !!edits[row.id] && Object.keys(edits[row.id]!).length > 0;
                const btnText = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : state === 'error' ? 'Error' : 'Save';
                const btnColor = state === 'saved' ? '#4ade80' : state === 'error' ? '#f87171' : dirty ? 'var(--blue)' : 'var(--muted)';

                return (
                  <tr key={row.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '8px 10px' }}><TierBadge tier={row.tier} /></td>
                    <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--muted)' }}>{row.design}</td>
                    <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--muted)' }}>#{row.issue}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <NumberInput
                        value={getVal(row.id, 'claim_chance', row)}
                        onChange={v => edit(row.id, 'claim_chance', v)}
                        min={0} max={100}
                      />
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <NumberInput
                        value={getVal(row.id, 'activity_bonus', row)}
                        onChange={v => edit(row.id, 'activity_bonus', v)}
                        min={0} max={50}
                      />
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <NumberInput
                        value={getVal(row.id, 'activity_penalty', row)}
                        onChange={v => edit(row.id, 'activity_penalty', v)}
                        min={0} max={50}
                      />
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <DelayInput
                        ms={getVal(row.id, 'delay_min_ms', row)}
                        onChange={v => edit(row.id, 'delay_min_ms', v)}
                      />
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <DelayInput
                        ms={getVal(row.id, 'delay_max_ms', row)}
                        onChange={v => edit(row.id, 'delay_max_ms', v)}
                      />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <input
                        type="text"
                        value={getVal(row.id, 'notes', row) ?? ''}
                        onChange={e => edit(row.id, 'notes', e.target.value)}
                        style={{
                          width: 180, padding: '4px 8px', borderRadius: 6, fontSize: 12,
                          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                          color: 'var(--muted)',
                        }}
                      />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <button
                        onClick={() => void save(row.id)}
                        disabled={!dirty || state === 'saving'}
                        style={{
                          fontSize: 11, padding: '4px 12px', borderRadius: 6,
                          cursor: dirty && state === 'idle' ? 'pointer' : 'default',
                          background: 'rgba(255,255,255,0.06)',
                          border: `1px solid ${dirty ? btnColor : 'rgba(255,255,255,0.08)'}`,
                          color: btnColor, whiteSpace: 'nowrap',
                        }}
                      >{btnText}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div style={{ marginTop: 16, fontSize: 11, color: 'rgba(255,255,255,0.25)', lineHeight: 2 }}>
        <strong style={{ color: 'rgba(255,255,255,0.35)' }}>Act. bonus</strong> — added to claim % when score ≥ 0.5 &nbsp;·&nbsp;
        <strong style={{ color: 'rgba(255,255,255,0.35)' }}>Act. penalty</strong> — subtracted when score &lt; 0.5 &nbsp;·&nbsp;
        Delays shown in seconds. Changes live within 5 min.
      </div>
    </div>
  );
}
