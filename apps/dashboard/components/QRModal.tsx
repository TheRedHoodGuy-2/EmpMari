'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

interface ControlConfig {
  connection_status: ConnectionStatus;
  qr_code: string | null;
}

export default function QRModal() {
  const [status, setStatus]   = useState<ConnectionStatus | null>(null);
  const [qrCode, setQrCode]   = useState<string | null>(null);
  const [toast, setToast]     = useState(false);
  const toastTimer             = useRef<ReturnType<typeof setTimeout> | null>(null);


  useEffect(() => {
    // Initial fetch
    void supabase
      .from('control_config')
      .select('connection_status, qr_code')
      .eq('singleton', 'X')
      .single()
      .then(({ data }) => {
        if (!data) return;
        setStatus(data.connection_status as ConnectionStatus);
        setQrCode(data.qr_code ?? null);
      });

    // Realtime subscription
    const channel = supabase
      .channel('qr-modal-control-config')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'control_config' },
        (payload) => {
          const row = payload.new as ControlConfig;
          const prev = status;
          setStatus(row.connection_status);
          setQrCode(row.qr_code ?? null);

          if (row.connection_status === 'connected' && prev !== 'connected') {
            setToast(true);
            if (toastTimer.current) clearTimeout(toastTimer.current);
            toastTimer.current = setTimeout(() => setToast(false), 3000);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showModal = status !== null && status !== 'connected' && qrCode !== null;

  return (
    <>
      {showModal && (
        <div
          style={{ backdropFilter: 'blur(8px)' }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        >
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-white px-10 py-8 shadow-2xl">
            <h2 className="text-xl font-bold text-gray-900">Mariabelle is disconnected</h2>
            <p className="text-sm text-gray-500">Scan this QR code with WhatsApp</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrCode} alt="WhatsApp QR code" width={300} height={300} />
            <p className="max-w-xs text-center text-xs text-gray-400">
              QR codes expire every 20 seconds. A new one will appear automatically.
            </p>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-sm font-medium text-white shadow-lg">
          ✅ Connected
        </div>
      )}
    </>
  );
}
