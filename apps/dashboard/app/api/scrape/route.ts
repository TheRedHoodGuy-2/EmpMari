import { createClient } from '@supabase/supabase-js';

// ── Use globalThis so state survives Next.js hot-module reloads ──
declare global {
  // eslint-disable-next-line no-var
  var __scrapeJob: JobState | undefined;
}

export type JobState =
  | { status: 'idle' }
  | { status: 'running';  page: number; total: number; cards: number; startedAt: number; retrying?: boolean; retryIn?: number; attempt?: number }
  | { status: 'done';     imported: number; duration: string; finishedAt: number }
  | { status: 'stopped' }
  | { status: 'error';    message: string };

function getJob(): JobState  { return globalThis.__scrapeJob ?? { status: 'idle' }; }
function setJob(j: JobState) { globalThis.__scrapeJob = j; }

function getDb() {
  const url = process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

const BASE_URL = 'https://rimuruslime.com';
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;
const PAGE_URL = `${BASE_URL}/all-cards/`;
const DELAY_MS = 600;
const BATCH    = 500;

// Backoff: 3s → 6s → 12s → 24s → 60s → 60s → … (cap at 60s)
function backoff(attempt: number) {
  return Math.min(3000 * Math.pow(2, attempt - 1), 60_000);
}

type ScraperCard = {
  id: string; name: string; series: string; tier: string | number;
  stars: number; img: string; description: string; event: string | null;
  wishlistCount: number; owners: string[];
};
type PageData = {
  cards: ScraperCard[]; totalCards: number; totalPages: number;
  hasMore: boolean; limit: number;
};

async function fetchNonce(): Promise<string> {
  const res = await fetch(PAGE_URL, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  if (!res.ok) throw new Error(`Site returned HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/"nonce"\s*:\s*"([^"]+)"/);
  if (!m) throw new Error('Nonce not found — site structure may have changed');
  return m[1]!;
}

async function fetchPage(nonce: string, page: number, limit: number): Promise<PageData> {
  const body = new URLSearchParams({
    action: 'tc_fetch_cards', nonce, search: '', tier: 'all', event: 'all',
    page: String(page), limit: String(limit),
  });
  const res = await fetch(AJAX_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on page ${page}`);
  const json = await res.json() as { success: boolean; data: PageData };
  if (!json.success) throw new Error(`API returned success=false on page ${page}`);
  return json.data;
}

function toRow(scrapedAt: string, c: ScraperCard) {
  return {
    card_id:       c.id,
    name:          c.name,
    series:        c.series ?? null,
    tier:          String(c.tier).toUpperCase(),
    stars:         c.stars ?? null,
    image_url:     c.img ?? null,
    description:   c.description ?? null,
    event:         c.event ?? null,
    wishlist_count: c.wishlistCount ?? 0,
    owner_names:   JSON.stringify(c.owners ?? []),
    scraped_at:    scrapedAt,
    updated_at:    scrapedAt,
  };
}

async function upsertBatch(db: ReturnType<typeof getDb>, rows: ReturnType<typeof toRow>[]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from('card_db').upsert(rows.slice(i, i + BATCH), { onConflict: 'card_id' });
    if (error) throw new Error(`DB upsert failed: ${error.message}`);
  }
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// Retry wrapper — retries indefinitely until success or user stops.
// Updates job state with countdown so the widget can show "retrying in Xs".
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  currentPage: number,
  totalPages: number,
  cards: number,
  startedAt: number,
): Promise<T | null> {
  let attempt = 0;
  while (true) {
    // User stopped — bail out
    if (getJob().status !== 'running') return null;
    try {
      return await fn();
    } catch (e) {
      attempt++;
      const waitMs = backoff(attempt);
      const waitSec = Math.round(waitMs / 1000);
      const msg = `${label}: ${(e as Error).message}`;
      console.warn(`[SCRAPE] ${msg} — retry #${attempt} in ${waitSec}s`);

      // Mark as retrying in the job state
      setJob({
        status: 'running',
        page: currentPage,
        total: totalPages,
        cards,
        startedAt,
        retrying: true,
        retryIn: waitSec,
        attempt,
      });

      // Count down retryIn so widget animates smoothly
      const tick = 1000;
      let remaining = waitMs;
      while (remaining > 0) {
        if (getJob().status !== 'running') return null;
        await sleep(Math.min(tick, remaining));
        remaining -= tick;
        const remSec = Math.max(0, Math.round(remaining / 1000));
        setJob({
          status: 'running',
          page: currentPage,
          total: totalPages,
          cards,
          startedAt,
          retrying: true,
          retryIn: remSec,
          attempt,
        });
      }

      // Clear retrying flag before next attempt
      if (getJob().status === 'running') {
        setJob({ status: 'running', page: currentPage, total: totalPages, cards, startedAt });
      }
    }
  }
}

async function runScrapeJob() {
  const db        = getDb();
  const startedAt = Date.now();
  let imported    = 0;
  let totalPages  = 0;
  let limit       = 8;

  try {
    // ── Fetch nonce (with retry) ──
    const nonce = await withRetry('Fetch nonce', fetchNonce, 0, 0, 0, startedAt);
    if (!nonce) return; // stopped

    // ── Probe page 1 (with retry) ──
    const probe = await withRetry('Probe page 1', () => fetchPage(nonce, 1, 100), 0, 0, 0, startedAt);
    if (!probe) return;

    limit      = probe.limit ?? 8;
    totalPages = probe.totalPages;

    // Upsert page 1 (with retry)
    const scrapedAt1 = new Date().toISOString();
    const rows1 = probe.cards.map(toRow.bind(null, scrapedAt1));
    const dbResult1 = await withRetry('DB upsert page 1', () => upsertBatch(db, rows1), 1, totalPages, 0, startedAt);
    if (dbResult1 === null && getJob().status !== 'running') return;

    imported += probe.cards.length;
    setJob({ status: 'running', page: 1, total: totalPages, cards: imported, startedAt });

    // ── Pages 2..N ──
    for (let p = 2; p <= totalPages; p++) {
      if (getJob().status !== 'running') return;

      const data = await withRetry(`Fetch page ${p}`, () => fetchPage(nonce, p, limit), p, totalPages, imported, startedAt);
      if (!data) return; // stopped

      const scrapedAt = new Date().toISOString();
      const rows = data.cards.map(toRow.bind(null, scrapedAt));

      const dbResult = await withRetry(`DB upsert page ${p}`, () => upsertBatch(db, rows), p, totalPages, imported, startedAt);
      if (dbResult === null && getJob().status !== 'running') return;

      imported += data.cards.length;
      setJob({ status: 'running', page: p, total: totalPages, cards: imported, startedAt });

      if (!data.hasMore) break;
      await sleep(DELAY_MS);
    }

    const ms       = Date.now() - startedAt;
    const duration = ms > 60000
      ? `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
      : `${Math.floor(ms / 1000)}s`;
    setJob({ status: 'done', imported, duration, finishedAt: Date.now() });

  } catch (e) {
    // Only truly unexpected errors reach here (e.g. DB client init failure)
    setJob({ status: 'error', message: (e as Error).message });
  }
}

export async function GET() {
  return Response.json(getJob());
}

export async function POST() {
  if (getJob().status === 'running') {
    return Response.json({ alreadyRunning: true, job: getJob() });
  }
  setJob({ status: 'running', page: 0, total: 0, cards: 0, startedAt: Date.now() });
  void runScrapeJob();
  return Response.json({ started: true, job: getJob() });
}

export async function DELETE() {
  if (getJob().status === 'running') {
    setJob({ status: 'stopped' });
  }
  return Response.json(getJob());
}
