'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, X, Pause, AlertTriangle, CheckCircle2 } from 'lucide-react';

type JobState =
  | { status: 'idle' }
  | { status: 'running'; page: number; total: number; cards: number; startedAt: number; retrying?: boolean; retryIn?: number; attempt?: number }
  | { status: 'done';    imported: number; duration: string; finishedAt: number }
  | { status: 'stopped' }
  | { status: 'error';   message: string };

// Smooth counter hook — animates from prev to next value
function useAnimatedValue(target: number, duration = 400) {
  const [display, setDisplay] = useState(target);
  const rafRef   = useRef<number>(0);
  const startRef = useRef<number>(0);
  const fromRef  = useRef<number>(target);

  useEffect(() => {
    if (target === display) return;
    fromRef.current  = display;
    startRef.current = performance.now();
    cancelAnimationFrame(rafRef.current);

    const animate = (now: number) => {
      const t = Math.min((now - startRef.current) / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease-in-out
      setDisplay(Math.round(fromRef.current + (target - fromRef.current) * ease));
      if (t < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return display;
}

export default function ScrapeWidget() {
  const [job, setJob]             = useState<JobState>({ status: 'idle' });
  const [dismissed, setDismissed] = useState(false);
  const prevStatusRef             = useRef<string>('idle');
  const prevPageRef               = useRef<number>(0);
  const prevRetryRef              = useRef<boolean>(false);

  const poll = useCallback(async () => {
    try {
      const res  = await fetch('/api/scrape');
      const data = await res.json() as JobState;
      const statusChanged  = data.status !== prevStatusRef.current;
      const pageChanged    = data.status === 'running' && data.page !== prevPageRef.current;
      const retryChanged   = data.status === 'running' && (data.retrying ?? false) !== prevRetryRef.current;
      const retryInChanged = data.status === 'running' && data.retrying;
      if (statusChanged || pageChanged || retryChanged || retryInChanged) {
        prevStatusRef.current  = data.status;
        if (data.status === 'running') {
          prevPageRef.current  = data.page;
          prevRetryRef.current = data.retrying ?? false;
        }
        if (data.status === 'running') setDismissed(false);
        setJob(data);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void poll();
  }, [poll]);

  useEffect(() => {
    if (job.status !== 'running') return;
    const id = setInterval(() => void poll(), 1500);
    return () => clearInterval(id);
  }, [job.status, poll]);

  async function start() {
    const res  = await fetch('/api/scrape', { method: 'POST' });
    const data = await res.json() as { job: JobState };
    if (data.job) { prevStatusRef.current = data.job.status; setJob(data.job); }
    setDismissed(false);
  }

  async function stop() {
    const res  = await fetch('/api/scrape', { method: 'DELETE' });
    const data = await res.json() as JobState;
    prevStatusRef.current = data.status;
    setJob(data);
  }

  const running  = job.status === 'running';
  const retrying = running && (job as Extract<JobState, { status: 'running' }>).retrying;
  const retryIn  = running ? (job as Extract<JobState, { status: 'running' }>).retryIn ?? 0 : 0;
  const attempt  = running ? (job as Extract<JobState, { status: 'running' }>).attempt ?? 0 : 0;
  const page     = running ? job.page : 0;
  const total    = running ? job.total : 0;
  const rawCards = running ? job.cards : 0;
  const pct      = running && total > 0 ? (page / total) * 100 : 0;

  const animCards = useAnimatedValue(rawCards, 500);
  const animPct   = useAnimatedValue(Math.round(pct), 600);

  const showFull = !dismissed && (running || job.status === 'done' || job.status === 'stopped' || job.status === 'error');

  // ── Collapsed pill ────────────────────────────────────────────
  if (!showFull) {
    return (
      <button
        onClick={() => void start()}
        title="Scrape card database"
        style={{
          position: 'fixed', bottom: 16, right: 16, zIndex: 200,
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 11, padding: '5px 10px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 20, color: 'var(--muted)', cursor: 'pointer',
          pointerEvents: 'auto',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.18)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)'; }}
      >
        <RefreshCw size={10} />
        Scrape
      </button>
    );
  }

  // ── State-based colours ───────────────────────────────────────
  const accentColor = retrying         ? 'var(--amber)'
    : job.status === 'error'           ? 'var(--red)'
    : job.status === 'done'            ? 'var(--green)'
    : job.status === 'stopped'         ? 'var(--muted)'
    : 'var(--blue)';

  const borderColor = retrying         ? 'rgba(245,158,11,0.3)'
    : job.status === 'error'           ? 'rgba(239,68,68,0.35)'
    : job.status === 'done'            ? 'rgba(16,185,129,0.3)'
    : 'var(--border)';

  const StatusIcon = retrying          ? AlertTriangle
    : job.status === 'done'            ? CheckCircle2
    : job.status === 'stopped'         ? Pause
    : RefreshCw;

  const statusLabel = retrying         ? `Retrying… (${retryIn}s)`
    : running                          ? 'Scraping…'
    : job.status === 'done'            ? 'Done'
    : job.status === 'stopped'         ? 'Stopped'
    : 'Error';

  return (
    <>
      <style>{`
        @keyframes scrape-spin  { to { transform: rotate(360deg); } }
        @keyframes scrape-pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
        @keyframes scrape-shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-3px)} 40%,80%{transform:translateX(3px)} }
        @keyframes scrape-slidein {
          from { opacity:0; transform:translateY(12px) scale(0.96); }
          to   { opacity:1; transform:translateY(0)    scale(1); }
        }
        .scrape-widget { animation: scrape-slidein 0.25s cubic-bezier(.4,0,.2,1) both; }
        .scrape-btn {
          font-size: 10px; padding: 2px 8px; border-radius: 4px; cursor: pointer;
          transition: all 0.12s; border: 1px solid transparent;
        }
        .scrape-btn:active { transform: scale(0.94); }
        .scrape-icon-btn {
          background: transparent; border: none; color: var(--muted);
          cursor: pointer; padding: 2px; line-height:1; border-radius:4px;
          transition: all 0.12s; display:flex; align-items:center;
        }
        .scrape-icon-btn:hover { color: var(--text); background: rgba(255,255,255,0.06); }
        .scrape-icon-btn:active { transform: scale(0.9); }
      `}</style>

      <div className="scrape-widget" style={{
        position: 'fixed', bottom: 16, right: 16, zIndex: 200,
        width: 272, background: 'var(--surface)', border: `1px solid ${borderColor}`,
        borderRadius: 12, padding: '12px 14px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
        pointerEvents: 'auto',
        transition: 'border-color 0.3s',
      }}>

        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: accentColor, transition: 'color 0.3s' }}>
            <StatusIcon size={12} style={{
              animation: running && !retrying ? 'scrape-spin 1s linear infinite'
                : retrying                   ? 'scrape-pulse 0.8s ease-in-out infinite'
                : 'none',
              transition: 'color 0.3s',
            }} />
            {statusLabel}
            {retrying && attempt > 0 && (
              <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 400, marginLeft: 2 }}>
                #{attempt}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {running && (
              <button className="scrape-btn" onClick={() => void stop()} style={{
                background: 'transparent',
                borderColor: 'rgba(239,68,68,0.4)',
                color: 'var(--red)',
              }}>
                Stop
              </button>
            )}
            {!running && (
              <button className="scrape-icon-btn" onClick={() => setDismissed(true)}>
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Running state */}
        {running && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 7 }}>
              <span>
                Page <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{page}</span>
                {total > 0 && <> / <span style={{ color: 'var(--text)' }}>{total}</span></>}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
                {animCards.toLocaleString()} cards
              </span>
            </div>

            {/* Progress bar */}
            <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden', marginBottom: retrying ? 8 : 0 }}>
              <div style={{
                width: `${animPct}%`, height: '100%', borderRadius: 99,
                background: retrying
                  ? 'linear-gradient(90deg, var(--amber), #fbbf24)'
                  : 'linear-gradient(90deg, var(--blue), #60a5fa)',
                transition: 'width 0.8s cubic-bezier(.4,0,.2,1), background 0.4s',
                boxShadow: retrying ? '0 0 8px rgba(245,158,11,0.5)' : '0 0 8px rgba(59,130,246,0.4)',
              }} />
            </div>

            {/* Retry banner */}
            {retrying && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 10, color: 'var(--amber)',
                padding: '5px 8px', borderRadius: 6,
                background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.2)',
                animation: 'scrape-pulse 1.2s ease-in-out infinite',
              }}>
                <AlertTriangle size={10} />
                Connection issue — retrying in {retryIn}s
              </div>
            )}
          </>
        )}

        {/* Done */}
        {job.status === 'done' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--green)' }}>
            <CheckCircle2 size={13} />
            <span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{job.imported.toLocaleString()}</strong> cards imported in {job.duration}
            </span>
          </div>
        )}

        {/* Stopped */}
        {job.status === 'stopped' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
            <span>Scrape cancelled</span>
            <button className="scrape-btn" onClick={() => void start()} style={{
              background: 'var(--blue-dim)', borderColor: 'rgba(59,130,246,0.3)', color: 'var(--blue)',
            }}>
              Restart
            </button>
          </div>
        )}

        {/* Error */}
        {job.status === 'error' && (
          <>
            <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8, lineHeight: 1.4, animation: 'scrape-shake 0.4s ease' }}>
              {job.message}
            </div>
            <button className="scrape-btn" onClick={() => void start()} style={{
              background: 'var(--blue)', borderColor: 'var(--blue)', color: '#fff',
              padding: '4px 12px', fontSize: 11,
            }}>
              Retry
            </button>
          </>
        )}
      </div>
    </>
  );
}
