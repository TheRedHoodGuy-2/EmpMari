'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Wifi, WifiOff, Loader2, Heart, Radio, Ping } from 'lucide-react';

type ControlConfig = {
  heartbeat_at:         string | null;
  connection_status:    string;
  last_send_latency_ms: number | null;
};

type BotPing = { pingMs: number } | null;

function secondsAgo(iso: string | null): string {
  if (!iso) return '—';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function statusColor(status: string): string {
  if (status === 'connected')    return 'var(--green)';
  if (status === 'connecting')   return 'var(--amber)';
  return '#6b7280';
}

function statusIcon(status: string) {
  if (status === 'connected')  return <Wifi size={11} />;
  if (status === 'connecting') return <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />;
  return <WifiOff size={11} />;
}

function latencyColor(ms: number | null): string {
  if (ms === null) return '#6b7280';
  if (ms < 200)   return 'var(--green)';
  if (ms < 600)   return 'var(--amber)';
  return 'var(--red)';
}

export default function BotStatusWidget() {
  const [cfg, setCfg]       = useState<ControlConfig | null>(null);
  const [botPing, setBotPing] = useState<number | null>(null);
  const [, setTick]         = useState(0); // force re-render every 5s to update "Xs ago"

  useEffect(() => {
    // Initial fetch
    void (async () => {
      const { data } = await supabase
        .from('control_config')
        .select('heartbeat_at, connection_status, last_send_latency_ms')
        .eq('singleton', 'X')
        .single();
      if (data) setCfg(data as ControlConfig);

      // Most recent BOT_PING from parse_log
      const { data: pingRow } = await supabase
        .from('parse_log')
        .select('fields_json')
        .eq('template_id', 'BOT_PING')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pingRow) {
        const ms = (pingRow.fields_json as { pingMs?: number } | null)?.pingMs ?? null;
        if (ms !== null) setBotPing(ms);
      }
    })();

    // Realtime — control_config updates
    const channel = supabase
      .channel('control-config-status')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'control_config',
        },
        (payload) => {
          if (payload.new) setCfg(payload.new as ControlConfig);
        },
      )
      .subscribe();

    // Tick every 5s so "X ago" stays fresh
    const ticker = setInterval(() => setTick(t => t + 1), 5000);

    return () => {
      void supabase.removeChannel(channel);
      clearInterval(ticker);
    };
  }, []);

  const status  = cfg?.connection_status ?? 'unknown';
  const color   = statusColor(status);
  const sendMs  = cfg?.last_send_latency_ms ?? null;

  return (
    <div style={{
      position: 'fixed', bottom: 16, left: 16, zIndex: 200,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '9px 12px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      pointerEvents: 'none', userSelect: 'none',
      minWidth: 160,
    }}>
      {/* Connection status row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ color, display: 'flex', alignItems: 'center' }}>
          {statusIcon(status)}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color, textTransform: 'capitalize', transition: 'color 0.3s' }}>
          {status}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Heartbeat */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--muted)' }}>
          <Heart size={9} style={{ color: 'var(--red)', flexShrink: 0 }} />
          <span>Last beat: <span style={{ color: 'var(--text)' }}>{secondsAgo(cfg?.heartbeat_at ?? null)}</span></span>
        </div>

        {/* Send latency */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--muted)' }}>
          <Radio size={9} style={{ color: latencyColor(sendMs), flexShrink: 0 }} />
          <span>Send latency: <span style={{ color: latencyColor(sendMs), fontVariantNumeric: 'tabular-nums' }}>
            {sendMs !== null ? `${sendMs}ms` : '—'}
          </span></span>
        </div>

        {/* BOT_PING */}
        {botPing !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--muted)' }}>
            <span style={{ fontSize: 9, flexShrink: 0 }}>🏓</span>
            <span>Bot ping: <span style={{ color: latencyColor(botPing), fontVariantNumeric: 'tabular-nums' }}>
              {botPing}ms
            </span></span>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
