import Jimp from 'jimp';
import { createWorker } from 'tesseract.js';
import type { Worker } from 'tesseract.js';
import type { DetectionResult } from './types.js';

const MAX_SCAN = 120;

// ── Persistent worker — created once, reused forever ─────────

let workerReady: Promise<Worker> | null = null;

function getWorker(workerPath?: string): Promise<Worker> {
  if (!workerReady) {
    const opts = workerPath ? { workerPath } : {};
    workerReady = createWorker('eng', 1, opts).then(async w => {
      await w.setParameters({
        tessedit_pageseg_mode: '11' as never, // sparse text — finds words anywhere in the image
      });
      return w;
    });
  }
  return workerReady;
}

// ── Corner depth ──────────────────────────────────────────────

function scanDepth(img: Jimp, w: number, h: number, corner: 'TL' | 'TR' | 'BL' | 'BR'): number {
  for (let i = 0; i <= MAX_SCAN; i++) {
    let x: number, y: number;
    if      (corner === 'TL') { x = i;     y = i;     }
    else if (corner === 'TR') { x = w-1-i; y = i;     }
    else if (corner === 'BL') { x = i;     y = h-1-i; }
    else                      { x = w-1-i; y = h-1-i; }
    const rgba = Jimp.intToRGBA(img.getPixelColor(x, y));
    if (rgba.a > 128) return i;
  }
  return MAX_SCAN;
}

// ── OCR a crop region ─────────────────────────────────────────

async function ocrCrop(
  img:        Jimp,
  cx: number, cy: number, cw: number, ch: number,
  rotateDeg:  number,
  workerPath?: string,
): Promise<string> {
  let crop = img.clone().crop(cx, cy, cw, ch);
  if (rotateDeg !== 0) crop = crop.rotate(rotateDeg);
  crop = crop
    .greyscale()
    .contrast(0.5)
    .scale(2);
  const buf  = await crop.getBufferAsync(Jimp.MIME_PNG);
  const w    = await getWorker(workerPath);
  const { data } = await w.recognize(buf);
  return data.text.replace(/\s/g, '').toUpperCase();
}

// ── Main export ───────────────────────────────────────────────

export async function detectCard(buffer: Buffer, workerPath?: string): Promise<DetectionResult> {
  const start = Date.now();
  const img   = await Jimp.read(buffer);
  const W     = img.getWidth();
  const H     = img.getHeight();

  const mime            = img.getMIME();
  const hasAlphaChannel = mime === 'image/png' || mime === 'image/gif';

  // Corner depth
  const cornerDepthTopLeft     = scanDepth(img, W, H, 'TL');
  const cornerDepthTopRight    = scanDepth(img, W, H, 'TR');
  const cornerDepthBottomLeft  = scanDepth(img, W, H, 'BL');
  const cornerDepthBottomRight = scanDepth(img, W, H, 'BR');

  const depths = [cornerDepthTopLeft, cornerDepthTopRight, cornerDepthBottomLeft, cornerDepthBottomRight];
  const avgCornerDepth = depths.reduce((a, b) => a + b) / 4;
  const minCornerDepth = Math.min(...depths);
  const maxCornerDepth = Math.max(...depths);
  const cornerSpread   = maxCornerDepth - minCornerDepth;
  const cornerVariance = Math.sqrt(depths.reduce((s, d) => s + Math.pow(d - avgCornerDepth, 2), 0) / 4);

  const cornerResult: 'new' | 'old' = cornerSpread >= 20 ? 'new' : 'old';

  // Strip 1 — left:  x=0,   y=0, w=25%, h=full
  const leftX = 0;
  const leftY = 0;
  const leftW = Math.floor(W * 0.25);
  const leftH = H;

  // Strip 2 — right: x=75%, y=0, w=25%, h=full
  const rightX = Math.floor(W * 0.75);
  const rightY = 0;
  const rightW = Math.floor(W * 0.25);
  const rightH = H;

  const [leftText, rightText] = await Promise.all([
    ocrCrop(img, leftX,  leftY,  leftW,  leftH,   0, workerPath), // upright
    ocrCrop(img, rightX, rightY, rightW, rightH, -90, workerPath), // rotate CCW so rotated INFO reads upright
  ]);

  const leftOk  = leftText.includes('INFO');
  const rightOk = rightText.includes('INFO');

  let infoFound: boolean;
  let infoSide:  'left' | 'right' | 'unknown';
  let ocrText:   string;

  if (leftOk && !rightOk) {
    infoFound = true; infoSide = 'left';    ocrText = leftText;
  } else if (rightOk && !leftOk) {
    infoFound = true; infoSide = 'right';   ocrText = rightText;
  } else if (leftOk && rightOk) {
    infoFound = true; infoSide = 'unknown'; ocrText = `L:${leftText} R:${rightText}`;
  } else {
    infoFound = false; infoSide = 'unknown'; ocrText = '';
  }

  const infoResult: 'new' | 'old' | 'unknown' =
    infoSide === 'right' ? 'new' :
    infoSide === 'left'  ? 'old' : 'unknown';

  const cornerDetail =
    `Avg corner depth: ${avgCornerDepth.toFixed(1)}px [TL:${cornerDepthTopLeft} TR:${cornerDepthTopRight} ` +
    `BL:${cornerDepthBottomLeft} BR:${cornerDepthBottomRight}] spread:${cornerSpread}px`;

  let generation: DetectionResult['generation'];
  let confidence: DetectionResult['confidence'];
  let verdict:    string;

  if (infoResult === 'unknown') {
    generation = cornerResult;
    confidence = 'medium';
    verdict    = `${cornerDetail} | INFO not found in either strip — corner spread only`;
  } else if (cornerResult === infoResult) {
    generation = cornerResult;
    confidence = cornerSpread >= 20 ? 'high' : 'medium';
    verdict    = `${cornerDetail} | INFO on ${infoSide} — both agree`;
  } else {
    generation = 'unknown';
    confidence = 'low';
    verdict    = `${cornerDetail} | INFO on ${infoSide} — conflict: corner=${cornerResult}, INFO=${infoResult}`;
  }

  return {
    generation,
    confidence,
    signals: {
      cornerDepthTopLeft,
      cornerDepthTopRight,
      cornerDepthBottomLeft,
      cornerDepthBottomRight,
      avgCornerDepth,
      minCornerDepth,
      maxCornerDepth,
      cornerSpread,
      cornerVariance: Math.round(cornerVariance * 10) / 10,
      width:           W,
      height:          H,
      format:          mime,
      hasAlphaChannel,
      infoFound,
      infoXPercent:    infoSide === 'left' ? 12 : infoSide === 'right' ? 87 : 0,
      infoXPx:         infoSide === 'left' ? Math.floor(leftW / 2) : infoSide === 'right' ? rightX + Math.floor(rightW / 2) : 0,
      infoSide,
      ocrConfirmed:    infoFound,
      ocrText,
      scanYFromPercent: 55,
      scanYToPercent:   85,
    },
    timingMs: Date.now() - start,
    verdict,
  };
}
