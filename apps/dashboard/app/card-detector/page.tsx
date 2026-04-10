'use client';

import { useRef, useState, useCallback, useEffect } from 'react';

// ── Types ─────────────────────────────────────────────────────

type DetectionResult = {
  generation: 'old' | 'new' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  verdict: string;
  timingMs: number;
  signals: any;
};

// ── Constants ─────────────────────────────────────────────────

const CONFIDENCE_STYLE = {
  high:   { bg: '#14532d', color: '#4ade80' },
  medium: { bg: '#78350f', color: '#fbbf24' },
  low:    { bg: '#450a0a', color: '#f87171' },
} as const;

const GENERATION_STYLE = {
  new:     { bg: '#14532d', color: '#4ade80', label: 'NEW' },
  old:     { bg: '#1f2937', color: '#9ca3af', label: 'OLD' },
  unknown: { bg: '#78350f', color: '#fbbf24', label: '?' },
} as const;

// ── Small Components ──────────────────────────────────────────

const SignalRow = ({ label, raw, interpretation }: any) => (
  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
    <td style={td}>{label}</td>
    <td style={{ ...td, fontFamily: 'monospace', color: 'var(--text)' }}>{raw}</td>
    <td style={td}>{interpretation}</td>
  </tr>
);

const td = {
  padding: '8px 12px',
  fontSize: 12,
  color: 'var(--muted)',
  whiteSpace: 'nowrap',
};

// ── Ruler ────────────────────────────────────────────────────

function CornerDepthRuler({ avg }: { avg: number }) {
  const max = 120;
  const threshold = 25;

  const pct = Math.min(avg, max) / max * 100;
  const threshPct = threshold / max * 100;

  return (
    <div>
      <div style={{ position: 'relative', height: 8, borderRadius: 99, background: '#222' }}>
        <div style={{ position: 'absolute', width: `${threshPct}%`, height: '100%', background: '#444' }} />
        <div style={{ position: 'absolute', left: `${pct}%`, top: -3, width: 12, height: 12, borderRadius: '50%', background: avg > threshold ? '#4ade80' : '#aaa' }} />
      </div>
    </div>
  );
}

// ── Result Panel ──────────────────────────────────────────────

function ResultPanel({ result }: { result: DetectionResult }) {
  const [open, setOpen] = useState(false);

  const cs = CONFIDENCE_STYLE[result.confidence];
  const gs = GENERATION_STYLE[result.generation];
  const s = result.signals;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Verdict */}
      <div style={card}>
        <div style={label}>Verdict</div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ ...badge, background: gs.bg, color: gs.color }}>
            {gs.label}
          </div>

          <div>
            <div>{result.verdict}</div>
            <div style={{ ...pill, background: cs.bg, color: cs.color }}>
              {result.confidence}
            </div>
          </div>
        </div>

        <CornerDepthRuler avg={Number(s.avgCornerDepth)} />
      </div>

      {/* Signals */}
      <div style={card}>
        <div style={label}>Signals</div>
        <table style={{ width: '100%' }}>
          <tbody>
            <SignalRow label="Avg depth" raw={`${s.avgCornerDepth}px`} interpretation={s.avgCornerDepth > 25 ? 'New' : 'Old'} />
            <SignalRow label="Spread" raw={`${s.cornerSpread}px`} interpretation="Corner variance" />
            <SignalRow label="INFO side" raw={s.infoSide ?? '-'} interpretation="OCR result" />
          </tbody>
        </table>
      </div>

      {/* Raw JSON */}
      <div style={card}>
        <button onClick={() => setOpen(v => !v)}>Raw JSON</button>
        {open && (
          <pre style={{ fontSize: 11 }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Canvas Overlay ────────────────────────────────────────────

function ScanOverlay({ src, result }: any) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.src = src;

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;

      ctx.drawImage(img, 0, 0);

      if (!result) return;

      const { width: W, height: H } = canvas;
      const mid = W / 2;

      ctx.strokeStyle = '#fff';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(mid, 0);
      ctx.lineTo(mid, H);
      ctx.stroke();
    };
  }, [src, result]);

  return <canvas ref={ref} style={{ width: '100%' }} />;
}

// ── Main Page ─────────────────────────────────────────────────

export default function CardDetectorPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
  }, []);

  async function detect() {
    if (!file) return;

    setLoading(true);

    const fd = new FormData();
    fd.append('image', file);

    const res = await fetch('/api/detect-card', {
      method: 'POST',
      body: fd,
    });

    const json = await res.json();
    setResult(json);
    setLoading(false);
  }

  return (
    <div style={{ maxWidth: 1000, margin: 'auto', padding: 24 }}>
      <h1>Card Detector</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Upload */}
        <div>
          <div
            onClick={() => inputRef.current?.click()}
            style={{ border: '2px dashed #444', padding: 20, cursor: 'pointer' }}
          >
            {preview ? (
              <ScanOverlay src={preview} result={result} />
            ) : (
              'Click or drop image'
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            hidden
            onChange={e => e.target.files && handleFile(e.target.files[0])}
          />

          <button onClick={detect} disabled={!file || loading}>
            {loading ? 'Detecting…' : 'Detect'}
          </button>
        </div>

        {/* Result */}
        <div>
          {result ? <ResultPanel result={result} /> : 'No result'}
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────

const card = {
  padding: 16,
  border: '1px solid #333',
  borderRadius: 10,
};

const label = {
  fontSize: 12,
  opacity: 0.6,
  marginBottom: 10,
};

const badge = {
  padding: '10px 14px',
  borderRadius: 10,
  fontWeight: 700,
};

const pill = {
  marginTop: 6,
  padding: '2px 8px',
  fontSize: 10,
  borderRadius: 6,
};