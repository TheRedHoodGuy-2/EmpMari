'use client';
import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

type Heartbeat = {
  pinged_at:  string;
  latency_ms: number;
  status:     string;
};

const supabase = createClient(
  process.env['NEXT_PUBLIC_SUPABASE_URL']!,
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
);

function latencyColor(ms: number, offline: boolean) {
  if (offline) return '#6b7280';
  if (ms < 120)  return '#10b981'; // green
  if (ms < 400)  return '#f59e0b'; // amber
  return '#ef4444';                // red
}

function latencyLabel(ms: number, offline: boolean) {
  if (offline) return 'offline';
  return `${ms}ms`;
}

export default function PingWidget() {
  const [hb, setHb]         = useState<Heartbeat | null>(null);
  const [offline, setOffline] = useState(false);
  const lastPingRef          = useRef<number>(0);

  useEffect(() => {
    // Initial fetch
    void (async () => {
      const { data } = await supabase
        .from('bot_heartbeat')
        .select('pinged_at, latency_ms, status')
        .eq('singleton', 'X')
        .single();
      if (data) {
        setHb(data as Heartbeat);
        lastPingRef.current = new Date(data.pinged_at).getTime();
      }
    })();

    // Realtime subscription — instant updates when bot pings
    const channel = supabase
      .channel('bot-ping')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bot_heartbeat' },
        (payload) => {
          const row = payload.new as Heartbeat;
          setHb(row);
          lastPingRef.current = new Date(row.pinged_at).getTime();
          setOffline(false);
        },
      )
      .subscribe();

    // Stale check — if no ping for >60s, mark offline
    const staleness = setInterval(() => {
      if (lastPingRef.current && Date.now() - lastPingRef.current > 60_000) {
        setOffline(true);
      }
    }, 10_000);

    return () => {
      void supabase.removeChannel(channel);
      clearInterval(staleness);
    };
  }, []);

  const isOffline = offline || hb?.status === 'offline';
  const ms        = hb?.latency_ms ?? 0;
  const color     = latencyColor(ms, isOffline);
  const label     = latencyLabel(ms, isOffline);

  return (
    <div style={{
      position: 'fixed', bottom: 56, left: 16, zIndex: 200,
      display: 'flex', alignItems: 'center', gap: 6,
      fontSize: 11, padding: '4px 9px',
      background: 'var(--surface)', border: `1px solid var(--border)`,
      borderRadius: 20, color: 'var(--muted)',
      pointerEvents: 'none', userSelect: 'none',
      boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      transition: 'opacity 0.3s',
    }}>
      {/* Blinking dot */}
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: color, display: 'inline-block', flexShrink: 0,
        boxShadow: isOffline ? 'none' : `0 0 6px ${color}`,
        animation: isOffline ? 'none' : 'ping-pulse 2s ease-in-out infinite',
      }} />
      <span style={{ color, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {label}
      </span>
      <span style={{ opacity: 0.5 }}>bot</span>
      <style>{`
        @keyframes ping-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
