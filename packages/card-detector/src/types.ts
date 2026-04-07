export interface DetectionResult {
  generation: 'new' | 'old' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  signals: {
    cornerDepthTopLeft:     number;
    cornerDepthTopRight:    number;
    cornerDepthBottomLeft:  number;
    cornerDepthBottomRight: number;
    avgCornerDepth:         number;
    minCornerDepth:         number;
    maxCornerDepth:         number;
    cornerSpread:           number;
    cornerVariance:         number;
    width:                  number;
    height:                 number;
    format:                 string | null;
    hasAlphaChannel:        boolean;
    infoFound:              boolean;
    infoXPercent:           number;
    infoXPx:                number;
    infoSide:               'left' | 'right' | 'unknown';
    ocrConfirmed:           boolean;
    ocrText:                string;
    scanYFromPercent:       number;
    scanYToPercent:         number;
  };
  timingMs: number;
  verdict:  string;
}
