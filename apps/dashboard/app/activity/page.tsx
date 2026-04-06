'use client';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';

// ── Types ─────────────────────────────────────────────────────

type GroupRow = {
  group_id: string;
  name: string | null;
};

type LogRow = {
  created_at: string;
  group_id: string | null;
  sender_jid: string | null;
  sender_type: string | null;
};

type PlayerRow = {
  jid: string;
  number: string;
  moniker: string | null;
};

// ── Thresholds ────────────────────────────────────────────────
//
// Group activity (other members):
//   GREEN  — 7+ messages in the last 45 minutes
//   AMBER  — 7+ messages in the last 80 minutes (but not 45m)
//   RED    — fewer than 7 in the last 80 minutes
//
// Self activity (Mariabelle's own messages, for card claiming):
//   The bible says owner_activity_count = own msgs in last 4h.
//   We display the raw count; ≥3 is considered safe to claim.

const THRESHOLD       = 7;
const WINDOW_HOT      = 45 * 60 * 1_000;    // 45 min
const WINDOW_WARM     = 80 * 60 * 1_000;    // 1h 20min
const WINDOW_SELF     = 4  * 60 * 60 * 1_000; // 4h  (bible spec)
const WINDOW_BOT      = 24 * 60 * 60 * 1_000; // 24h (bot seen recently)
const FETCH_WINDOW    = WINDOW_SELF + 10 * 60 * 1_000; // fetch 4h10m of logs

type Status = 'green' | 'amber' | 'red';

const STATUS_STYLE: Record<Status, { bg: string; color: string; label: string }> = {
  green: { bg: 'var(--green-dim)', color: 'var(--green)', label: 'Active'  },
  amber: { bg: 'var(--amber-dim)', color: 'var(--amber)', label: 'Cooling' },
  red:   { bg: 'var(--red-dim)',   color: 'var(--red)',   label: 'Danger'  },
};

function getGroupStatus(countHot: number, countWarm: number): Status {
  if (countHot  >= THRESHOLD) return 'green';
  if (countWarm >= THRESHOLD) return 'amber';
  return 'red';
}

function selfStatusColor(count: number): string {
  if (count >= 3) return 'var(--green)';
  if (count >= 1) return 'var(--amber)';
  return 'var(--red)';
}

// ── Helpers ───────────────────────────────────────────────────

function getNumber(jid: string): string {
  const atIdx = jid.indexOf('@');
  const local = atIdx !== -1 ? jid.slice(0, atIdx) : jid;
  const ci    = local.indexOf(':');
  return ci !== -1 ? local.slice(0, ci) : local;
}

function relativeTime(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 5)  return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Page ──────────────────────────────────────────────────────

export default function ActivityPage() {
  const [groups,   setGroups]   = useState<GroupRow[]>([]);
  const [logs,     setLogs]     = useState<LogRow[]>([]);
  const [players,  setPlayers]  = useState<PlayerRow[]>([]);
  const [tick,     setTick]     = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Load groups
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('groups').select('group_id, name');
      if (data) setGroups(data as GroupRow[]);
    })();
  }, []);

  // Load parse_log (last 4h10m covers all windows including WINDOW_SELF)
  useEffect(() => {
    const since = new Date(Date.now() - FETCH_WINDOW).toISOString();
    void (async () => {
      const { data } = await supabase
        .from('parse_log')
        .select('created_at, group_id, sender_jid, sender_type')
        .gte('created_at', since)
        .order('created_at', { ascending: false });
      if (data) setLogs(data as LogRow[]);
    })();
  }, [tick]);

  // Load players
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('players').select('jid, number, moniker');
      if (data) setPlayers(data as PlayerRow[]);
    })();
  }, []);

  // Realtime: new parse_log rows
  useEffect(() => {
    const ch = supabase
      .channel('activity_parse_log')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'parse_log' }, p => {
        setLogs(prev => [p.new as LogRow, ...prev]);
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  // Realtime: group name updates
  useEffect(() => {
    const ch = supabase
      .channel('activity_groups')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, p => {
        const g = p.new as GroupRow;
        setGroups(prev => {
          const exists = prev.find(x => x.group_id === g.group_id);
          return exists ? prev.map(x => x.group_id === g.group_id ? g : x) : [...prev, g];
        });
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  // Realtime: player upserts
  useEffect(() => {
    const ch = supabase
      .channel('activity_players')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, p => {
        const pl = p.new as PlayerRow;
        setPlayers(prev => {
          const exists = prev.find(x => x.jid === pl.jid);
          return exists ? prev.map(x => x.jid === pl.jid ? pl : x) : [...prev, pl];
        });
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  // Tick every 30s to re-evaluate time windows
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const playerMap = useMemo(() => {
    const m = new Map<string, PlayerRow>();
    for (const p of players) m.set(p.jid, p);
    return m;
  }, [players]);

  // Compute per-group stats
  const groupStats = useMemo(() => {
    const now        = Date.now();
    const hotCutoff  = now - WINDOW_HOT;
    const warmCutoff = now - WINDOW_WARM;
    const selfCutoff = now - WINDOW_SELF;
    const botCutoff  = now - WINDOW_BOT;

    const allGroupIds = new Set<string>();
    for (const r of logs)   if (r.group_id) allGroupIds.add(r.group_id);
    for (const g of groups) allGroupIds.add(g.group_id);

    return Array.from(allGroupIds).map(gid => {
      const gLogs = logs.filter(r => r.group_id === gid);

      // Group activity (all senders except self, for claiming-window thresholds)
      const nonSelfLogs = gLogs.filter(r => r.sender_type !== 'self');
      const countHot    = nonSelfLogs.filter(r => new Date(r.created_at).getTime() >= hotCutoff).length;
      const countWarm   = nonSelfLogs.filter(r => new Date(r.created_at).getTime() >= warmCutoff).length;
      const status      = getGroupStatus(countHot, countWarm);

      // Self activity — Mariabelle's own messages in last 4h (bible spec)
      const selfCount   = gLogs.filter(r =>
        r.sender_type === 'self' && new Date(r.created_at).getTime() >= selfCutoff,
      ).length;

      // Bot present in this group (any bot message in last 24h)
      const botSeen     = gLogs.some(r =>
        r.sender_type === 'bot' && new Date(r.created_at).getTime() >= botCutoff,
      );

      // Unique human senders seen in last 80min
      const recentSenders = new Set(
        nonSelfLogs
          .filter(r => new Date(r.created_at).getTime() >= warmCutoff && r.sender_jid)
          .map(r => r.sender_jid as string),
      );

      const lastLog     = gLogs[0];
      const groupRow    = groups.find(g => g.group_id === gid);
      const groupName   = groupRow?.name ?? null;

      return { gid, groupName, countHot, countWarm, selfCount, botSeen, status, recentSenders, lastLog };
    }).sort((a, b) => {
      const order: Record<Status, number> = { red: 0, amber: 1, green: 2 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return b.countWarm - a.countWarm;
    });
  }, [logs, groups, tick]);

  const redCount   = groupStats.filter(g => g.status === 'red').length;
  const amberCount = groupStats.filter(g => g.status === 'amber').length;
  const greenCount = groupStats.filter(g => g.status === 'green').length;

  return (
    <div className="fade-up">

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Group Activity</h1>
          <span className="badge green"><span className="live-dot" />Live</span>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          Group activity windows · Mariabelle&rsquo;s own send count (4h) · Bot presence
        </p>
      </div>

      {/* Summary pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {([
          ['green', greenCount, 'Active'],
          ['amber', amberCount, 'Cooling'],
          ['red',   redCount,   'Danger'],
        ] as [Status, number, string][]).map(([s, count, label]) => (
          <div key={s} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 8,
            background: STATUS_STYLE[s].bg,
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_STYLE[s].color }}>{label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: STATUS_STYLE[s].color }}>{count}</span>
          </div>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>
          {groupStats.length} group{groupStats.length !== 1 ? 's' : ''} · 30s refresh
        </div>
      </div>

      {/* Group list */}
      {groupStats.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 13 }}>
          No group activity yet — waiting for messages.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groupStats.map(({ gid, groupName, countHot, countWarm, selfCount, botSeen, status, recentSenders, lastLog }) => {
            const st      = STATUS_STYLE[status];
            const isOpen  = expanded === gid;
            const displayName = groupName ?? gid.slice(0, 30);

            return (
              <div key={gid} className="card" style={{ padding: 0, overflow: 'hidden' }}>

                {/* Header row */}
                <button
                  onClick={() => setExpanded(isOpen ? null : gid)}
                  style={{
                    width: '100%', textAlign: 'left', background: 'none', border: 'none',
                    cursor: 'pointer', padding: '14px 16px',
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface2)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                >
                  {/* Group status */}
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                    textTransform: 'uppercase' as const,
                    padding: '2px 8px', borderRadius: 99, flexShrink: 0,
                    background: st.bg, color: st.color,
                  }}>
                    {st.label}
                  </span>

                  {/* Group name */}
                  <span style={{ fontWeight: 600, fontSize: 13, flex: 1, color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {displayName}
                  </span>

                  {/* Bot presence */}
                  <span title={botSeen ? 'Bot active in last 24h' : 'No bot seen in last 24h'} style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                    textTransform: 'uppercase' as const,
                    padding: '2px 7px', borderRadius: 99, flexShrink: 0,
                    background: botSeen ? 'var(--blue-dim)' : 'rgba(255,255,255,0.06)',
                    color:      botSeen ? 'var(--blue)'     : 'var(--muted)',
                  }}>
                    {botSeen ? 'bot ✓' : 'no bot'}
                  </span>

                  {/* Activity stats block */}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>

                    {/* Group msgs 45m */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: countHot >= THRESHOLD ? 'var(--green)' : 'var(--muted)', lineHeight: 1 }}>
                        {countHot}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>45m</div>
                    </div>

                    <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

                    {/* Group msgs 1h20 */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: countWarm >= THRESHOLD ? 'var(--amber)' : 'var(--muted)', lineHeight: 1 }}>
                        {countWarm}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>1h20</div>
                    </div>

                    <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

                    {/* Self msgs 4h (Mariabelle) */}
                    <div style={{ textAlign: 'center' }} title="Mariabelle's own messages in last 4h (needed for claiming)">
                      <div style={{ fontSize: 15, fontWeight: 700, color: selfStatusColor(selfCount), lineHeight: 1 }}>
                        {selfCount}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>me 4h</div>
                    </div>

                    <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

                    {/* Unique senders */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 15, color: 'var(--muted)', lineHeight: 1 }}>
                        {recentSenders.size}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>senders</div>
                    </div>
                  </div>

                  {/* Last seen */}
                  {lastLog && (
                    <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                      {relativeTime(lastLog.created_at)}
                    </span>
                  )}

                  <span style={{ fontSize: 12, color: 'var(--muted)', transition: 'transform 0.15s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>
                    ▾
                  </span>
                </button>

                {/* Expanded member roster */}
                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px' }}>

                    {/* Self activity detail */}
                    <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: 'var(--surface2)' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: 4 }}>
                        Mariabelle — own activity
                      </div>
                      <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                        <span>
                          <span style={{ fontWeight: 700, color: selfStatusColor(selfCount), fontSize: 16 }}>{selfCount}</span>
                          <span style={{ color: 'var(--muted)', marginLeft: 4 }}>messages sent in last 4h</span>
                        </span>
                        <span style={{ color: selfCount >= 3 ? 'var(--green)' : selfCount >= 1 ? 'var(--amber)' : 'var(--red)', fontSize: 11, fontWeight: 600 }}>
                          {selfCount >= 3 ? 'Safe to claim' : selfCount >= 1 ? 'Low activity' : 'No activity — claiming risky'}
                        </span>
                      </div>
                    </div>

                    {/* Recent human senders */}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>
                      Active senders (last 1h20)
                    </div>
                    {recentSenders.size === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>No senders in window.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                        {Array.from(recentSenders).map(jid => {
                          const player  = playerMap.get(jid);
                          const number  = getNumber(jid);
                          const moniker = player?.moniker ?? null;
                          return (
                            <div key={jid} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                              <span style={{ color: 'var(--muted)', fontFamily: 'monospace' }}>+{number}</span>
                              {moniker && (
                                <span style={{
                                  padding: '1px 7px', borderRadius: 99, fontSize: 11,
                                  background: 'rgba(255,255,255,0.06)', color: 'var(--text)',
                                }}>
                                  {moniker}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Full JID */}
                    <div style={{ paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
                      {gid}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
