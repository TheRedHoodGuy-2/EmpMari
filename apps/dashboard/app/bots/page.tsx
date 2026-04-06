'use client';

import { useEffect, useState } from 'react';
import { Trash2, Plus, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type GcEntry = { id: string; name: string | null };

type Bot = {
  id:         string;
  created_at: string;
  jid:        string;
  number:     string;
  status:     'verified' | 'unverified';
  moniker:    string | null;
  groups:     GcEntry[];
};

export default function BotsPage() {
  const [bots, setBots]       = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [adding, setAdding]   = useState(false);
  const [newJid, setNewJid]   = useState('');
  const [newNum, setNewNum]   = useState('');
  const [saving, setSaving]   = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/known-bots');
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        setLoading(false);
        return;
      }
      setBots(await res.json());
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();

    // Live updates — new bot registered or existing bot updated
    const channel = supabase
      .channel('known_bots_live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'known_bots' },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            setBots(prev => prev.filter(b => b.id !== (payload.old as Bot).id));
            return;
          }
          // INSERT or UPDATE — re-fetch this single bot with groups enriched
          const row = payload.new as Bot;
          const res = await fetch('/api/known-bots');
          if (!res.ok) return;
          const all = await res.json() as Bot[];
          const updated = all.find(b => b.id === row.id);
          if (!updated) return;
          setBots(prev => {
            const exists = prev.find(b => b.id === updated.id);
            if (exists) return prev.map(b => b.id === updated.id ? updated : b);
            return [updated, ...prev];
          });
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, []);

  async function remove(bot: Bot) {
    setBots(prev => prev.filter(b => b.id !== bot.id));
    await fetch(`/api/known-bots/${bot.id}`, { method: 'DELETE' });
  }

  async function addBot() {
    const jid    = newJid.trim();
    const number = newNum.trim();
    if (!jid || !number) return;
    setSaving(true);
    const res = await fetch('/api/known-bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid, number, status: 'verified' }),
    });
    if (res.ok) {
      const bot = await res.json() as Bot;
      setBots(prev => [bot, ...prev.filter(b => b.id !== bot.id)]);
      setNewJid(''); setNewNum(''); setAdding(false);
    } else {
      const body = await res.json().catch(() => ({})) as { error?: string };
      setError(body.error ?? 'Failed to add bot');
    }
    setSaving(false);
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 800 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
            Known Bots
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {bots.length} registered
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => void load()} title="Refresh"
            style={ghost}>
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setAdding(a => !a)}
            style={adding ? activeBtn : primaryBtn}>
            <Plus size={14} /> Add Bot
          </button>
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '14px 16px', marginBottom: 20,
          display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 }}>
            <label style={label}>JID</label>
            <input value={newJid} onChange={e => setNewJid(e.target.value)}
              placeholder="628xxx@s.whatsapp.net" style={input} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 150 }}>
            <label style={label}>Phone number</label>
            <input value={newNum} onChange={e => setNewNum(e.target.value)}
              placeholder="628xxx" style={input} />
          </div>
          <button onClick={() => void addBot()} disabled={saving || !newJid || !newNum}
            style={{ ...primaryBtn, opacity: saving || !newJid || !newNum ? 0.4 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 8, padding: '10px 14px', fontSize: 13,
          color: '#ef4444', marginBottom: 16,
        }}>{error}</div>
      )}

      {/* Column headers */}
      {!loading && bots.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 140px 1fr 32px',
          gap: 12, padding: '0 14px 6px',
          fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--muted)',
        }}>
          <span>Name</span>
          <span>Number</span>
          <span>Groups</span>
          <span />
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
      ) : bots.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          No bots registered. Run <code style={{ fontFamily: 'monospace', background: 'var(--surface)', padding: '1px 5px', borderRadius: 4 }}>.ping</code> in a group to discover them.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {bots.map(bot => (
            <div key={bot.id} style={{
              display: 'grid', gridTemplateColumns: '1fr 140px 1fr 32px',
              gap: 12, alignItems: 'center',
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '10px 14px',
            }}>
              {/* Moniker */}
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {bot.moniker ?? <span style={{ color: 'var(--muted)', fontStyle: 'italic', fontWeight: 400 }}>unknown</span>}
              </div>

              {/* Number */}
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--muted)' }}>
                +{bot.number}
              </div>

              {/* Groups */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {bot.groups.length === 0
                  ? <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>—</span>
                  : bot.groups.map(gc => (
                    <span key={gc.id} title={gc.id} style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 4,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      whiteSpace: 'nowrap',
                    }}>
                      {gc.name ?? gc.id}
                    </span>
                  ))
                }
              </div>

              {/* Delete */}
              <button onClick={() => void remove(bot)}
                style={{ ...ghost, padding: '4px', color: 'var(--muted)' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500,
  border: 'none', cursor: 'pointer',
  background: 'var(--blue)', color: '#fff',
};
const activeBtn: React.CSSProperties = {
  ...primaryBtn,
  background: 'rgba(255,255,255,0.1)', color: 'var(--text)',
};
const ghost: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 8px', borderRadius: 6, fontSize: 13,
  border: 'none', cursor: 'pointer',
  background: 'transparent', color: 'var(--muted)',
};
const input: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '6px 10px', fontSize: 13, color: 'var(--text)', outline: 'none', width: '100%',
};
const label: React.CSSProperties = {
  fontSize: 11, color: 'var(--muted)', fontWeight: 500,
};
