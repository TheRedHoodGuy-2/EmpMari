'use client';

import { useEffect, useState } from 'react';

type Summary = { total: number; claimed: number; claimRate: number; today: number; thisWeek: number };
type RankRow  = { group_id: string; name: string; today: number; week: number; month: number; allTime: number };
type HourRow  = { hour: number; count: number };
type DayRow   = { day: number; label: string; count: number };
type TierRow  = { tier: string; count: number };

type Data = {
  summary:  Summary;
  rankings: RankRow[];
  hourly:   HourRow[];
  daily:    DayRow[];
  tiers:    TierRow[];
};

type Timeframe = 'today' | 'week' | 'month' | 'allTime';
const TF_LABEL: Record<Timeframe, string> = { today: 'Today', week: '7 days', month: '30 days', allTime: 'All time' };

const TIER_COLOR: Record<string, string> = {
  '1': 'var(--muted)', '2': 'var(--green)', '3': 'var(--blue)',
  '4': '#a78bfa', '5': '#fb923c', '6': 'var(--red)', 'S': '#fbbf24',
};

function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color ?? 'var(--blue)', borderRadius: 99, transition: 'width 0.3s' }} />
    </div>
  );
}

function BarChart({ title, rows, max, compact }: { title: string; rows: { label: string; count: number }[]; max: number; compact?: boolean }) {
  const h = compact ? 60 : 80;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: compact ? '10px 12px' : '14px 16px' }}>
      <div style={{ fontSize: compact ? 11 : 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: h }}>
        {rows.map(r => {
          const pct = max > 0 ? (r.count / max) * 100 : 0;
          return (
            <div key={r.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, height: '100%', justifyContent: 'flex-end' }}
              title={`${r.label}: ${r.count}`}>
              <div style={{ width: '100%', background: 'var(--blue)', borderRadius: '2px 2px 0 0', height: `${pct}%`, minHeight: r.count ? 2 : 0, opacity: 0.8 }} />
              {rows.length <= 10 && (
                <span style={{ fontSize: 8, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.label}</span>
              )}
            </div>
          );
        })}
      </div>
      {rows.length > 10 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 9, color: 'var(--muted)' }}>{rows[0]!.label}</span>
          <span style={{ fontSize: 9, color: 'var(--muted)' }}>{rows[rows.length - 1]!.label}</span>
        </div>
      )}
    </div>
  );
}

function GroupDrilldown({ data, name }: { data: Data; name: string }) {
  const maxHour = Math.max(...data.hourly.map(h => h.count), 1);
  const maxDay  = Math.max(...data.daily.map(d => d.count), 1);
  return (
    <div>
      <div style={{ display: 'flex', gap: 20, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Total',     value: data.summary.total },
          { label: 'Claimed',   value: `${data.summary.claimed} (${data.summary.claimRate}%)` },
          { label: 'Today',     value: data.summary.today },
          { label: 'This week', value: data.summary.thisWeek },
        ].map(s => (
          <div key={s.label}>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{s.value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <BarChart title="Spawns by hour (UTC)" rows={data.hourly.map(h => ({ label: String(h.hour).padStart(2, '0'), count: h.count }))} max={maxHour} compact />
        <BarChart title="Spawns by day"        rows={data.daily.map(d => ({ label: d.label, count: d.count }))}                           max={maxDay}  compact />
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const [data,      setData]      = useState<Data | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [timeframe, setTimeframe] = useState<Timeframe>('allTime');
  const [selected,  setSelected]  = useState<string | null>(null);
  const [drillData, setDrillData] = useState<Data | null>(null);
  const [drillLoad, setDrillLoad] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const res = await fetch('/api/analytics');
      if (res.ok) setData(await res.json());
      setLoading(false);
    })();
  }, []);

  async function drilldown(gcId: string) {
    if (selected === gcId) { setSelected(null); setDrillData(null); return; }
    setSelected(gcId);
    setDrillLoad(true);
    const res = await fetch(`/api/analytics?group=${encodeURIComponent(gcId)}`);
    if (res.ok) setDrillData(await res.json());
    setDrillLoad(false);
  }

  if (loading) return <div style={{ padding: 28, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>;
  if (!data)   return <div style={{ padding: 28, color: '#ef4444', fontSize: 13 }}>Failed to load</div>;

  const rankKey = timeframe === 'today' ? 'today' : timeframe === 'week' ? 'week' : timeframe === 'month' ? 'month' : 'allTime';
  const ranked  = [...data.rankings].sort((a, b) => b[rankKey] - a[rankKey]).filter(r => r[rankKey] > 0);
  const maxRank = ranked[0]?.[rankKey] ?? 1;
  const maxHour = Math.max(...data.hourly.map(h => h.count), 1);
  const maxDay  = Math.max(...data.daily.map(d => d.count), 1);
  const maxTier = Math.max(...data.tiers.map(t => t.count), 1);
  const MEDAL   = ['#fbbf24', '#9ca3af', '#b45309'];

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860 }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>Leaderboard</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Group rankings · spawn analytics</div>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 28 }}>
        {[
          { label: 'Total spawns', value: data.summary.total },
          { label: 'Claimed',      value: `${data.summary.claimed} (${data.summary.claimRate}%)` },
          { label: 'Today',        value: data.summary.today },
          { label: 'This week',    value: data.summary.thisWeek },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Rankings */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Group Rankings</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(Object.keys(TF_LABEL) as Timeframe[]).map(tf => (
              <button key={tf} onClick={() => setTimeframe(tf)} style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                border: 'none', cursor: 'pointer',
                background: timeframe === tf ? 'var(--blue)' : 'var(--surface)',
                color:      timeframe === tf ? '#fff'        : 'var(--muted)',
              }}>{TF_LABEL[tf]}</button>
            ))}
          </div>
        </div>

        {ranked.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>No spawns in this timeframe.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {ranked.map((row, i) => (
                <div key={row.group_id}>
                  <div
                    onClick={() => void drilldown(row.group_id)}
                    style={{
                      display: 'grid', gridTemplateColumns: '28px 1fr 48px', gap: 12, alignItems: 'center',
                      background: selected === row.group_id ? 'rgba(59,130,246,0.08)' : 'var(--surface)',
                      border: `1px solid ${selected === row.group_id ? 'var(--blue)' : 'var(--border)'}`,
                      borderRadius: selected === row.group_id ? '8px 8px 0 0' : 8,
                      padding: '10px 14px', cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: MEDAL[i] ?? 'var(--muted)' }}>
                      {i + 1}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {row.name}
                      </span>
                      <Bar value={row[rankKey]} max={maxRank} />
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', textAlign: 'right' }}>
                      {row[rankKey]}
                    </span>
                  </div>

                  {selected === row.group_id && (
                    <div style={{
                      background: 'rgba(59,130,246,0.04)', border: '1px solid var(--blue)',
                      borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '14px 16px',
                    }}>
                      {drillLoad
                        ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</div>
                        : drillData
                          ? <GroupDrilldown data={drillData} name={row.name} />
                          : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Global charts */}
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Global Analytics</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <BarChart title="Spawns by hour (UTC)" rows={data.hourly.map(h => ({ label: String(h.hour).padStart(2, '0'), count: h.count }))} max={maxHour} />
        <BarChart title="Spawns by day"        rows={data.daily.map(d => ({ label: d.label, count: d.count }))}                          max={maxDay} />
      </div>

      {/* Tier breakdown */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Tier Breakdown</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.tiers.map(t => (
            <div key={t.tier} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 44px', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: TIER_COLOR[t.tier] ?? 'var(--muted)' }}>T{t.tier}</span>
              <Bar value={t.count} max={maxTier} color={TIER_COLOR[t.tier] ?? 'var(--blue)'} />
              <span style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right' }}>{t.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
