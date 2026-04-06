'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  Code2, Layers, TrendingUp, Bot,
  AlertTriangle, Trophy, SlidersHorizontal,
  Image, Shuffle, Menu, X, Radio,
} from 'lucide-react';

type NavItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  live: boolean;
};

const NAV: NavItem[] = [
  { href: '/parser',      label: 'Parser',      Icon: Code2,             live: true  },
  { href: '/cards',       label: 'Cards',        Icon: Layers,            live: true  },
  { href: '/images',      label: 'Images',       Icon: Image,             live: true  },
  { href: '/sorter',      label: 'Sorter',       Icon: Shuffle,           live: true  },
  { href: '/gambling',    label: 'Gambling',     Icon: TrendingUp,        live: false },
  { href: '/bots',        label: 'Bots',         Icon: Bot,               live: false },
  { href: '/errors',      label: 'Errors',       Icon: AlertTriangle,     live: false },
  { href: '/leaderboard', label: 'Leaderboard',  Icon: Trophy,            live: false },
  { href: '/control',     label: 'Control',      Icon: SlidersHorizontal, live: false },
];

export default function Sidebar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [path]);

  const nav = (
    <nav style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {NAV.map(({ href, Icon, label, live }) => {
        const active = path === href || path.startsWith(href + '/');
        const disabled = !live;

        if (disabled) {
          // Greyed-out stub — not a real link, just visual placeholder.
          return (
            <div
              key={href}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 10px', borderRadius: 8,
                fontSize: 13, opacity: 0.35,
                color: 'var(--muted)', cursor: 'not-allowed',
              }}
            >
              <Icon size={16} className="nav-icon" />
              <span style={{ flex: 1 }}>{label}</span>
              <span style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: 'rgba(255,255,255,0.06)',
                color: 'var(--muted)',
                padding: '1px 6px', borderRadius: 99,
              }}>Soon</span>
            </div>
          );
        }

        return (
          <Link
            key={href}
            href={href}
            className={`nav-link${active ? ' active' : ''}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 10px', borderRadius: 8,
              fontSize: 13, fontWeight: active ? 500 : 400,
              color: active ? 'var(--text)' : 'var(--muted)',
              background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
              textDecoration: 'none', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
            onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
          >
            <Icon
              size={16}
              className="nav-icon"
              style={{ color: active ? 'var(--blue)' : 'currentColor' }}
            />
            <span style={{ flex: 1 }}>{label}</span>
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
              textTransform: 'uppercase',
              background: 'var(--green-dim)',
              color: 'var(--green)',
              padding: '1px 6px', borderRadius: 99,
            }}>Live</span>
          </Link>
        );
      })}
    </nav>
  );

  const inner = (
    <>
      <div style={{ padding: '0 20px 24px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
          Mariabelle
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          Parser Validation
        </div>
      </div>

      {nav}

      <div style={{ padding: '16px 20px 0', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Radio size={13} className="icon-pulse" style={{ color: 'var(--green)' }} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Live</span>
        </div>
      </div>
    </>
  );

  return (
    <>
      <button className="hamburger-btn" onClick={() => setOpen(true)} aria-label="Open menu">
        <Menu size={18} />
      </button>

      {open && (
        <div className="sidebar-overlay" onClick={() => setOpen(false)} />
      )}

      <aside className={`sidebar${open ? ' open' : ''}`}>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close menu"
          style={{
            display: 'none',
            position: 'absolute', top: 14, right: 14,
            background: 'transparent', border: 'none',
            color: 'var(--muted)', cursor: 'pointer', padding: 4,
          }}
          className="sidebar-close-btn"
        >
          <X size={18} />
        </button>
        {inner}
      </aside>

      <style>{`
        @media (max-width: 768px) {
          .sidebar-close-btn { display: block !important; }
        }
      `}</style>
    </>
  );
}
