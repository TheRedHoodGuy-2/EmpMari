'use client';
import { useState, useEffect, useCallback, startTransition } from 'react';
import { supabase } from '@/lib/supabase';
import { clientCache } from '@/lib/client-cache';
import { Heart, Users, Search } from 'lucide-react';
import { Modal, ModalHeader, ModalBody } from '@/components/modal';

// ── Types ──────────────────────────────────────────────────────
type CardDb = {
  card_id:       string;
  name:          string;
  series:        string | null;
  tier:          string | null;
  stars:         number | null;
  image_url:     string | null;
  description?:  string | null; // not in list payload — fetched on modal open
  event:         string | null;
  wishlist_count: number;
  owner_names:   string;
  scraped_at:    string | null;
};

type Person = {
  id:           string;
  jid:          string;
  number:       string;
  display_name: string | null;
  gcs:          string[];
  last_seen:    string | null;
  series_count?: number;
};

type PlayerSeries = {
  jid:        string;
  series:     string;
  card_count: number;
  gc_id:      string | null;
  updated_at: string;
};

type SeriesLeader = {
  series:      string;
  rank:        number;
  player_name: string;
  card_count:  number;
  seen_at:     string;
};

// ── Helpers ────────────────────────────────────────────────────
// owner_names is stored as JSON — the site sends objects {userId, username, avatar}
// not plain strings, so we must normalise before rendering.
function parseOwners(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown[];
    return parsed.map(o => {
      if (typeof o === 'string') return o;
      if (o && typeof o === 'object') {
        const obj = o as Record<string, unknown>;
        return String(obj['username'] ?? obj['name'] ?? obj['userId'] ?? '?');
      }
      return String(o);
    });
  } catch { return []; }
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

function getTierStyle(tier: string | null): { bg: string; color: string } {
  switch (tier) {
    case '1':  return { bg: 'rgba(255,255,255,0.08)', color: 'var(--muted)'  };
    case '2':  return { bg: 'var(--green-dim)',        color: 'var(--green)'  };
    case '3':  return { bg: 'var(--blue-dim)',         color: 'var(--blue)'   };
    case '4':  return { bg: 'rgba(139,92,246,0.15)',   color: '#a78bfa'       };
    case '5':  return { bg: 'rgba(249,115,22,0.15)',   color: '#fb923c'       };
    case '6':  return { bg: 'var(--red-dim)',          color: 'var(--red)'    };
    case 'S':  return { bg: 'rgba(234,179,8,0.18)',    color: '#fbbf24'       };
    default:   return { bg: 'rgba(255,255,255,0.08)', color: 'var(--muted)'  };
  }
}

const DISPLAY_CAP = 500; // render cap — 34k DOM nodes kills the browser

// A card is HOT if it has 3+ owners OR any single owner holds 5+ copies (owner_names array length)
function isHot(card: { wishlist_count: number; owner_names: string }): boolean {
  if (card.wishlist_count >= 3) return true;
  try {
    const owners = JSON.parse(card.owner_names || '[]') as unknown[];
    if (owners.length >= 5) return true;
  } catch { /* ignore */ }
  return false;
}

// ── Tab 1: Card Database ───────────────────────────────────────
function CardDatabase() {
  const [cards, setCards]               = useState<CardDb[]>([]);
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [search, setSearch]             = useState('');
  const [tierFilter, setTierFilter]     = useState('all');
  const [seriesFilter, setSeriesFilter] = useState('all');
  const [eventFilter, setEventFilter]   = useState('all');
  const [sortBy, setSortBy]             = useState<'tier' | 'wishlist' | 'name'>('tier');
  const [selected, setSelected]         = useState<CardDb | null>(null);
  const [lastScraped, setLastScraped]   = useState<string | null>(null);

  const load = useCallback(async (bust = false) => {
    setLoading(true);
    setLoadError(null);
    try {
      const all: CardDb[] = await clientCache.getCardDb(bust);
      // Deduplicate + latest date computed before touching React state
      const seen = new Set<string>();
      const deduped = all.filter(c => { if (seen.has(c.card_id)) return false; seen.add(c.card_id); return true; });
      const latest = deduped.reduce<string | null>((acc, c) => {
        if (!c.scraped_at) return acc;
        return !acc || c.scraped_at > acc ? c.scraped_at : acc;
      }, null);
      // startTransition = non-urgent update: React won't block button clicks
      // or tab switches while committing 34k records to state.
      startTransition(() => {
        setCards(deduped);
        setLastScraped(latest);
      });
    } catch (e) {
      setLoadError((e as Error).message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const tierOrder = (t: string | null) => {
    if (t === 'S') return 99;
    const n = parseInt(t ?? '0', 10);
    return isNaN(n) ? 0 : n;
  };

  const allSeries = Array.from(new Set(cards.map(c => c.series).filter(Boolean) as string[])).sort();
  const allEvents = Array.from(new Set(cards.map(c => c.event).filter(Boolean) as string[])).sort();

  const filtered = cards
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.series ?? '').toLowerCase().includes(search.toLowerCase()))
    .filter(c => tierFilter === 'all' || c.tier === tierFilter)
    .filter(c => seriesFilter === 'all' || c.series === seriesFilter)
    .filter(c => eventFilter === 'all' ? true : eventFilter === 'standard' ? !c.event : c.event === eventFilter)
    .sort((a, b) => {
      if (sortBy === 'tier')     return tierOrder(b.tier) - tierOrder(a.tier) || a.name.localeCompare(b.name);
      if (sortBy === 'wishlist') return (b.wishlist_count ?? 0) - (a.wishlist_count ?? 0);
      return a.name.localeCompare(b.name);
    });

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: '5px 10px',
    background: 'var(--surface2)', border: '1px solid var(--border2)',
    borderRadius: 6, color: 'var(--text)', outline: 'none',
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap' as const, gap: 8 }}>
        <div style={{ fontSize: 13, color: loadError ? '#ef4444' : 'var(--muted)' }}>
          {loadError
            ? `Error: ${loadError}`
            : loading
            ? `Loading…`
            : <>
                {filtered.length.toLocaleString()} / {cards.length.toLocaleString()} cards
                {filtered.length > DISPLAY_CAP && <span style={{ color: 'var(--amber)', marginLeft: 8 }}>· showing first {DISPLAY_CAP.toLocaleString()} — refine filters to see more</span>}
              </>
          }
          {!loadError && lastScraped && <span style={{ marginLeft: 8 }}>· Last scraped {relativeTime(lastScraped)}</span>}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' as const }}>
        <div style={{ position: 'relative' as const }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or series…" style={{ ...inputStyle, paddingLeft: 26, width: 200 }} />
        </div>
        <select value={tierFilter} onChange={e => setTierFilter(e.target.value)} style={inputStyle}>
          <option value="all">All tiers</option>
          {['1','2','3','4','5','6','S'].map(t => <option key={t} value={t}>T{t}</option>)}
        </select>
        <select value={seriesFilter} onChange={e => setSeriesFilter(e.target.value)} style={{ ...inputStyle, maxWidth: 180 }}>
          <option value="all">All series</option>
          {allSeries.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={eventFilter} onChange={e => setEventFilter(e.target.value)} style={inputStyle}>
          <option value="all">All events</option>
          <option value="standard">Standard (no event)</option>
          {allEvents.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} style={inputStyle}>
          <option value="tier">Sort: Tier</option>
          <option value="wishlist">Sort: Wishlist</option>
          <option value="name">Sort: Name</option>
        </select>
      </div>

      {/* Grid — capped at DISPLAY_CAP for performance */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {filtered.slice(0, DISPLAY_CAP).map(card => {
            const ts     = getTierStyle(card.tier);
            const owners = parseOwners(card.owner_names);
            const hot    = isHot(card);
            return (
              <div
                key={card.card_id}
                onClick={() => {
                  setSelected(card);
                  // Lazy-fetch description only when modal opens
                  if (card.description === undefined) {
                    void supabase.from('card_db').select('description').eq('card_id', card.card_id).single()
                      .then(({ data }) => setSelected(prev => prev?.card_id === card.card_id ? { ...prev, description: data?.description ?? null } : prev));
                  }
                }}
                style={{
                  background: 'var(--surface)', border: `1px solid ${hot ? 'rgba(251,115,22,0.4)' : 'var(--border)'}`,
                  borderRadius: 10, overflow: 'hidden', cursor: 'pointer',
                  transition: 'border-color 0.15s, transform 0.12s, box-shadow 0.12s',
                  willChange: 'transform',
                  position: 'relative',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--blue)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = hot ? 'rgba(251,115,22,0.4)' : 'var(--border)'; (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.boxShadow = ''; }}
              >
                {hot && (
                  <div style={{ position: 'absolute', top: 6, right: 6, fontSize: 12, background: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: '1px 4px', zIndex: 1 }}>🔥</div>
                )}
                {card.image_url
                  ? <img src={card.image_url} alt={card.name} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block' }} />
                  : <div style={{ width: '100%', aspectRatio: '3/4', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 11 }}>No image</div>
                }
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.series ?? '—'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: ts.bg, color: ts.color }}>T{card.tier}</span>
                    <div style={{ display: 'flex', gap: 6, fontSize: 10, color: 'var(--muted)' }}>
                      <span><Heart size={9} style={{ display: 'inline', marginRight: 2 }} />{card.wishlist_count}</span>
                      <span><Users size={9} style={{ display: 'inline', marginRight: 2 }} />{owners.length}</span>
                    </div>
                  </div>
                  {card.event && (
                    <div style={{ marginTop: 4, fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(251,191,36,0.12)', color: '#fbbf24', display: 'inline-block' }}>
                      {card.event}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Card detail modal */}
      {selected && (() => {
        const ts     = getTierStyle(selected.tier);
        const owners = parseOwners(selected.owner_names);
        return (
          <Modal onClose={() => setSelected(null)}>
            <ModalHeader
              title={selected.name}
              subtitle={selected.series ?? undefined}
              onClose={() => setSelected(null)}
            />
            <ModalBody>
              {selected.image_url && (
                <img src={selected.image_url} alt={selected.name} style={{ width: '100%', borderRadius: 10, objectFit: 'cover', marginBottom: 16, display: 'block' }} />
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: ts.bg, color: ts.color }}>
                  T{selected.tier}{selected.stars != null ? ` · ${'★'.repeat(Math.min(selected.stars, 5))}` : ''}
                </span>
                {selected.event && (
                  <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>
                    {selected.event}
                  </span>
                )}
              </div>
              {selected.description && (
                <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 14 }}>{selected.description}</p>
              )}
              <div style={{ display: 'flex', gap: 20, fontSize: 12, marginBottom: 14 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Heart size={12} style={{ color: 'var(--red)' }} />{selected.wishlist_count} wishlists
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Users size={12} style={{ color: 'var(--blue)' }} />{owners.length} owners
                </span>
              </div>
              {owners.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Owners</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 4 }}>
                    {owners.map((o, i) => (
                      <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--surface2)', border: '1px solid var(--border)' }}>{o}</span>
                    ))}
                  </div>
                </div>
              )}
              {selected.scraped_at && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 14 }}>Scraped {relativeTime(selected.scraped_at)}</div>
              )}
            </ModalBody>
          </Modal>
        );
      })()}
    </div>
  );
}

// ── Tab 2: People ──────────────────────────────────────────────
function PeopleTab() {
  const [people, setPeople]             = useState<Person[]>([]);
  const [gcNames, setGcNames]           = useState<Map<string, string>>(new Map());
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [gcFilter, setGcFilter]         = useState('all');
  const [hideNoSeries, setHideNoSeries] = useState(false);
  const [selected, setSelected]         = useState<Person | null>(null);
  const [personSeries, setPersonSeries] = useState<PlayerSeries[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const [pData, gData, { data: sData }] = await Promise.all([
        clientCache.getPeople(),
        clientCache.getGroups(),
        supabase.from('player_series').select('jid'),
      ]);

      const seriesCounts = new Map<string, number>();
      for (const s of sData ?? []) seriesCounts.set(s.jid, (seriesCounts.get(s.jid) ?? 0) + 1);

      const nameMap = new Map<string, string>();
      for (const g of gData) if (g.name) nameMap.set(g.group_id, g.name);
      const enrichedPeople = pData.map(p => ({ ...p, series_count: seriesCounts.get(p.jid) ?? 0 }));
      startTransition(() => {
        setGcNames(nameMap);
        setPeople(enrichedPeople);
      });
      setLoading(false);
    })();
  }, []);

  async function selectPerson(p: Person) {
    setSelected(p);
    setSeriesLoading(true);
    const { data } = await supabase
      .from('player_series')
      .select('jid,series,card_count,gc_id,updated_at')
      .eq('jid', p.jid)
      .order('card_count', { ascending: false });
    setPersonSeries(data ?? []);
    setSeriesLoading(false);
  }

  // Only include GCs that have a name — unnamed ones are useless as a filter label
  const allGcs = Array.from(new Set(people.flatMap(p => p.gcs ?? [])))
    .filter(gcId => gcNames.has(gcId))
    .sort((a, b) => (gcNames.get(a) ?? a).localeCompare(gcNames.get(b) ?? b));

  const filtered = people
    .filter(p => !search || (p.display_name ?? '').toLowerCase().includes(search.toLowerCase()) || p.number.includes(search))
    .filter(p => gcFilter === 'all' || (p.gcs ?? []).includes(gcFilter))
    .filter(p => !hideNoSeries || (p.series_count ?? 0) > 0);

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: '5px 10px',
    background: 'var(--surface2)', border: '1px solid var(--border2)',
    borderRadius: 6, color: 'var(--text)', outline: 'none',
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' as const, alignItems: 'center' }}>
        <div style={{ position: 'relative' as const }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or number…" style={{ ...inputStyle, paddingLeft: 26, width: 180 }} />
        </div>
        <select value={gcFilter} onChange={e => setGcFilter(e.target.value)} style={inputStyle}>
          <option value="all">All GCs</option>
          {allGcs.map(g => <option key={g} value={g}>{gcNames.get(g) ?? g}</option>)}
        </select>
        <button
          onClick={() => setHideNoSeries(v => !v)}
          style={{
            fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
            background: hideNoSeries ? 'var(--blue)' : 'var(--surface)',
            color: hideNoSeries ? '#fff' : 'var(--muted)',
            cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
          }}
        >
          Has series
        </button>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {loading ? 'Loading…' : `${filtered.length} people`}
        </span>
      </div>

      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(p => (
            <div
              key={p.id}
              onClick={() => void selectPerson(p)}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 12,
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--blue)'}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.display_name ?? p.number}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  +{p.number} · {(p.gcs ?? []).length} GC(s) · last seen {relativeTime(p.last_seen)}
                </div>
              </div>
              {(p.series_count ?? 0) > 0 && (
                <span style={{ fontSize: 11, color: 'var(--blue)', flexShrink: 0 }}>{p.series_count} series</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Person detail modal */}
      {selected && (
        <Modal onClose={() => setSelected(null)}>
          <ModalHeader
            title={selected.display_name ?? selected.number}
            subtitle={`+${selected.number} · last seen ${relativeTime(selected.last_seen)}`}
            onClose={() => setSelected(null)}
          />
          <ModalBody>
            {/* GCs */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Group Chats ({(selected.gcs ?? []).length})
              </div>
              {(selected.gcs ?? []).length === 0
                ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>No GCs tracked</div>
                : (selected.gcs ?? []).map(g => (
                    <div key={g} style={{ fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--border)', color: gcNames.get(g) ? 'var(--text)' : 'var(--muted)' }}>
                      {gcNames.get(g) ?? <span style={{ fontStyle: 'italic' }}>Unnamed group (run .gs)</span>}
                    </div>
                  ))
              }
            </div>

            {/* Series */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Series ({personSeries.length})
              </div>
              {seriesLoading
                ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</div>
                : personSeries.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>No series data — needs to run .myseries in a GC</div>
                : personSeries.map(s => (
                    <div key={s.series} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span>{s.series}</span>
                      <span style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{s.card_count} cards</span>
                    </div>
                  ))
              }
            </div>
          </ModalBody>
        </Modal>
      )}
    </div>
  );
}

type SeriesPerson = { jid: string; display_name: string | null; number: string | null; series_count: number };

// ── Tab 3: Series Intelligence ────────────────────────────────
function SeriesIntelligence() {
  const [people, setPeople]             = useState<SeriesPerson[]>([]);
  const [selectedJid, setSelectedJid]   = useState<string | null>(null);
  const [myCollection, setMyCollection] = useState<PlayerSeries[]>([]);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [matchSeries, setMatchSeries]   = useState<string | null>(null);
  const [matches, setMatches]           = useState<{ jid: string; display_name: string | null; number: string | null; count: number; source: 'tracked' | 'leaderboard'; rank?: number }[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);

  // Load all people who have series data, with their display names
  useEffect(() => {
    void (async () => {
      // All distinct JIDs in player_series
      const { data: seriesRows } = await supabase
        .from('player_series')
        .select('jid');
      if (!seriesRows?.length) return;

      const jidCounts = new Map<string, number>();
      for (const r of seriesRows) jidCounts.set(r.jid, (jidCounts.get(r.jid) ?? 0) + 1);
      const jids = Array.from(jidCounts.keys());

      // Join with people table for display names
      const { data: peopleRows } = await supabase
        .from('people')
        .select('jid, display_name, number')
        .in('jid', jids);
      const peopleMap = new Map((peopleRows ?? []).map(p => [p.jid as string, p]));

      const list: SeriesPerson[] = jids.map(jid => {
        const p = peopleMap.get(jid);
        return {
          jid,
          display_name: p?.display_name ?? null,
          number:       p?.number ?? null,
          series_count: jidCounts.get(jid) ?? 0,
        };
      }).sort((a, b) => b.series_count - a.series_count);

      setPeople(list);
      // Auto-select first person
      if (list.length > 0 && !selectedJid) setSelectedJid(list[0]!.jid);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load series for selected person
  useEffect(() => {
    if (!selectedJid) return;
    setCollectionLoading(true);
    void (async () => {
      const { data } = await supabase
        .from('player_series')
        .select('jid,series,card_count,gc_id,updated_at')
        .eq('jid', selectedJid)
        .order('card_count', { ascending: false });
      setMyCollection(data ?? []);
      setCollectionLoading(false);
    })();
  }, [selectedJid]);

  async function findMatches(series: string) {
    setMatchSeries(series);
    setMatchLoading(true);

    // Pull from both player_series (JID-tracked) and series_leaders (leaderboard names)
    const [{ data: seriesData }, { data: leaderData }, ppl] = await Promise.all([
      supabase.from('player_series').select('jid,card_count').eq('series', series).order('card_count', { ascending: false }).limit(50),
      supabase.from('series_leaders').select('player_name,card_count,rank').eq('series', series).order('rank', { ascending: true }).limit(50),
      clientCache.getPeople(),
    ]);

    const peopleByJid = new Map(ppl.map(p => [p.jid, p]));
    const peopleByNum = new Map(ppl.map(p => [p.number, p]));
    // name→person for leaderboard matching
    const peopleByName = new Map(ppl.filter(p => p.display_name).map(p => [p.display_name!.toLowerCase().trim(), p]));

    type MatchEntry = { key: string; display_name: string | null; number: string | null; count: number; source: 'tracked' | 'leaderboard'; rank?: number };
    const seen = new Set<string>();
    const result: MatchEntry[] = [];

    // Section 1: player_series (people we track with JIDs)
    for (const r of seriesData ?? []) {
      let p = peopleByJid.get(r.jid);
      if (!p && r.jid.endsWith('@s.whatsapp.net')) {
        const num = r.jid.split('@')[0] ?? '';
        p = peopleByNum.get(num);
      }
      const display_name = p?.display_name ?? null;
      const number = p?.number ?? (r.jid.endsWith('@s.whatsapp.net') ? r.jid.split('@')[0]! : null);
      if (!display_name && !number) continue; // nothing useful
      const key = display_name ?? number!;
      if (!seen.has(key)) { seen.add(key); result.push({ key, display_name, number: number ?? null, count: r.card_count, source: 'tracked' }); }
    }

    // Section 2: series_leaders (leaderboard names — may overlap with above)
    for (const r of leaderData ?? []) {
      const lowerName = r.player_name.toLowerCase().trim();
      // Try to match to a known person
      let matched = peopleByName.get(lowerName);
      if (!matched) {
        for (const [nm, p] of peopleByName) {
          if (nm.includes(lowerName) || lowerName.includes(nm)) { matched = p; break; }
        }
      }
      const display_name = matched?.display_name ?? null;
      const number = matched?.number ?? null;
      const key = display_name ?? r.player_name;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ key, display_name, number, count: r.card_count, source: 'leaderboard', rank: r.rank });
      }
    }

    result.sort((a, b) => b.count - a.count);
    setMatches(result.map(r => ({ jid: r.key, display_name: r.display_name, number: r.number, count: r.count, source: r.source, rank: r.rank })));
    setMatchLoading(false);
  }

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: '5px 10px',
    background: 'var(--surface2)', border: '1px solid var(--border2)',
    borderRadius: 6, color: 'var(--text)', outline: 'none', flex: 1,
  };

  const selectedPerson = people.find(p => p.jid === selectedJid);
  const personLabel = (p: SeriesPerson) => {
    if (p.display_name && p.number) return `${p.display_name} (+${p.number})`;
    if (p.display_name)             return p.display_name;
    if (p.number)                   return `+${p.number}`;
    // Extract number from JID — never show raw JID
    const num = p.jid.split('@')[0]?.replace(/\D/g, '') ?? '';
    return num ? `+${num}` : 'Unknown';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* Collection */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' as const }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Series Collection</h2>
          {/* Person picker */}
          {people.length > 0 && (
            <select
              value={selectedJid ?? ''}
              onChange={e => setSelectedJid(e.target.value)}
              style={{ fontSize: 12, padding: '4px 8px', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)', outline: 'none' }}
            >
              {people.map(p => (
                <option key={p.jid} value={p.jid}>
                  {personLabel(p)} — {p.series_count} series
                </option>
              ))}
            </select>
          )}
          {selectedPerson && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{myCollection.length} series tracked</span>
          )}
        </div>

        {people.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>
            No series data yet. Have someone run <code style={{ background: 'var(--surface2)', padding: '1px 5px', borderRadius: 3 }}>.myseries</code> in a GC — the bot will capture the reply automatically.
          </p>
        ) : collectionLoading ? (
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</p>
        ) : myCollection.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>No series for this person yet.</p>
        ) : (
          myCollection.map(s => (
            <div key={s.series} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1, fontSize: 13 }}>{s.series}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{s.card_count} cards</div>
              <button
                className="btn btn-ghost"
                onClick={() => void findMatches(s.series)}
                style={{ fontSize: 11, padding: '3px 10px' }}
              >
                Match
              </button>
            </div>
          ))
        )}
      </div>

      {/* Match modal */}
      {matchSeries && (
        <Modal onClose={() => setMatchSeries(null)}>
          <ModalHeader title={`Others collecting: ${matchSeries}`} onClose={() => setMatchSeries(null)} />
          <ModalBody>
            {matchLoading
              ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</div>
              : matches.length === 0
              ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>No other collectors found in DB</div>
              : matches.map(m => (
                  <div key={m.jid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{m.display_name ?? `+${m.number}`}</span>
                        {m.source === 'tracked' && (
                          <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}>tracked</span>
                        )}
                        {m.source === 'leaderboard' && m.rank != null && (
                          <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>#{m.rank} lb</span>
                        )}
                      </div>
                      {m.display_name && m.number && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>+{m.number}</div>
                      )}
                    </div>
                    <span style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', fontSize: 12, flexShrink: 0 }}>{m.count} cards</span>
                  </div>
                ))
            }
          </ModalBody>
        </Modal>
      )}
    </div>
  );
}

// ── Tab 4: Leaderboards ───────────────────────────────────────
function LeaderboardTab() {
  const [rows, setRows]       = useState<SeriesLeader[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [nameMap, setNameMap] = useState<Map<string, { display_name: string | null; number: string; jid: string }>>(new Map());

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const [{ data }, ppl] = await Promise.all([
        supabase
          .from('series_leaders')
          .select('series,rank,player_name,card_count,seen_at')
          .order('series', { ascending: true })
          .order('rank',   { ascending: true })
          .limit(5000),
        clientCache.getPeople(),
      ]);
      setRows(data ?? []);

      // Build name→person map for leaderboard matching
      // Key: lowercased display_name for fast lookup
      const nm = new Map<string, { display_name: string | null; number: string; jid: string }>();
      for (const p of ppl) {
        if (p.display_name) nm.set(p.display_name.toLowerCase().trim(), { display_name: p.display_name, number: p.number, jid: p.jid });
      }
      setNameMap(nm);
      setLoading(false);
    })();
  }, []);

  // Try to match a leaderboard player_name to our people list
  function matchPerson(playerName: string) {
    const key = playerName.toLowerCase().trim();
    // Exact match first
    if (nameMap.has(key)) return nameMap.get(key)!;
    // Partial: our name contains their name or vice versa
    for (const [nm, p] of nameMap) {
      if (nm.includes(key) || key.includes(nm)) return p;
    }
    return null;
  }

  // Group by series
  const grouped = new Map<string, SeriesLeader[]>();
  for (const r of rows) {
    if (!grouped.has(r.series)) grouped.set(r.series, []);
    grouped.get(r.series)!.push(r);
  }

  const seriesNames = Array.from(grouped.keys()).sort();
  const filtered = search
    ? seriesNames.filter(s => s.toLowerCase().includes(search.toLowerCase()))
    : seriesNames;

  const rankColor = (rank: number) =>
    rank === 1 ? '#fbbf24' : rank === 2 ? '#9ca3af' : rank === 3 ? '#fb923c' : 'var(--muted)';

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: '5px 10px',
    background: 'var(--surface2)', border: '1px solid var(--border2)',
    borderRadius: 6, color: 'var(--text)', outline: 'none',
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' as const }}>
        <div style={{ position: 'relative' as const }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter series…"
            style={{ ...inputStyle, paddingLeft: 26, width: 220 }}
          />
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {loading ? 'Loading…' : `${filtered.length} series · ${rows.length} entries`}
        </span>
        {!loading && rows.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--amber)' }}>
            No data yet — run <code style={{ background: 'var(--surface2)', padding: '1px 5px', borderRadius: 3 }}>.slb [series name]</code> in a GC
          </span>
        )}
      </div>

      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {filtered.map(seriesName => {
            const entries = grouped.get(seriesName) ?? [];
            return (
              <div key={seriesName} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                {/* Series header */}
                <div style={{
                  padding: '10px 14px',
                  background: 'rgba(255,255,255,0.03)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{seriesName}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{entries.length} ranked</span>
                </div>
                {/* Entries */}
                {entries.map((r, i) => {
                  const matched = matchPerson(r.player_name);
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 14px',
                      borderBottom: i < entries.length - 1 ? '1px solid var(--border)' : 'none',
                      background: matched ? 'rgba(59,130,246,0.04)' : 'transparent',
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: rankColor(r.rank), minWidth: 28, fontVariantNumeric: 'tabular-nums' }}>
                        #{r.rank}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13 }}>{r.player_name}</span>
                        {matched && (
                          <span style={{ fontSize: 10, marginLeft: 8, padding: '1px 6px', borderRadius: 4, background: 'rgba(59,130,246,0.15)', color: 'var(--blue)' }}>
                            {matched.display_name ?? `+${matched.number}`} · known
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {r.card_count} cards
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Tab 5: My Cards ────────────────────────────────────────────
type PlayerCard = {
  id:         string;
  jid:        string;
  card_id:    string | null;
  card_name:  string;
  tier:       number;
  gc_id:      string | null;
  updated_at: string;
  // joined from card_db
  image_url?:  string | null;
  series?:     string | null;
};

const SELF_JID_KEY = 'mariabelle_self_jid';

function MyCardsTab() {
  const [rows, setRows]             = useState<PlayerCard[]>([]);
  const [gcNames, setGcNames]       = useState<Map<string, string>>(new Map());
  const [selfJid, setSelfJid]       = useState<string>('');
  const [allJids, setAllJids]       = useState<{ jid: string; label: string }[]>([]);
  const [picking, setPicking]       = useState(false);  // show the "who are you?" picker
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState<PlayerCard | null>(null);
  const [collectors, setCollectors] = useState<{ jid: string; display_name: string | null; number: string | null; card_count: number }[]>([]);
  const [collectorsLoading, setCollectorsLoading] = useState(false);
  const [allPeople, setAllPeople]   = useState<Map<string, { display_name: string | null; number: string }>>(new Map());

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const [{ data: cardRows }, ppl, gcs] = await Promise.all([
        supabase.from('player_cards').select('jid').limit(500),
        clientCache.getPeople(),
        clientCache.getGroups(),
      ]);

      const pplMap = new Map<string, { display_name: string | null; number: string }>(
        ppl.map(p => [p.jid, { display_name: p.display_name, number: p.number }])
      );
      setAllPeople(pplMap);
      setGcNames(new Map(gcs.map(g => [g.group_id, g.name ?? g.group_id])));

      // Distinct JIDs with readable labels
      const seen = new Set<string>();
      const jids: { jid: string; label: string }[] = [];
      for (const r of cardRows ?? []) {
        if (seen.has(r.jid)) continue;
        seen.add(r.jid);
        const p = pplMap.get(r.jid);
        const num = r.jid.includes('@s.whatsapp.net') ? r.jid.split('@')[0]! : null;
        const label = p?.display_name ?? (num ? `+${num}` : r.jid);
        jids.push({ jid: r.jid, label });
      }
      setAllJids(jids);

      // Check localStorage for saved self JID
      const saved = typeof window !== 'undefined' ? localStorage.getItem(SELF_JID_KEY) : null;
      const validSaved = saved && jids.some(j => j.jid === saved) ? saved : null;

      if (validSaved) {
        setSelfJid(validSaved);
        await loadCardsFor(validSaved);
      } else if (jids.length === 1) {
        // Only one person — must be self
        const j = jids[0]!.jid;
        setSelfJid(j);
        localStorage.setItem(SELF_JID_KEY, j);
        await loadCardsFor(j);
      } else if (jids.length > 1) {
        // Multiple people — need to pick
        setPicking(true);
        setLoading(false);
      } else {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseSelf(jid: string) {
    localStorage.setItem(SELF_JID_KEY, jid);
    setSelfJid(jid);
    setPicking(false);
    void loadCardsFor(jid);
  }

  async function loadCardsFor(jid: string) {
    if (!jid) return;
    setLoading(true);
    const { data } = await supabase
      .from('player_cards')
      .select('id,jid,card_id,card_name,tier,gc_id,updated_at')
      .eq('jid', jid)
      .order('tier', { ascending: false });
    if (!data) { setLoading(false); return; }

    // Enrich with card_db data — use client cache (already loaded if Cards tab was visited)
    const cardIds = new Set((data as PlayerCard[]).map(r => r.card_id).filter(Boolean) as string[]);
    const allCards = cardIds.size > 0 ? await clientCache.getCardDb().catch(() => []) : [];
    const dbMap = new Map(
      allCards
        .filter(c => cardIds.has(c.card_id))
        .map(c => [c.card_id, { image_url: c.image_url, series: c.series }])
    );

    const enriched = (data as PlayerCard[]).map(r => ({
      ...r,
      image_url: r.card_id ? (dbMap.get(r.card_id)?.image_url ?? null) : null,
      series:    r.card_id ? (dbMap.get(r.card_id)?.series    ?? null) : null,
    }));
    setRows(enriched);
    setLoading(false);
  }

  async function openCard(card: PlayerCard) {
    setSelected(card);
    setCollectors([]);
    if (!card.series) return;
    setCollectorsLoading(true);
    // Find everyone who has this series in player_series
    const { data } = await supabase
      .from('player_series')
      .select('jid,card_count')
      .eq('series', card.series)
      .order('card_count', { ascending: false });
    const results = (data ?? [])
      .map((r: { jid: string; card_count: number }) => {
        const person = allPeople.get(r.jid);
        // Extract number from JID like "628xxx@s.whatsapp.net" — skip lid-format JIDs
        const jidNumber = r.jid.includes('@s.whatsapp.net') ? r.jid.split('@')[0]! : null;
        const number = person?.number ?? jidNumber;
        return {
          jid:          r.jid,
          display_name: person?.display_name ?? null,
          number,
          card_count:   r.card_count,
        };
      })
      // Skip entries where we have no name AND no number — nothing useful to show
      .filter(r => r.display_name || r.number);
    setCollectors(results);
    setCollectorsLoading(false);
  }

  const tierLabel = (t: number): string => {
    if (t >= 6) return 'S';
    return String(t);
  };

  const filtered = rows.filter(r =>
    !search || r.card_name.toLowerCase().includes(search.toLowerCase()) || (r.series ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const tierCounts = rows.reduce<Record<number, number>>((acc, r) => {
    acc[r.tier] = (acc[r.tier] ?? 0) + 1;
    return acc;
  }, {});

  const lastSeen = rows.length > 0
    ? rows.reduce((a, b) => a.updated_at > b.updated_at ? a : b).updated_at
    : null;

  const selfLabel = (() => {
    const p = allPeople.get(selfJid);
    if (p?.display_name) return p.display_name;
    if (p?.number) return `+${p.number}`;
    return selfJid.split('@')[0] ?? 'Me';
  })();

  // "Who are you?" picker — shown when multiple JIDs exist and no saved self
  if (picking) {
    return (
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Which one is you?</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Pick once — saved in this browser.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
          {allJids.map(({ jid, label }) => (
            <button
              key={jid}
              onClick={() => chooseSelf(jid)}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
                padding: '10px 16px', fontSize: 13, fontWeight: 500, color: 'var(--text)',
                cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.12s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--blue)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        {selfJid && (
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            {selfLabel}
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>My Cards</span>
          </div>
        )}
        {selfJid && (
          <button
            onClick={() => { localStorage.removeItem(SELF_JID_KEY); setSelfJid(''); setRows([]); setPicking(allJids.length > 1); }}
            style={{ fontSize: 11, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
          >
            not me
          </button>
        )}
        {rows.length > 0 && (
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search cards…"
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
                padding: '6px 10px 6px 30px', fontSize: 13, color: 'var(--text)', outline: 'none', width: 200,
              }}
            />
          </div>
        )}
      </div>

      {/* Stats bar */}
      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}>
            {rows.length} cards total
          </div>
          {Object.entries(tierCounts).sort((a,b) => Number(b[0]) - Number(a[0])).map(([tier, count]) => {
            const ts = getTierStyle(tierLabel(Number(tier)));
            return (
              <div key={tier} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, background: ts.bg, color: ts.color, border: '1px solid transparent' }}>
                T{tier}: {count}
              </div>
            );
          })}
          {lastSeen && (
            <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, marginLeft: 'auto' }}>
              Updated {relativeTime(lastSeen)}
            </div>
          )}
        </div>
      )}

      {loading && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>}

      {!loading && !selfJid && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          No card collections recorded yet. Run migration <code style={{ fontFamily: 'monospace', background: 'var(--surface)', padding: '1px 5px', borderRadius: 4 }}>006_player_cards.sql</code> in Supabase, then run <code style={{ fontFamily: 'monospace', background: 'var(--surface)', padding: '1px 5px', borderRadius: 4 }}>.col</code> in a group.
        </div>
      )}
      {!loading && selfJid && rows.length === 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          No cards recorded yet. Run <code style={{ fontFamily: 'monospace', background: 'var(--surface)', padding: '1px 5px', borderRadius: 4 }}>.col</code> in a group.
        </div>
      )}

      {/* Card grid */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {filtered.map(card => {
            const tLabel = tierLabel(card.tier);
            const ts = getTierStyle(tLabel);
            return (
              <div
                key={card.id}
                onClick={() => void openCard(card)}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
                  overflow: 'hidden', cursor: 'pointer',
                  transition: 'border-color 0.15s, transform 0.15s',
                  display: 'flex', flexDirection: 'column',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--blue)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none'; }}
              >
                {card.image_url
                  ? <img src={card.image_url} alt={card.card_name} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', aspectRatio: '3/4', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🃏</div>
                }
                <div style={{ padding: '6px 8px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.card_name}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: ts.bg, color: ts.color }}>T{tLabel}</span>
                    {card.series && <span style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.series}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Card detail modal */}
      {selected && (
        <Modal onClose={() => { setSelected(null); setCollectors([]); }} maxWidth={440}>
          <ModalHeader title={selected.card_name} subtitle={selected.series ?? undefined} onClose={() => { setSelected(null); setCollectors([]); }} />
          <ModalBody>
            {selected.image_url && (
              <img src={selected.image_url} alt={selected.card_name} style={{ width: '100%', borderRadius: 8, marginBottom: 12 }} />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted)' }}>Tier</span>
                <span style={getTierStyle(tierLabel(selected.tier))}>{tierLabel(selected.tier)}</span>
              </div>
              {selected.series && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--muted)' }}>Series</span>
                  <span style={{ color: 'var(--text)' }}>{selected.series}</span>
                </div>
              )}
              {selected.gc_id && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--muted)' }}>Seen in</span>
                  <span style={{ color: 'var(--text)' }}>{gcNames.get(selected.gc_id) ?? selected.gc_id}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted)' }}>Last updated</span>
                <span style={{ color: 'var(--text)' }}>{relativeTime(selected.updated_at)}</span>
              </div>
            </div>

            {/* Others collecting this series */}
            {selected.series && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>
                  Others collecting: {selected.series}
                </div>
                {collectorsLoading && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</div>}
                {!collectorsLoading && collectors.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No data — run .slb {selected.series} to fetch leaderboard</div>
                )}
                {!collectorsLoading && collectors.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {collectors.map(c => (
                      <div key={c.jid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'var(--bg)', borderRadius: 6, fontSize: 13 }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                            {c.display_name ?? `+${c.number}`}
                          </div>
                          {c.display_name && c.number && (
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>+{c.number}</div>
                          )}
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--blue)', flexShrink: 0 }}>{c.card_count} cards</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </ModalBody>
        </Modal>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────
type Tab = 'cards' | 'people' | 'series' | 'leaderboard' | 'mycards';

export default function SeriesPage() {
  const [tab, setTab] = useState<Tab>('cards');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'cards',       label: 'Card Database'       },
    { id: 'people',      label: 'People'              },
    { id: 'series',      label: 'Series Intelligence' },
    { id: 'leaderboard', label: 'Leaderboards'        },
    { id: 'mycards',     label: 'My Cards'            },
  ];

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Series</h1>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>Card database, player collections, and series intelligence</p>
      </div>

      <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid var(--border)' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              fontSize: 13, padding: '8px 18px', border: 'none', background: 'transparent',
              color: tab === t.id ? 'var(--text)' : 'var(--muted)',
              borderBottom: tab === t.id ? '2px solid var(--blue)' : '2px solid transparent',
              cursor: 'pointer', fontWeight: tab === t.id ? 600 : 400,
              transition: 'color 0.15s',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'cards'       && <CardDatabase />}
      {tab === 'people'      && <PeopleTab />}
      {tab === 'series'      && <SeriesIntelligence />}
      {tab === 'leaderboard' && <LeaderboardTab />}
      {tab === 'mycards'     && <MyCardsTab />}
    </div>
  );
}
