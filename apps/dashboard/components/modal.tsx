'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Modal({
  onClose,
  children,
  maxWidth = 480,
}: {
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  // Track mount so createPortal only runs client-side
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Lock scroll on .main-content (actual scrolling container) + html
  useEffect(() => {
    const main = document.querySelector('.main-content') as HTMLElement | null;
    const prevMain = main?.style.overflowY ?? '';
    if (main) main.style.overflowY = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      if (main) main.style.overflowY = prevMain;
      document.documentElement.style.overflow = '';
    };
  }, []);

  if (!mounted) return null;

  // Portal into document.body — escapes any ancestor with overflow/transform/will-change
  // so position:fixed always means "relative to the viewport", never to a scroll container.
  return createPortal(
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
        overflowY: 'auto',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '8vh 24px 60px',
        animation: 'modal-overlay-in 0.18s ease both',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border2)',
          borderRadius: 16,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          width: '100%', maxWidth,
          display: 'flex', flexDirection: 'column',
          animation: 'modal-in 0.2s cubic-bezier(.4,0,.2,1) both',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {children}
      </div>
      <style>{`
        @keyframes modal-overlay-in { from { opacity:0 } to { opacity:1 } }
        @keyframes modal-in {
          from { opacity:0; transform:scale(0.94) translateY(12px) }
          to   { opacity:1; transform:scale(1) translateY(0) }
        }
      `}</style>
    </div>,
    document.body,
  );
}

export function ModalHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      padding: '20px 24px 16px', borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      <button
        onClick={onClose}
        style={{
          background: 'transparent', border: 'none', color: 'var(--muted)',
          cursor: 'pointer', padding: 4, borderRadius: 6,
          display: 'flex', alignItems: 'center',
          transition: 'color 0.12s, background 0.12s',
          marginLeft: 12, flexShrink: 0,
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)';
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}

export function ModalBody({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '16px 24px 24px', overflowY: 'auto', flex: 1, maxHeight: '70vh' }}>
      {children}
    </div>
  );
}
