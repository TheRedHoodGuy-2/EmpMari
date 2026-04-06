'use client';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useGroupNames } from '@/lib/use-group-names';
import { Trash2 } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────

type CardEvent = {
  id: string;
  created_at: string;
  group_id: string;
  spawn_id: string;
  card_name: string | null;
  tier: string | null;
  price: number | null;
  issue: number | null;
  image_url: string | null;
  claimed: boolean;
  claimed_at: string | null;
  claimer_jid: string | null;
  claim_source: 'bot' | 'other' | null;
  decision_should_claim: boolean | null;
  decision_reason: string | null;
  decision_delay_ms: number | null;
};

type Filter = 'all' | 'unclaimed' | 'claimed';
type Sort   = 'newest' | 'oldest' | 'tier' | 'price';

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

function formatPrice(n: number): string {
  return '$' + n.toLocaleString('en-US');
}

function getNumber(jid: string): string {
  const atIdx = jid.indexOf('@');
  const local = atIdx !== -1 ? jid.slice(0, atIdx) : jid;
  const ci    = local.indexOf(':');
  return ci !== -1 ? local.slice(0, ci) : local;
}

function tierOrder(tier: string | null): number {
  if (tier === 'S') return 99;
  const n = parseInt(tier ?? '0', 10);
  return isNaN(n) ? 0 : n;
}

// ── Tier style ────────────────────────────────────────────────

type TierStyle = { bg: string; color: string; label: string };

function getTierStyle(tier: string | null): TierStyle {
  const n = parseInt(tier ?? '', 10);
  if (!isNaN(n) && n >= 7) return { bg: 'rgba(153,27,27,0.35)', color: '#fca5a5', label: `T${tier}` };
  switch (tier) {
    case '1':  return { bg: 'rgba(255,255,255,0.08)', color: 'var(--muted)',  label: 'T1' };
    case '2':  return { bg: 'var(--green-dim)',        color: 'var(--green)', label: 'T2' };
    case '3':  return { bg: 'var(--blue-dim)',         color: 'var(--blue)',  label: 'T3' };
    case '4':  return { bg: 'rgba(139,92,246,0.15)',   color: '#a78bfa',      label: 'T4' };
    case '5':  return { bg: 'rgba(249,115,22,0.15)',   color: '#fb923c',      label: 'T5' };
    case '6':  return { bg: 'var(--red-dim)',          color: 'var(--red)',   label: 'T6' };
    case 'S':  return { bg: 'rgba(234,179,8,0.18)',    color: '#fbbf24',      label: 'S'  };
    default:   return { bg: 'rgba(255,255,255,0.08)', color: 'var(--muted)', label: tier ?? '?' };
  }
}

// ── Download helper ───────────────────────────────────────────

async function downloadImage(url: string, filename: string): Promise<void> {
  const res  = await fetch(url);
  const blob = await res.blob();
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Card tile ─────────────────────────────────────────────────

function CardTile({ card, tick, onDelete, groupName }: { card: CardEvent; tick: number; onDelete: (id: string) => void; groupName: string }) {
  void tick;
  const [expanded, setExpanded] = useState(false);
  const [hovered,  setHovered]  = useState(false);
  const ts = getTierStyle(card.tier);

  async function handleDelete() {
    onDelete(card.id); // optimistic
    await fetch(`/api/card-events/${card.id}`, { method: 'DELETE' });
  }

  const statusPill = card.claimed
    ? card.claim_source === 'bot'
      ? { label: 'Bot claimed',   bg: 'var(--blue-dim)',  color: 'var(--blue)'  }
      : { label: 'Other claimed', bg: 'var(--green-dim)', color: 'var(--green)' }
    : card.decision_should_claim === false
      ? { label: 'Skipped',   bg: 'rgba(255,255,255,0.06)', color: 'var(--muted)' }
      : { label: 'Unclaimed', bg: 'var(--amber-dim)',        color: 'var(--amber)' };

  return (
    <div
      className="card"
      style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Delete button — appears on hover */}
      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); void handleDelete(); }}
          title="Delete card"
          style={{
            position: 'absolute', top: 8, right: card.image_url ? 40 : 8, zIndex: 10,
            background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: 6,
            padding: '4px 7px', cursor: 'pointer', color: '#ef4444',
            backdropFilter: 'blur(4px)',
          }}
        >
          <Trash2 size={13} />
        </button>
      )}

      {/* Image */}
      <div style={{ background: 'var(--surface2)', position: 'relative', flexShrink: 0 }}>
        {card.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.image_url} alt={card.card_name ?? 'card'} style={{ width: '100%', display: 'block' }} />
        ) : (
          <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 36, opacity: 0.15 }}>🃏</span>
          </div>
        )}

        {/* Download — top right, only if image */}
        {card.image_url && (
          <button
            title="Download image"
            onClick={() => void downloadImage(card.image_url!, `${card.spawn_id}_${card.card_name ?? 'card'}.jpg`)}
            style={{
              position: 'absolute', top: 8, right: 8,
              background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: 6,
              padding: '4px 7px', cursor: 'pointer', fontSize: 13, color: '#fff',
              backdropFilter: 'blur(4px)',
            }}
          >↓</button>
        )}

        {/* Tier pill — top left */}
        <span style={{
          position: 'absolute', top: 8, left: 8,
          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
          background: ts.bg, color: ts.color, backdropFilter: 'blur(4px)',
        }}>
          {ts.label}
        </span>
      </div>

      {/* Summary row — always visible, click to expand */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          padding: '10px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', gap: 8,
          borderTop: '1px solid var(--border)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {card.card_name ?? '—'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
              textTransform: 'uppercase' as const,
              padding: '1px 6px', borderRadius: 99,
              background: statusPill.bg, color: statusPill.color,
            }}>
              {statusPill.label}
            </span>
            {card.price !== null && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{formatPrice(card.price)}</span>
            )}
          </div>
        </div>
        <span style={{ color: 'var(--muted)', fontSize: 14, flexShrink: 0, lineHeight: 1 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Collapsible detail */}
      {expanded && (
        <div style={{
          padding: '0 12px 12px',
          display: 'flex', flexDirection: 'column', gap: 4,
          fontSize: 12, borderTop: '1px solid var(--border)',
        }}>
          <div style={{ height: 8 }} />
          {([
            ['Spawn ID', <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{card.spawn_id}</span>],
            card.issue !== null ? ['Issue', `#${card.issue}`] : null,
            ['Spawned', relativeTime(card.created_at)],
            ['Group', groupName],
            // ── Decision ───────────────────────────────────────
            card.decision_should_claim !== null ? [
              'Decision',
              <span style={{ color: card.decision_should_claim ? 'var(--green)' : 'var(--muted)' }}>
                {card.decision_should_claim ? 'Claim' : 'Skip'}
                {card.decision_delay_ms !== null && card.decision_should_claim
                  ? <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{card.decision_delay_ms}ms</span>
                  : null}
              </span>,
            ] : null,
            card.decision_reason ? ['Reason', <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>{card.decision_reason}</span>] : null,
            // ── Claim outcome ──────────────────────────────────
            card.claimed && card.claim_source ? [
              'Source',
              <span style={{ color: card.claim_source === 'bot' ? 'var(--blue)' : 'var(--green)' }}>
                {card.claim_source === 'bot' ? 'Bot' : 'Other'}
              </span>,
            ] : null,
            card.claimed && card.claimer_jid ? ['Claimer', `+${getNumber(card.claimer_jid)}`] : null,
            card.claimed && card.claimed_at  ? ['Claimed at', relativeTime(card.claimed_at)]  : null,
          ] as ([string, React.ReactNode] | null)[])
            .filter((r): r is [string, React.ReactNode] => r !== null)
            .map(([label, value]) => (
              <div key={label} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--muted)', minWidth: 72, flexShrink: 0 }}>{label}</span>
                <span style={{ color: 'var(--text)' }}>{value}</span>
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function CardsPage() {
  const [cards,  setCards]  = useState<CardEvent[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort,   setSort]   = useState<Sort>('newest');
  const [tick,   setTick]   = useState(0);
  const groupName = useGroupNames();

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('card_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (data) setCards(data as CardEvent[]);
    })();
  }, []);

  useEffect(() => {
    const ch = supabase
      .channel('card_events_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'card_events' }, p => {
        setCards(prev => [p.new as CardEvent, ...prev]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'card_events' }, p => {
        const u = p.new as CardEvent;
        setCards(prev => prev.map(c => c.id === u.id ? u : c));
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const counts = useMemo(() => ({
    all:       cards.length,
    unclaimed: cards.filter(c => !c.claimed).length,
    claimed:   cards.filter(c =>  c.claimed).length,
  }), [cards]);

  const displayed = useMemo(() => {
    let list = cards.filter(c => {
      if (filter === 'unclaimed') return !c.claimed;
      if (filter === 'claimed')   return c.claimed;
      return true;
    });
    switch (sort) {
      case 'oldest': list = [...list].reverse(); break;
      case 'tier':   list = [...list].sort((a, b) => tierOrder(b.tier) - tierOrder(a.tier)); break;
      case 'price':  list = [...list].sort((a, b) => (b.price ?? 0) - (a.price ?? 0)); break;
    }
    return list;
  }, [cards, filter, sort]);

  return (
    <div className="fade-up">

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Cards</h1>
          <span className="badge green"><span className="live-dot" />Live</span>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          All spawned cards — updated in realtime as claiming happens.
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>

        {/* Status filters */}
        {(['all', 'unclaimed', 'claimed'] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '6px 13px', borderRadius: 8, fontSize: 12, fontWeight: 500,
            cursor: 'pointer', border: 'none', transition: 'all 0.15s',
            background: filter === f ? 'var(--blue)' : 'var(--surface2)',
            color: filter === f ? '#fff' : 'var(--muted)',
          }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
            <span style={{ marginLeft: 5, opacity: 0.65, fontSize: 11 }}>{counts[f]}</span>
          </button>
        ))}

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

        {/* Sort */}
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Sort:</span>
        {([
          ['newest', 'Newest'],
          ['oldest', 'Oldest'],
          ['tier',   'Tier ↓'],
          ['price',  'Price ↓'],
        ] as [Sort, string][]).map(([s, label]) => (
          <button key={s} onClick={() => setSort(s)} style={{
            padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
            cursor: 'pointer', border: 'none', transition: 'all 0.15s',
            background: sort === s ? 'var(--surface2)' : 'transparent',
            color: sort === s ? 'var(--text)' : 'var(--muted)',
            outline: sort === s ? '1px solid var(--border2)' : 'none',
          }}>
            {label}
          </button>
        ))}

        {/* DECISION: "new/old design" sort placeholder — will be added once
            the distinction is defined. Labelled but disabled for now. */}
        <button disabled style={{
          padding: '6px 12px', borderRadius: 8, fontSize: 12,
          background: 'transparent', border: 'none', color: 'var(--muted)',
          opacity: 0.35, cursor: 'not-allowed',
        }}>
          Design ↓
        </button>
      </div>

      {/* Grid */}
      {displayed.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 13 }}>
          {cards.length === 0
            ? 'No cards yet — waiting for a spawn.'
            : 'No cards match the current filter.'}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
          gap: 16,
        }}>
          {displayed.map(card => (
            <CardTile key={card.id} card={card} tick={tick}
              groupName={groupName(card.group_id)}
              onDelete={id => setCards(prev => prev.filter(c => c.id !== id))} />
          ))}
        </div>
      )}
    </div>
  );
}
