'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

type Group = {
  group_id:      string;
  name:          string | null;
  anticamping:   boolean | null;
  antibot:       boolean | null;
  cards_enabled: boolean | null;
  can_spawn:     boolean | null;
  participants:  number | null;
  gs_scanned_at: string | null;
  gs_timeout:    boolean | null;
  updated_at:    string | null;
};


function Badge({ on, label }: { on: boolean | null; label: string }) {
  if (on === null) return <span style={{ fontSize: 10, color: 'var(--muted)', padding: '2px 6px', border: '1px solid #333', borderRadius: 4 }}>{label} ?</span>;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      background: on ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.12)',
      color: on ? '#ef4444' : '#22c55e',
      border: `1px solid ${on ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.25)'}`,
    }}>
      {label} {on ? 'ON' : 'OFF'}
    </span>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function GroupsPage() {
  const [groups, setGroups]     = useState<Group[]>([]);
  const [activity, setActivity] = useState<Map<string, number>>(new Map());
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<'all' | 'anticamped' | 'no_spawn' | 'unscanned'>('all');

  async function load() {
    setLoading(true);
    const { data: gData } = await supabase
      .from('groups')
      .select('group_id, name, anticamping, antibot, cards_enabled, can_spawn, participants, gs_scanned_at, gs_timeout, updated_at')
      .order('name');
    setGroups(gData ?? []);

    // Activity: count messages per group in last 4h from activity_log
    const { data: actData } = await supabase
      .from('activity_log')
      .select('group_id')
      .gte('recorded_at', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString());

    const counts = new Map<string, number>();
    for (const row of actData ?? []) {
      counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
    }
    setActivity(counts);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const filtered = groups.filter(g => {
    if (filter === 'anticamped') return g.anticamping === true;
    if (filter === 'no_spawn')   return g.can_spawn === false;
    if (filter === 'unscanned')  return g.gs_scanned_at === null;
    return true;
  });

  const scanned   = groups.filter(g => g.gs_scanned_at !== null).length;
  const anticamped = groups.filter(g => g.anticamping === true).length;
  const noSpawn   = groups.filter(g => g.can_spawn === false).length;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Group Health</h1>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>
            {scanned}/{groups.length} scanned · {anticamped} anticamped · {noSpawn} can't spawn
          </p>
        </div>
        <button onClick={load} style={{ fontSize: 12, padding: '6px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--fg)', cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['all', 'anticamped', 'no_spawn', 'unscanned'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            fontSize: 11, padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
            background: filter === f ? 'var(--blue)' : 'var(--surface)',
            color: filter === f ? '#fff' : 'var(--muted)',
            border: `1px solid ${filter === f ? 'var(--blue)' : 'var(--border)'}`,
            fontWeight: filter === f ? 700 : 400,
          }}>
            {f === 'all' ? `All (${groups.length})` :
             f === 'anticamped' ? `Anticamped (${anticamped})` :
             f === 'no_spawn' ? `Can't Spawn (${noSpawn})` :
             `Unscanned (${groups.filter(g => !g.gs_scanned_at).length})`}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>}

      {!loading && filtered.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>No groups match this filter.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(g => {
          const msgs4h = activity.get(g.group_id) ?? 0;
          const actColor = msgs4h >= 10 ? '#22c55e' : msgs4h >= 3 ? '#f59e0b' : '#ef4444';
          const isRisky = g.anticamping === true && msgs4h < 3;

          return (
            <div key={g.group_id} style={{
              background: 'var(--surface)',
              border: `1px solid ${isRisky ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
              borderRadius: 8,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap' as const,
            }}>
              {/* Name + activity */}
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                  {g.name ?? g.group_id}
                  {isRisky && <span style={{ marginLeft: 8, fontSize: 10, color: '#ef4444', fontWeight: 700 }}>⚠ LOW ACTIVITY</span>}
                  {g.gs_timeout && <span style={{ marginLeft: 8, fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>⏱ TIMEOUT</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {g.participants != null ? `${g.participants} members · ` : ''}
                  {g.gs_scanned_at ? `Scanned ${relativeTime(g.gs_scanned_at)}` : 'Never scanned'}
                </div>
              </div>

              {/* Activity bar */}
              <div style={{ textAlign: 'center' as const, minWidth: 60 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: actColor }}>{msgs4h}</div>
                <div style={{ fontSize: 9, color: 'var(--muted)' }}>msgs/4h</div>
              </div>

              {/* Badges */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                <Badge on={g.anticamping}   label="AntiCamp" />
                <Badge on={g.antibot}       label="AntiBot" />
                <Badge on={!g.can_spawn}    label="No Spawn" />
                <Badge on={!g.cards_enabled} label="No Cards" />
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ marginTop: 20, fontSize: 11, color: 'var(--muted)' }}>
        Run <code>.gscan</code> in your test GC to scan all groups. Responses update automatically.
      </p>
    </div>
  );
}
