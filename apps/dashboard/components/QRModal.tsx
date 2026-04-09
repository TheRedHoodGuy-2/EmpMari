'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

interface ControlConfig {
  connection_status: ConnectionStatus;
  qr_code: string | null;
}

export default function QRModal() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [toast, setToast]   = useState(false);
  const toastTimer           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStatus           = useRef<ConnectionStatus | null>(null);

  const fetchConfig = () => {
    supabase
      .from('control_config')
      .select('connection_status, qr_code')
      .eq('singleton', 'X')
      .single()
      .then(({ data }) => {
        if (!data) return;
        if (data.connection_status === 'connected' && prevStatus.current !== 'connected') {
          setToast(true);
          if (toastTimer.current) clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(false), 3000);
        }
        prevStatus.current = data.connection_status as ConnectionStatus;
        setStatus(data.connection_status as ConnectionStatus);
        setQrCode(data.qr_code ?? null);
      });
  };

  useEffect(() => {
    fetchConfig();

    // Poll every 10s so QR stays fresh (QR codes expire every 20s)
    const pollId = setInterval(fetchConfig, 10_000);

    // Realtime as bonus — fires instantly if Supabase Replication is enabled for this table
    const channel = supabase
      .channel('qr-modal-control-config')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'control_config' },
        (payload) => {
          const row = payload.new as ControlConfig;
          if (row.connection_status === 'connected' && prevStatus.current !== 'connected') {
            setToast(true);
            if (toastTimer.current) clearTimeout(toastTimer.current);
            toastTimer.current = setTimeout(() => setToast(false), 3000);
          }
          prevStatus.current = row.connection_status;
          setStatus(row.connection_status);
          setQrCode(row.qr_code ?? null);
        },
      )
      .subscribe();

    return () => {
      clearInterval(pollId);
      void supabase.removeChannel(channel);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showModal = status !== null && status !== 'connected' && qrCode !== null;

  return (
    <>
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
            background: '#fff', borderRadius: 16,
            padding: '32px 40px',
            boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
          }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111' }}>
              Mariabelle is disconnected
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: '#666' }}>
              Scan this QR code with WhatsApp
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrCode} alt="WhatsApp QR code" width={300} height={300} />
            <p style={{ margin: 0, fontSize: 12, color: '#999', textAlign: 'center', maxWidth: 260 }}>
              QR codes expire every 20 seconds. A new one will appear automatically.
            </p>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#16a34a', color: '#fff',
          padding: '12px 20px', borderRadius: 12,
          fontSize: 14, fontWeight: 500,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          ✅ Connected
        </div>
      )}
    </>
  );
}
