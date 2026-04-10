'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
type DetectionResult = {
  generation: 'old' | 'new' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  verdict: string;
  timingMs: number;
  signals: Record<string, unknown>;
};

// ── Styles ────────────────────────────────────────────────────

const CONFIDENCE_STYLE: Record<string, { bg: string; color: string }> = {
  high:   { bg: '#14532d', color: '#4ade80' },
  medium: { bg: '#78350f', color: '#fbbf24' },
  low:    { bg: '#450a0a', color: '#f87171' },
};

const GENERATION_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  new:     { bg: '#14532d', color: '#4ade80', label: 'NEW' },
  old:     { bg: '#1f2937', color: '#9ca3af', label: 'OLD' },
  unknown: { bg: '#78350f', color: '#fbbf24', label: '?'   },
};

// ── Ruler ─────────────────────────────────────────────────────

function CornerDepthRuler({ avg }: { avg: number }) {
  const RULER_MAX  = 120;
  const THRESHOLD  = 25;
  const clampedAvg = Math.max(0, Math.min(RULER_MAX, avg));
  const pct        = (clampedAvg / RULER_MAX) * 100;
  const threshPct  = (THRESHOLD  / RULER_MAX) * 100;

  return (
    <div style={{ padding: '4px 0 2px' }}>
      <div style={{ position: 'relative', height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'visible' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${threshPct}%`, borderRadius: '99px 0 0 99px',
          background: 'rgba(156,163,175,0.25)',
        }} />
        <div style={{
          position: 'absolute', left: `${threshPct}%`, top: 0, bottom: 0,
          right: 0, borderRadius: '0 99px 99px 0',
          background: 'rgba(74,222,128,0.15)',
        }} />
        <div style={{
          position: 'absolute', left: `${threshPct}%`, top: -4, bottom: -4,
          width: 2, background: 'rgba(255,255,255,0.3)', borderRadius: 1,
          transform: 'translateX(-50%)',
        }} />
        <div style={{
          position: 'absolute', top: '50%', left: `${pct}%`,
          transform: 'translate(-50%, -50%)',
          width: 14, height: 14, borderRadius: '50%',
          background: avg > THRESHOLD ? '#4ade80' : '#9ca3af',
          border: '2px solid rgba(0,0,0,0.5)',
          boxShadow: `0 0 6px ${avg > THRESHOLD ? 'rgba(74,222,128,0.6)' : 'rgba(156,163,175,0.4)'}`,
          zIndex: 2,
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
        <span style={{ color: '#9ca3af' }}>OLD  0px</span>
        <span style={{ color: 'rgba(255,255,255,0.25)' }}>threshold 25px</span>
        <span style={{ color: '#4ade80' }}>120px  NEW</span>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function SignalRow({ label, raw, interpretation }: {
  label: string; raw: string; interpretation: string;
}) {
  return (
    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <td style={{ padding: '8px 12px', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>{label}</td>
      <td style={{ padding: '8px 12px', color: 'var(--text)',  fontSize: 12, fontFamily: 'monospace' }}>{raw}</td>
      <td style={{ padding: '8px 12px', color: 'var(--muted)', fontSize: 12 }}>{interpretation}</td>
    </tr>
  );
}

function ResultPanel({ result }: { result: DetectionResult }) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const [copied,   setCopied]   = useState(false);

  const cs = CONFIDENCE_STYLE[result.confidence]  ?? CONFIDENCE_STYLE['low']!;
  const gs = GENERATION_STYLE[result.generation]  ?? GENERATION_STYLE['unknown']!;
  const s  = result.signals;

  function copy() {
    void navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* VERDICT */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12, padding: 20,
      }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
          Verdict
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{
            minWidth: 56, height: 56, borderRadius: 12, padding: '0 12px',
            background: gs.bg, color: gs.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 700, letterSpacing: '0.04em',
          }}>{gs.label}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
              {result.generation === 'unknown' ? 'Generation unknown' : `${result.generation === 'new' ? 'New' : 'Old'} generation card`}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', borderRadius: 6, padding: '3px 8px',
              background: cs.bg, color: cs.color, width: 'fit-content',
            }}>{result.confidence} confidence</span>
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', background: 'rgba(255,255,255,0.06)', borderRadius: 6, padding: '4px 10px' }}>
            {result.timingMs}ms
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
          {result.verdict}
        </div>
        <CornerDepthRuler avg={Number(s.avgCornerDepth)} />
      </div>

      {/* SIGNALS TABLE */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12, overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 16px 10px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Signals
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Signal</th>
              <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Raw</th>
              <th style={{ padding: '6px 12px', textAlign: 'left', fontSize: 10, color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Interpretation</th>
            </tr>
          </thead>
          <tbody>
            <SignalRow label="Corner depth — top left"     raw={`${s.cornerDepthTopLeft}px`}     interpretation="Diagonal transparent pixels from corner" />
            <SignalRow label="Corner depth — top right"    raw={`${s.cornerDepthTopRight}px`}    interpretation="Diagonal transparent pixels from corner" />
            <SignalRow label="Corner depth — bottom left"  raw={`${s.cornerDepthBottomLeft}px`}  interpretation="Diagonal transparent pixels from corner" />
            <SignalRow label="Corner depth — bottom right" raw={`${s.cornerDepthBottomRight}px`} interpretation="Diagonal transparent pixels from corner" />
            <SignalRow label="Avg corner depth"            raw={`${s.avgCornerDepth.toFixed(1)}px`} interpretation={s.avgCornerDepth > 25 ? 'New card (octagonal)' : 'Old card (rectangular)'} />
            <SignalRow label="Min / Max depth"             raw={`${s.minCornerDepth}px / ${s.maxCornerDepth}px`} interpretation="Spread across 4 corners" />
            <SignalRow label="Corner spread"               raw={`${s.cornerSpread}px`}           interpretation={s.cornerSpread >= 20 ? 'High — real diagonal cuts (new)' : s.cornerSpread < 5 ? 'Very low — uniform padding (old)' : 'Low — likely rectangular (old)'} />
            <SignalRow label="Corner variance (σ)"         raw={`${s.cornerVariance}px`}         interpretation="Std deviation of 4 corner depths" />
            <SignalRow label="Image format"                raw={s.format ?? 'unknown'}           interpretation={s.hasAlphaChannel ? 'PNG — alpha scan valid' : 'JPEG — no alpha, depths unreliable'} />
            <SignalRow label="Dimensions"                  raw={`${s.width}×${s.height}`}        interpretation="—" />
            <SignalRow label="INFO found"    raw={s.infoFound ? 'true' : 'false'} interpretation={s.infoFound ? 'OCR found "INFO" in a bottom quadrant' : 'INFO not found in either bottom quadrant'} />
            <SignalRow label="INFO quadrant" raw={s.infoSide === 'right' ? 'Bottom-right (new)' : s.infoSide === 'left' ? 'Bottom-left (old)' : '—'} interpretation={s.infoSide === 'right' ? 'New card — INFO rotated 90°' : s.infoSide === 'left' ? 'Old card — INFO upright' : 'Not detected'} />
            <SignalRow label="OCR text"      raw={s.ocrText || '—'} interpretation="Raw tesseract output from the quadrant crop" />
          </tbody>
        </table>
      </div>

      {/* RAW JSON */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12, overflow: 'hidden',
      }}>
        <button
          onClick={() => setJsonOpen(v => !v)}
          style={{
            width: '100%', padding: '12px 16px', background: 'transparent', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', color: 'var(--muted)', fontSize: 11,
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }}
        >
          <span>Raw JSON</span>
          <span style={{ fontSize: 14 }}>{jsonOpen ? '▲' : '▼'}</span>
        </button>
        {jsonOpen && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ padding: '0 12px 8px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={copy}
                style={{
                  fontSize: 11, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  color: copied ? '#4ade80' : 'var(--muted)',
                }}
              >{copied ? 'Copied!' : 'Copy'}</button>
            </div>
            <pre style={{
              margin: 0, padding: '0 16px 16px',
              fontSize: 11, lineHeight: 1.6, color: 'var(--muted)',
              overflow: 'auto', maxHeight: 400,
            }}>{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Scan overlay ─────────────────────────────────────────────

function ScanOverlay({ src, result }: { src: string; result: DetectionResult | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.src = src;
    img.onload = () => {
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      if (!result) return;

      const W = canvas.width;
      const H = canvas.height;
      const half = Math.floor(W / 2);
      const s = result.signals;
      const fs = Math.max(11, Math.round(H * 0.028));

      // ── Scan strips ───────────────────────────────────────────
      // Strip 1 — left:  x=0,   y=0, w=25%, h=full
      // Strip 2 — right: x=75%, y=0, w=25%, h=full
      const lx = 0,                    ly = 0, lw = Math.floor(W * 0.25), lh = H;
      const rx = Math.floor(W * 0.75), ry = 0, rw = Math.floor(W * 0.25), rh = H;

      const leftActive  = s.infoSide === 'left';
      const rightActive = s.infoSide === 'right';

      ctx.font = `${fs}px monospace`;
      ctx.textAlign = 'center';

      // Left strip
      ctx.fillStyle = leftActive ? 'rgba(74,222,128,0.25)' : 'rgba(255,255,255,0.06)';
      ctx.fillRect(lx, ly, lw, lh);
      ctx.strokeStyle = leftActive ? '#4ade80' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(lx + 1, ly + 1, lw - 2, lh - 2);
      ctx.setLineDash([]);
      ctx.fillStyle = leftActive ? '#4ade80' : 'rgba(255,255,255,0.35)';
      ctx.fillText('LEFT', lx + lw / 2, ly + lh / 2 + fs / 3);

      // Right strip
      ctx.fillStyle = rightActive ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = rightActive ? '#818cf8' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
      ctx.setLineDash([]);
      ctx.fillStyle = rightActive ? '#818cf8' : 'rgba(255,255,255,0.35)';
      ctx.fillText('RIGHT', rx + rw / 2, ry + rh / 2 + fs / 3);

      // ── INFO result label ──────────────────────────────────
      if (s.infoFound) {
        const isLeft    = s.infoSide === 'left';
        const labelColor = isLeft ? '#4ade80' : '#818cf8';
        const labelX     = isLeft ? half / 2 : half + (W - half) / 2;
        ctx.font = `bold ${fs + 2}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = labelColor;
        ctx.fillText(`INFO ✓`, labelX, H - 36);
        ctx.font = `${Math.max(10, fs - 2)}px monospace`;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(`"${s.ocrText}"`, labelX, H - 16);
      } else {
        ctx.font = `bold ${fs}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(248,113,113,0.8)';
        ctx.fillText('INFO not found in either quadrant', W / 2, H - 20);
      }

      // ── Divider ────────────────────────────────────────────
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(half, 0);
      ctx.lineTo(half, H);
      ctx.stroke();
      ctx.setLineDash([]);

      // ── Corner depth markers ───────────────────────────────
      const corners = [
        { x: 0, y: 0, dx:  s.cornerDepthTopLeft,      label: `TL:${s.cornerDepthTopLeft}` },
        { x: W, y: 0, dx: -s.cornerDepthTopRight,      label: `TR:${s.cornerDepthTopRight}` },
        { x: 0, y: H, dx:  s.cornerDepthBottomLeft,    label: `BL:${s.cornerDepthBottomLeft}` },
        { x: W, y: H, dx: -s.cornerDepthBottomRight,   label: `BR:${s.cornerDepthBottomRight}` },
      ];
      corners.forEach(({ x, y, dx, label }) => {
        const depth = Math.abs(dx);
        const col = depth > 25 ? '#4ade80' : '#9ca3af';
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x + dx, y + (y === 0 ? depth : -depth), 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `bold ${Math.max(10, Math.round(H * 0.022))}px monospace`;
        ctx.fillStyle = col;
        ctx.textAlign = x === 0 ? 'left' : 'right';
        const lx = x === 0 ? x + depth + 8 : x - depth - 8;
        const ly = y === 0 ? depth + 24 : y - depth - 8;
        ctx.fillText(label, lx, ly);
      });
    };
  }, [src, result]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        display: 'block',
        borderRadius: 10,
        imageRendering: 'auto',
      }}
      title={imgSize ? `${imgSize.w}×${imgSize.h}` : ''}
    />
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function CardDetectorPage() {
  const [preview,  setPreview]  = useState<string | null>(null);
  const [file,     setFile]     = useState<File | null>(null);
  const [result,   setResult]   = useState<DetectionResult | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setResult(null);
    setError(null);
    setPreview(URL.createObjectURL(f));
  }, []);

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  async function detect() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res  = await fetch('/api/detect-card', { method: 'POST', body: fd });
      const json = await res.json() as DetectionResult & { error?: string; detail?: string };
      if (!res.ok) {
        setError(json.detail ? `${json.error}: ${json.detail}` : (json.error ?? 'Unknown error'));
      } else {
        setResult(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Card Detector</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          Upload a card image to detect its generation via diagonal corner depth scan.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>

        {/* LEFT — Upload panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            style={{
              border: `2px dashed ${dragging ? 'var(--blue)' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 12, minHeight: 200, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 10,
              cursor: 'pointer', transition: 'border-color 0.15s',
              background: dragging ? 'rgba(59,130,246,0.05)' : 'rgba(255,255,255,0.02)',
              overflow: 'hidden', padding: preview ? 0 : 24,
            }}
          >
            {preview ? (
              <ScanOverlay src={preview} result={result} />
            ) : (
              <>
                <div style={{ fontSize: 32 }}>🖼️</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>Drag & drop or click to browse</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>JPG · PNG · WEBP — max 10MB</div>
              </>
            )}
          </div>

          <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.webp" style={{ display: 'none' }} onChange={onInputChange} />

          {file && (
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </div>
          )}

          <button
            onClick={() => void detect()}
            disabled={!file || loading}
            style={{
              padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 500,
              cursor: file && !loading ? 'pointer' : 'not-allowed',
              background: file && !loading ? 'var(--blue)' : 'rgba(255,255,255,0.06)',
              color: file && !loading ? '#fff' : 'var(--muted)',
              border: 'none', transition: 'all 0.15s',
            }}
          >
            {loading ? 'Detecting…' : 'Detect'}
          </button>

          {error && (
            <div style={{
              fontSize: 12, color: '#f87171', background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: '10px 14px',
            }}>{error}</div>
          )}
        </div>

        {/* RIGHT — Result panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {result ? (
            <>
              <ResultPanel result={result} />
              <button
                onClick={() => { setResult(null); setPreview(null); setFile(null); setError(null); }}
                style={{
                  padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  cursor: 'pointer', border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(255,255,255,0.04)', color: 'var(--muted)',
                  transition: 'all 0.15s', width: '100%',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
              >
                Test another card
              </button>
            </>
          ) : (
            <div style={{
              minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12,
              color: 'var(--muted)', fontSize: 13,
            }}>
              Results will appear here
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
