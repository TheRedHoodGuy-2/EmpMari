import Jimp from 'jimp';
import type { DetectionResult } from './types.js';

const MAX_SCAN = 120;

function scanDepth(
  img: Jimp,
  w: number,
  h: number,
  corner: 'TL' | 'TR' | 'BL' | 'BR',
): number {
  for (let i = 0; i <= MAX_SCAN; i++) {
    let x: number, y: number;
    if (corner === 'TL') { x = i;       y = i;       }
    else if (corner === 'TR') { x = w - 1 - i; y = i;       }
    else if (corner === 'BL') { x = i;       y = h - 1 - i; }
    else                      { x = w - 1 - i; y = h - 1 - i; }

    const rgba = Jimp.intToRGBA(img.getPixelColor(x, y));
    if (rgba.a > 128) return i;
  }
  return MAX_SCAN;
}

export async function detectCard(buffer: Buffer): Promise<DetectionResult> {
  const start = Date.now();
  const img   = await Jimp.read(buffer);
  const w     = img.getWidth();
  const h     = img.getHeight();

  const mime            = img.getMIME();
  const hasAlphaChannel = mime === 'image/png' || mime === 'image/gif';

  const cornerDepthTopLeft     = scanDepth(img, w, h, 'TL');
  const cornerDepthTopRight    = scanDepth(img, w, h, 'TR');
  const cornerDepthBottomLeft  = scanDepth(img, w, h, 'BL');
  const cornerDepthBottomRight = scanDepth(img, w, h, 'BR');

  const depths = [
    cornerDepthTopLeft,
    cornerDepthTopRight,
    cornerDepthBottomLeft,
    cornerDepthBottomRight,
  ];

  const avgCornerDepth = depths.reduce((a, b) => a + b) / 4;
  const minCornerDepth = Math.min(...depths);
  const maxCornerDepth = Math.max(...depths);
  const cornerSpread   = maxCornerDepth - minCornerDepth;
  const cornerVariance = Math.sqrt(
    depths.reduce((sum, d) => sum + Math.pow(d - avgCornerDepth, 2), 0) / 4
  );

  let generation: DetectionResult['generation'] = 'unknown';
  let confidence: DetectionResult['confidence'] = 'low';

  if (cornerSpread >= 20) {
    generation = 'new';
    confidence = cornerSpread >= 40 ? 'high' : 'medium';
  } else {
    generation = 'old';
    confidence = cornerSpread < 5 ? 'high' : 'medium';
  }

  const avg = avgCornerDepth.toFixed(1);
  const verdict =
    `Avg corner depth: ${avg}px across 4 corners ` +
    `[TL:${cornerDepthTopLeft}px TR:${cornerDepthTopRight}px ` +
    `BL:${cornerDepthBottomLeft}px BR:${cornerDepthBottomRight}px] ` +
    `Corner spread: ${cornerSpread}px (variance signal)`;

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
      width:           w,
      height:          h,
      format:          mime,
      hasAlphaChannel,
    },
    timingMs: Date.now() - start,
    verdict,
  };
}
