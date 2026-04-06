'use client';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import type { SenderType } from '@mariabelle/identifier';

// ── Types ─────────────────────────────────────────────────────

export type ParseLogRow = {
  id: string;
  created_at: string;
  group_id: string | null;
  sender_jid: string | null;
  sender_type: SenderType | null;
  message_id: string | null;
  quoted_message_id: string | null;
  has_image: boolean | null;
  raw_text: string;
  template_id: string | null;
  line_count: number | null;
  auto_flagged: boolean | null;
};

// ── Helpers ───────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 5)  return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getNumber(jid: string): string {
  const atIdx = jid.indexOf('@');
  const local = atIdx !== -1 ? jid.slice(0, atIdx) : jid;
  const colonIdx = local.indexOf(':');
  return colonIdx !== -1 ? local.slice(0, colonIdx) : local;
}

// ── Pill styles ───────────────────────────────────────────────

const SENDER_STYLE: Record<SenderType, { bg: string; color: string }> = {
  bot:     { bg: 'var(--blue-dim)',           color: 'var(--blue)'   },
  player:  { bg: 'rgba(255,255,255,0.06)',    color: 'var(--muted)'  },
  self:    { bg: 'var(--green-dim)',          color: 'var(--green)'  },
  unknown: { bg: 'var(--amber-dim)',          color: 'var(--amber)'  },
};

// ── Props ─────────────────────────────────────────────────────

type Props = {
  onRowClick: (raw: string) => void;
};

// ── Component ─────────────────────────────────────────────────

export default function ParseLogFeed({ onRowClick }: Props) {
  const [rows,        setRows]        = useState<ParseLogRow[]>([]);
  const [tick,        setTick]        = useState(0);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // Filter state
  const [filterGroup,  setFilterGroup]  = useState('');
  const [filterSender, setFilterSender] = useState<SenderType | ''>('');
  const [filterNumber, setFilterNumber] = useState('');

  // Derived: distinct group_id values seen in loaded rows
  const groups = useMemo(
    () => [...new Set(rows.map(r => r.group_id).filter(Boolean) as string[])],
    [rows],
  );

  // Load initial rows
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('parse_log')
        .select('id, created_at, group_id, sender_jid, sender_type, message_id, quoted_message_id, has_image, raw_text, template_id, line_count, auto_flagged')
        .order('created_at', { ascending: false })
        .limit(100);
      if (data) setRows(data as ParseLogRow[]);
    })();
  }, []);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('parse_log_feed')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'parse_log' },
        (payload) => {
          setRows(prev => [payload.new as ParseLogRow, ...prev].slice(0, 200));
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  // Tick every 10s to refresh relative timestamps
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);
  void tick;

  // Build message_id lookup for quoted-row highlight
  const messageIdToRowId = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.message_id) map.set(r.message_id, r.id);
    }
    return map;
  }, [rows]);

  // Client-side filtered rows
  const filtered = useMemo(() => rows.filter(r => {
    if (filterGroup  && r.group_id !== filterGroup) return false;
    if (filterSender && r.sender_type !== filterSender) return false;
    if (filterNumber && r.sender_jid && !getNumber(r.sender_jid).includes(filterNumber)) return false;
    return true;
  }), [rows, filterGroup, filterSender, filterNumber]);

  function handleRowClick(row: ParseLogRow) {
    onRowClick(row.raw_text);
    // Highlight the quoted row if there is one
    if (row.quoted_message_id) {
      const targetId = messageIdToRowId.get(row.quoted_message_id);
      setHighlighted(targetId ?? null);
    } else {
      setHighlighted(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Filter bar */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Group filter */}
        <select
          value={filterGroup}
          onChange={e => setFilterGroup(e.target.value)}
          style={{
            background: 'var(--surface2)', border: '1px solid var(--border2)',
            borderRadius: 6, padding: '4px 8px', fontSize: 12,
            color: 'var(--text)', outline: 'none', width: '100%',
          }}
        >
          <option value="">All groups</option>
          {groups.map(g => <option key={g} value={g}>{g.slice(0, 30)}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 6 }}>
          {/* Sender type filter */}
          <select
            value={filterSender}
            onChange={e => setFilterSender(e.target.value as SenderType | '')}
            style={{
              background: 'var(--surface2)', border: '1px solid var(--border2)',
              borderRadius: 6, padding: '4px 8px', fontSize: 12,
              color: 'var(--text)', outline: 'none', flex: 1,
            }}
          >
            <option value="">All types</option>
            <option value="bot">bot</option>
            <option value="player">player</option>
            <option value="self">self</option>
            <option value="unknown">unknown</option>
          </select>

          {/* Number search */}
          <input
            type="text"
            value={filterNumber}
            onChange={e => setFilterNumber(e.target.value)}
            placeholder="number…"
            style={{
              background: 'var(--surface2)', border: '1px solid var(--border2)',
              borderRadius: 6, padding: '4px 8px', fontSize: 12,
              color: 'var(--text)', outline: 'none', flex: 1,
            }}
          />
        </div>
      </div>

      {/* Feed rows */}
      <div style={{ flex: 1, overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            {rows.length === 0 ? 'Waiting for messages from the bot…' : 'No rows match the current filters.'}
          </div>
        ) : filtered.map(row => {
          const senderType = (row.sender_type ?? 'unknown') as SenderType;
          const style      = SENDER_STYLE[senderType];
          const matched    = row.template_id !== null;
          const isHighlighted = highlighted === row.id;
          const senderNum  = row.sender_jid ? getNumber(row.sender_jid) : '?';
          const preview    = row.raw_text.slice(0, 80) + (row.raw_text.length > 80 ? '…' : '');
          const shortGroup = row.group_id ? row.group_id.slice(0, 20) + (row.group_id.length > 20 ? '…' : '') : null;

          return (
            <button
              key={row.id}
              onClick={() => handleRowClick(row)}
              style={{
                width: '100%', textAlign: 'left', background: 'none', border: 'none',
                cursor: 'pointer', padding: '10px 14px',
                borderBottom: '1px solid var(--border)',
                borderLeft: isHighlighted ? '3px solid var(--amber)' : '3px solid transparent',
                transition: 'background 0.1s, border-left-color 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface2)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
            >
              {/* Row 1: pills + timestamp */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3, flexWrap: 'wrap' }}>
                {/* sender type */}
                <span style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.05em',
                  textTransform: 'uppercase' as const,
                  padding: '1px 5px', borderRadius: 99,
                  background: style.bg, color: style.color,
                }}>
                  {senderType}
                </span>

                {/* template id */}
                <span style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.05em',
                  textTransform: 'uppercase' as const,
                  padding: '1px 5px', borderRadius: 99,
                  background: matched ? 'var(--green-dim)' : 'var(--red-dim)',
                  color: matched ? 'var(--green)' : 'var(--red)',
                }}>
                  {matched ? row.template_id : 'NULL'}
                </span>

                {/* auto_flagged dot */}
                {row.auto_flagged && (
                  <span title="Auto-flagged: unknown sender matched a template" style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--amber)', display: 'inline-block', flexShrink: 0,
                  }} />
                )}

                {/* image icon */}
                {row.has_image && (
                  <span title="Has image" style={{ fontSize: 11, color: 'var(--muted)' }}>🖼</span>
                )}

                {/* timestamp */}
                <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
                  {relativeTime(row.created_at)}
                </span>
              </div>

              {/* Row 2: sender number + group */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>+{senderNum}</span>
                {shortGroup && (
                  <span style={{ fontSize: 11, color: 'var(--muted)', opacity: 0.6 }}>{shortGroup}</span>
                )}
              </div>

              {/* Row 3: raw text preview */}
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.4 }}>
                {preview}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
