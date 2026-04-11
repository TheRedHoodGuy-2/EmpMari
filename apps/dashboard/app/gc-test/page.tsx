'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Group = { group_id: string; name: string | null };

type CmdRow = { id: string; group_id: string; command: string; status: string; created_at: string; sent_at: string | null };

type LogEntry = {
  id: string;
  created_at: string;
  sender_jid: string | null;
  sender_type: string | null;
  raw_text: string | null;
  template_id: string | null;
  fields_json: unknown;
  message_id: string | null;
};
function ts(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
}

function senderColor(type: string | null) {
  switch (type) {
    case 'self': return '#818cf8';
    case 'bot':  return '#fb923c';
    default:     return '#9ca3af';
  }
}

function templateColor(t: string | null) {
  if (!t) return '#4b5563';
  if (t.includes('SPAWN'))   return '#f59e0b';
  if (t.includes('CLAIM'))   return '#34d399';
  if (t.includes('NULL'))    return '#4b5563';
  return '#60a5fa';
}

export default function GcTestPage() {
  const [groups,     setGroups]     = useState<Group[]>([]);
  const [selectedGc, setSelectedGc] = useState<string>('');
  const [cmd,        setCmd]        = useState<string>('.cds');
  const [sending,    setSending]    = useState(false);
  const [sentMsg,    setSentMsg]    = useState<string | null>(null);
  const [logs,       setLogs]       = useState<LogEntry[]>([]);
  const [watching,   setWatching]   = useState(false);
  const [pending,    setPending]    = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  // Load groups
  useEffect(() => {
    void fetch('/api/groups?bust=1')
      .then(r => r.json())
      .then((d: Group[]) => {
        setGroups(d);
        if (d.length > 0) setSelectedGc(d[0]!.group_id);
      });
  }, []);

  // Check if bot already has a pending command (on load)
  useEffect(() => {
    void fetch('/api/bot-command')
      .then(r => r.json())
      .then((d: { pending_command: { text: string; group_id: string } | null }) => {
        if (d.pending_command) setPending(`Pending: "${d.pending_command.text}" → ${d.pending_command.group_id}`);
      });
  }, []);

  // Realtime subscription — watch parse_log for selected GC
  useEffect(() => {
    if (!selectedGc || !watching) return;

    // Load last 20 entries first
    void supabase
      .from('parse_log')
      .select('id,created_at,sender_jid,sender_type,raw_text,template_id,fields_json,message_id')
      .eq('group_id', selectedGc)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (data) setLogs((data as LogEntry[]).reverse());
      });

    const ch = supabase
      .channel(`gc_test_${selectedGc}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'parse_log', filter: `group_id=eq.${selectedGc}` },
        (payload) => {
          setLogs(prev => [...prev, payload.new as LogEntry].slice(-100));
          // Auto-scroll
          setTimeout(() => {
            feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
          }, 50);
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(ch); };
  }, [selectedGc, watching]);

  async function sendCommand() {
    if (!selectedGc || !cmd.trim()) return;
    setSending(true);
    setSentMsg(null);
    try {
      const res = await fetch('/api/bot-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: selectedGc, text: cmd.trim() }),
      });
      const d = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || d.error) throw new Error(d.error ?? 'Failed');
      setSentMsg(`✅ Queued "${cmd.trim()}" — bot will send within 2s`);
      setPending(`Pending: "${cmd.trim()}" → ${selectedGc}`);
      if (!watching) setWatching(true);
    } catch (e) {
      setSentMsg(`❌ ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  async function clearPending() {
    await fetch('/api/bot-command', { method: 'DELETE' });
    setPending(null);
    setSentMsg('Cleared pending command.');
  }

  const gcName = (id: string) => groups.find(g => g.group_id === id)?.name ?? id;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900, margin: '0 auto', fontFamily: 'monospace' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 }}>GC Command Tester</h1>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
          Send a command through the bot and watch replies in realtime. Temporary debug tool.
        </p>
      </div>

      {/* Pending banner */}
      {pending && (
        <div style={{
          background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.3)',
          borderRadius: 8, padding: '8px 14px', marginBottom: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <span style={{ fontSize: 12, color: '#fb923c' }}>{pending}</span>
          <button onClick={() => void clearPending()} style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 6,
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--muted)', cursor: 'pointer',
          }}>Clear</button>
        </div>
      )}

      {/* Controls */}
      <div style={{
        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12, padding: '16px 20px', marginBottom: 20,
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {/* GC selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 60 }}>Group</span>
          <select
            value={selectedGc}
            onChange={e => { setSelectedGc(e.target.value); setLogs([]); setWatching(false); }}
            style={{
              flex: 1, padding: '7px 10px', borderRadius: 8, fontSize: 12,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text)', cursor: 'pointer',
            }}
          >
            {groups.map(g => (
              <option key={g.group_id} value={g.group_id}>{g.name ?? g.group_id}</option>
            ))}
          </select>
        </div>

        {/* Command input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 60 }}>Command</span>
          <input
            type="text"
            value={cmd}
            onChange={e => setCmd(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void sendCommand(); }}
            placeholder=".cds"
            style={{
              flex: 1, padding: '7px 10px', borderRadius: 8, fontSize: 13,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text)', fontFamily: 'monospace',
            }}
          />
          <button
            onClick={() => void sendCommand()}
            disabled={sending || !selectedGc}
            style={{
              padding: '7px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: sending ? 'rgba(255,255,255,0.05)' : '#2563eb',
              color: sending ? 'var(--muted)' : '#fff',
              border: 'none', cursor: sending ? 'default' : 'pointer',
            }}
          >{sending ? 'Queuing…' : 'Send'}</button>
        </div>

        {/* Watch toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 60 }}>Watch</span>
          <button
            onClick={() => { setWatching(w => !w); if (!watching) setLogs([]); }}
            style={{
              padding: '5px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: watching ? '#16a34a' : 'rgba(255,255,255,0.06)',
              color: watching ? '#fff' : 'var(--muted)',
              border: `1px solid ${watching ? '#16a34a' : 'rgba(255,255,255,0.1)'}`,
              cursor: 'pointer',
            }}
          >{watching ? '● Live' : 'Start watching'}</button>
          {watching && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              Watching <strong style={{ color: 'var(--text)' }}>{gcName(selectedGc)}</strong>
            </span>
          )}
          {sentMsg && <span style={{ fontSize: 12, color: sentMsg.startsWith('✅') ? '#4ade80' : '#f87171', marginLeft: 'auto' }}>{sentMsg}</span>}
        </div>
      </div>

      {/* Quick command presets */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {['.cds', '.gs', '.ping', '.myseries', '.daily'].map(preset => (
          <button
            key={preset}
            onClick={() => setCmd(preset)}
            style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
              background: cmd === preset ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.04)',
              color: cmd === preset ? '#60a5fa' : 'var(--muted)',
              border: `1px solid ${cmd === preset ? '#60a5fa44' : 'rgba(255,255,255,0.07)'}`,
              fontFamily: 'monospace',
            }}
          >{preset}</button>
        ))}
      </div>

      {/* Live feed */}
      <div style={{
        background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12, overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Message feed {logs.length > 0 && `(${logs.length})`}
          </span>
          {logs.length > 0 && (
            <button onClick={() => setLogs([])} style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 5,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: 'var(--muted)', cursor: 'pointer',
            }}>Clear</button>
          )}
        </div>

        <div ref={feedRef} style={{ height: 440, overflowY: 'auto', padding: '8px 0' }}>
          {logs.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
              {watching ? 'Waiting for messages…' : 'Click "Start watching" then send a command.'}
            </div>
          ) : (
            logs.map(log => (
              <div key={log.id} style={{
                padding: '6px 14px',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
                display: 'grid',
                gridTemplateColumns: '52px 80px 90px 1fr',
                gap: 8,
                alignItems: 'start',
                fontSize: 11,
              }}>
                {/* Time */}
                <span style={{ color: 'rgba(255,255,255,0.25)', whiteSpace: 'nowrap', paddingTop: 1 }}>
                  {ts(log.created_at)}
                </span>

                {/* Sender type */}
                <span style={{
                  color: senderColor(log.sender_type),
                  fontWeight: 600, paddingTop: 1,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  {log.sender_type ?? '?'}
                </span>

                {/* Template */}
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 4,
                  background: `${templateColor(log.template_id)}22`,
                  color: templateColor(log.template_id),
                  fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden',
                  textOverflow: 'ellipsis', alignSelf: 'start',
                }}>
                  {log.template_id ?? 'NULL'}
                </span>

                {/* Raw text */}
                <span style={{
                  color: 'var(--text)', lineHeight: 1.5,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  maxHeight: 80, overflow: 'hidden',
                  opacity: log.sender_type === 'self' ? 0.5 : 1,
                }}>
                  {log.raw_text?.slice(0, 300) ?? '—'}
                  {(log.raw_text?.length ?? 0) > 300 && <span style={{ color: 'var(--muted)' }}> …{log.raw_text!.length - 300} more chars</span>}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ marginTop: 12, fontSize: 10, color: 'rgba(255,255,255,0.2)', display: 'flex', gap: 16 }}>
        <span><span style={{ color: '#818cf8' }}>■</span> self (bot)</span>
        <span><span style={{ color: '#fb923c' }}>■</span> bot (tensura)</span>
        <span><span style={{ color: '#9ca3af' }}>■</span> human</span>
        <span><span style={{ color: '#f59e0b' }}>■</span> spawn</span>
        <span><span style={{ color: '#34d399' }}>■</span> claim</span>
      </div>
    </div>
  );
}
