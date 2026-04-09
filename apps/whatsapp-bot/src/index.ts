// ============================================================
// Mariabelle WhatsApp Bot
// receive → classify → parse → log + card_events
// ============================================================
import { patchConsole } from './console-colors.js';
patchConsole(); // coloured terminal output — must be first

import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  DisconnectReason,
  downloadMediaMessage,
  type WASocket,
  type WAMessage,
  type proto,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { existsSync, readdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

import { TypingSimulator, createHumaniser } from '@mariabelle/humaniser';
import { createRegistry, registerTensuraTemplates } from '@mariabelle/parser';
import {
  createClassifier,
  isGroupJid,
  formatDisplay,
  normalizeJid,
  getNumber,
} from '@mariabelle/identifier';
import { createImager } from '@mariabelle/imager';
import { db }                from './db.js';
import { initClaimer, setSendRecorder } from './claimer.js';
import { createCleaner }     from './cleaner.js';
import { createActivityLog } from '@mariabelle/activity-log';
import { detectCard }        from '@mariabelle/card-detector';

const __dirname  = fileURLToPath(new URL('.', import.meta.url));
const AUTH_DIR   = resolve(__dirname, '../auth');
const pinoLogger = pino({ level: 'silent' });

const registry = createRegistry();
registerTensuraTemplates(registry);

const imager = createImager(db);

// ── Group name cache ─────────────────────────────────────────
const groupNameCache = new Map<string, { name: string; fetchedAt: number }>();
const GROUP_CACHE_TTL = 30 * 60 * 1_000;

async function upsertGroupName(sock: WASocket, groupJid: string): Promise<void> {
  const cached = groupNameCache.get(groupJid);
  if (cached && Date.now() - cached.fetchedAt < GROUP_CACHE_TTL) return;
  try {
    const meta = await sock.groupMetadata(groupJid);
    const name = meta.subject ?? null;
    groupNameCache.set(groupJid, { name: name ?? groupJid, fetchedAt: Date.now() });
    await db.from('groups').upsert(
      { group_id: groupJid, name, updated_at: new Date().toISOString() },
      { onConflict: 'group_id' },
    );
  } catch {
    // Non-fatal
  }
}

// ── Env validation ───────────────────────────────────────────
function validateEnv(): void {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SELF_NUMBER'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[BOOT] Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// ── Session helpers ──────────────────────────────────────────
function sessionExists(): boolean {
  return existsSync(AUTH_DIR) && readdirSync(AUTH_DIR).length > 0;
}

function clearSession(): void {
  if (existsSync(AUTH_DIR)) {
    rmSync(AUTH_DIR, { recursive: true, force: true });
    console.log('[SESSION] Cleared');
  }
}

// ── Reconnect state ──────────────────────────────────────────
const MAX_RECONNECT = 10;
let reconnectCount  = 0;
let isShuttingDown  = false;

// ── Message deduplication ────────────────────────────────────
const processedMessageIds = new Set<string>();

// ── LID → phone JID mapping (persisted in memory, grows as messages arrive) ──
// Populated from key.participantAlt / key.remoteJidAlt (most reliable source).
// Fallback: signalRepository.lidMapping.getPNForLID (only works after history sync).
const lidMap = new Map<string, string>(); // lid@lid → number@s.whatsapp.net

// ── Registered bot names (hardcoded safety net) ──────────────
const BOT_NAMES = new Set([
  'Alya','Aqua','Asuna','Elaina','Frieren','Kurumi','Mai','Marin',
  'Megumin','Mita','Miyabi','Modeus','Nazuna','Rem','Rimuru','Rin','Yuki',
]);

// ── Claim guards ─────────────────────────────────────────────
const claimInFlight      = new Set<string>(); // groupJid → claim currently being typed (blocks new spawns only until fired)
const awaitingConfirm    = new Set<string>(); // groupJid → fired, waiting for CLAIM_SUCCESS/TAKEN (does NOT block new spawns)
const claimCancelled     = new Set<string>(); // groupJid → abort signal for in-flight claim
const attemptedSpawns    = new Set<string>(); // spawnId  → already attempted, survives via DB hydration on reconnect
const pendingClaims      = new Map<string, string>(); // cardName → spawnId (our in-flight claims)
const gsPending          = new Set<string>(); // groupJid → .gs sent, awaiting reply

// Hydrate attemptedSpawns from DB on connect — prevents re-claiming after reconnect.
// Loads any spawn we touched in the last 2 hours (cards expire long before that).
async function hydrateAttemptedSpawns() {
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await db.from('card_events').select('spawn_id').gte('created_at', since);
  for (const row of data ?? []) {
    if (row.spawn_id) attemptedSpawns.add(row.spawn_id as string);
  }
  console.log(`[CONN] Hydrated ${attemptedSpawns.size} attempted spawns from DB`);
}

// ── Claim-mode config cache (reads control_config, 10s TTL) ──────
interface ClaimModeConfig {
  claimMode:    'auto' | 'manual';
  tierEnabled:  Record<string, boolean>; // '1'–'6', 'S' → enabled
}
let claimModeCache:     ClaimModeConfig | null = null;
let claimModeCachedAt = 0;
const CLAIM_MODE_TTL  = 10_000; // 10 seconds

async function getClaimModeConfig(): Promise<ClaimModeConfig> {
  if (claimModeCache && Date.now() - claimModeCachedAt < CLAIM_MODE_TTL) {
    return claimModeCache;
  }
  const fallback: ClaimModeConfig = {
    claimMode:   'auto',
    tierEnabled: { '1':true,'2':true,'3':true,'4':true,'5':true,'6':true,'S':true,'s':true },
  };
  try {
    const { data, error } = await db
      .from('control_config')
      .select('claim_mode,claim_tiers')
      .eq('singleton', 'X')
      .maybeSingle();
    if (error || !data) {
      console.warn('[CLAIM-MODE] Failed to load config — defaulting to auto:', error?.message ?? 'no row');
      claimModeCache = fallback;
    } else {
      const enabledTiers: string[] = Array.isArray(data.claim_tiers) ? data.claim_tiers : ['1','2','3','4','5','6','S'];
      const tierEnabled: Record<string, boolean> = {};
      for (const t of enabledTiers) { tierEnabled[String(t)] = true; tierEnabled[String(t).toLowerCase()] = true; }
      claimModeCache = {
        claimMode: data.claim_mode === 'manual' ? 'manual' : 'auto',
        tierEnabled,
      };
    }
    claimModeCachedAt = Date.now();
  } catch (e) {
    console.warn('[CLAIM-MODE] Exception loading config — defaulting to auto:', (e as Error).message);
    claimModeCache = fallback;
    claimModeCachedAt = Date.now();
  }
  return claimModeCache!;
}

// ── High-tier always-claim (T4/5/6/S bypass humaniser in auto mode) ──
const HIGH_TIERS = new Set(['4', '5', '6', 'S', 's']);

// ── Delay system ─────────────────────────────────────────────────
// Range A (fast)  :  700–1000ms — T4/5/6/S always
// Range B (medium): 1000–1300ms — day + active
// Range C (slow)  : 1500–2000ms — night or inactive
// Pre-typing pause: 200–500ms for all tiers
const DELAY_A: [number, number] = [ 500,  900]; // T4+ typing: 500–900ms
const DELAY_B: [number, number] = [1000, 1300];
const DELAY_C: [number, number] = [1500, 2000];

function pickDelayMs(isHighTier: boolean): number {
  if (isHighTier) {
    return Math.round(DELAY_A[0] + Math.random() * (DELAY_A[1] - DELAY_A[0]));
  }
  const hourUTC  = new Date().getUTCHours();
  const isNight  = hourUTC < 8 || hourUTC >= 22;
  const range = isNight ? DELAY_C : (Math.random() < 0.5 ? DELAY_B : DELAY_C);
  return Math.round(range[0] + Math.random() * (range[1] - range[0]));
}

// ── Activity log + humaniser ──────────────────────────────────
const activityLog = createActivityLog(db);
const humaniser   = createHumaniser(db);
let testGcJid: string | null = null; // set by .starttesthere command

// ── Send-latency rolling average ──────────────────────────────
// recordSend() is called after every .claim send.
// A separate 5s interval flushes the rolling avg to control_config.
const sendLatencyBucket: number[] = [];
let latencyFlushTimer: ReturnType<typeof setInterval> | null = null;

function recordSend(ms: number) {
  sendLatencyBucket.push(ms);
}

function startLatencyFlush() {
  if (latencyFlushTimer) clearInterval(latencyFlushTimer);
  latencyFlushTimer = setInterval(() => {
    if (sendLatencyBucket.length === 0) return;
    const avg = Math.round(sendLatencyBucket.reduce((a, b) => a + b, 0) / sendLatencyBucket.length);
    sendLatencyBucket.length = 0;
    void db.from('control_config').upsert(
      { singleton: 'X', last_send_latency_ms: avg },
      { onConflict: 'singleton' },
    ).then(({ error }) => { if (error) console.error('[LATENCY]', error.message); });
  }, 5_000);
}

// ── Connection status helper ───────────────────────────────────
function writeConnectionStatus(status: 'connected' | 'connecting' | 'disconnected') {
  void db.from('control_config').upsert(
    { singleton: 'X', connection_status: status, heartbeat_at: new Date().toISOString() },
    { onConflict: 'singleton' },
  ).then(({ error }) => { if (error) console.error('[CONN-STATUS]', error.message); });
}

// ── Bot heartbeat ─────────────────────────────────────────────
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  const supabaseUrl = process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '';
  const supabaseKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
  // Raw HTTP fetch bypasses JS client connection pool — real round-trip
  const pingUrl = `${supabaseUrl}/rest/v1/bot_heartbeat?singleton=eq.X&select=singleton`;

  const ping = async () => {
    try {
      const t0  = Date.now();
      const res = await fetch(pingUrl, {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
      });
      const ms = Date.now() - t0;
      if (!res.ok) throw new Error(`Ping HTTP ${res.status}`);

      const now = new Date().toISOString();
      // Write ping to bot_heartbeat (for the ping widget)
      await db.from('bot_heartbeat').upsert(
        { singleton: 'X', pinged_at: now, latency_ms: ms, status: 'online' },
        { onConflict: 'singleton' },
      );
      // Write heartbeat timestamp to control_config (for the bot status widget)
      await db.from('control_config').upsert(
        { singleton: 'X', heartbeat_at: now, connection_status: 'connected' },
        { onConflict: 'singleton' },
      );
      console.log(`[HEARTBEAT] ${ms}ms`);
    } catch (e) {
      console.error('[HEARTBEAT]', (e as Error).message);
    }
  };

  void ping();
  heartbeatTimer = setInterval(() => void ping(), 60_000);
  console.log('[HEARTBEAT] Started (60s interval)');
}

// ── WhatsApp connection ──────────────────────────────────────
async function connectToWhatsApp(): Promise<void> {
  const selfNumber = process.env['SELF_NUMBER'] as string;
  const classifier = createClassifier(db, selfNumber);

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[BOOT] Baileys ${version.join('.')} ${isLatest ? '(latest)' : '(update available)'}`);

  const sock: WASocket = makeWASocket({
    version,
    logger: pinoLogger,
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(state.keys, pinoLogger),
    },
    generateHighQualityLinkPreview: false,
    syncFullHistory:                false,
    shouldIgnoreJid:                jid => isJidBroadcast(jid),
  });

  const typingSim = new TypingSimulator({
    startTyping: async (jid) => {
      try { await sock.sendPresenceUpdate('composing', jid); }
      catch (e) { console.error('[PRESENCE] startTyping failed:', (e as Error).message); }
    },
    stopTyping: async (jid) => {
      try { await sock.sendPresenceUpdate('paused', jid); }
      catch (e) { console.error('[PRESENCE] stopTyping failed:', (e as Error).message); }
    },
  }, { loopIntervalMs: 4000 });

  const claimer  = initClaimer(sock, typingSim);
  setSendRecorder(recordSend);
  const cleaner  = createCleaner(db, sock, lidMap);

  // ── LID resolver ─────────────────────────────────────────────
  // Priority: participantAlt/remoteJidAlt (set per-message before calling this)
  // → signalRepository.lidMapping (populated after history sync)
  // → raw LID as last resort
  async function resolveJid(rawJid: string): Promise<string> {
    if (!rawJid.endsWith('@lid')) return rawJid;
    if (lidMap.has(rawJid)) return lidMap.get(rawJid)!;
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID(rawJid);
      if (pn) { lidMap.set(rawJid, pn); return pn; }
    } catch { /* not yet mapped */ }
    return rawJid; // unresolved — stays as LID
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('\n[CONN] Scan QR with Mariabelle\'s WhatsApp → Linked Devices:\n');
      qrcode.generate(qr, { small: true });
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        void db.from('control_config').upsert(
          { singleton: 'X', qr_code: qrDataUrl, connection_status: 'disconnected' },
          { onConflict: 'singleton' },
        ).then(({ error }) => { if (error) console.error('[QR] store failed:', error.message); });
      } catch (err) {
        console.error('[QR] toDataURL failed:', err);
      }
    }
    if (connection === 'open') {
      reconnectCount = 0;
      console.log('[MARIABELLE] Connected');
      void db.from('control_config').upsert(
        { singleton: 'X', qr_code: null, connection_status: 'connected', heartbeat_at: new Date().toISOString() },
        { onConflict: 'singleton' },
      ).then(({ error }) => { if (error) console.error('[CONN-STATUS]', error.message); });
      void humaniser.warmCache().then(() => console.log('[HUMANISER] Cache warmed'));
      void hydrateAttemptedSpawns();
      startHeartbeat();
      startLatencyFlush();
    }
    if (connection === 'connecting') {
      writeConnectionStatus('connecting');
    }
    if (connection === 'close') {
      writeConnectionStatus('disconnected');
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode ?? 0;
      const loggedOut  = statusCode === DisconnectReason.loggedOut;
      console.log(`[CONN] Disconnected — status ${statusCode}`);
      if (loggedOut) {
        clearSession();
        setTimeout(() => { void connectToWhatsApp(); }, 5_000);
      } else if (!isShuttingDown) {
        reconnectCount++;
        if (reconnectCount > MAX_RECONNECT) {
          console.error('[CONN] Max reconnects reached — exiting');
          process.exit(1);
        }
        console.log(`[CONN] Reconnecting (${reconnectCount}/${MAX_RECONNECT})...`);
        setTimeout(() => { void connectToWhatsApp(); }, 5_000);
      }
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const msg of messages) {
      if (!msg.message) continue;
      // Process 'notify' (all incoming) + 'append' only for our own sent messages
      // ('append' is how Baileys echoes sock.sendMessage() back to us)
      const isOwnAppend = type === 'append' && msg.key.fromMe === true;
      if (type !== 'notify' && !isOwnAppend) continue;
      handleMessage(msg, sock, classifier, claimer, cleaner, typingSim, selfNumber, resolveJid).catch(err => {
        console.error('[MSG] Error:', (err as Error).message);
      });
    }
  });
}

// ── Message handler ──────────────────────────────────────────
async function handleMessage(
  msg:         proto.IWebMessageInfo,
  sock:        WASocket,
  classifier:  ReturnType<typeof createClassifier>,
  claimer:     ReturnType<typeof initClaimer>,
  cleaner:     ReturnType<typeof createCleaner>,
  typingSim:   TypingSimulator,
  selfNumber:  string,
  resolveJid:  (jid: string) => Promise<string>,
): Promise<void> {

  if (!msg.key) return;
  const messageId = msg.key.id ?? null;

  if (messageId) {
    if (processedMessageIds.has(messageId)) return;
    processedMessageIds.add(messageId);
  }

  const quotedMessageId =
    msg.message?.extendedTextMessage?.contextInfo?.stanzaId
    ?? msg.message?.imageMessage?.contextInfo?.stanzaId
    ?? null;

  const rawText =
    msg.message?.conversation
    ?? msg.message?.extendedTextMessage?.text
    ?? msg.message?.imageMessage?.caption
    ?? null;

  const hasImage  = !!msg.message?.imageMessage;
  const remoteJid = msg.key.remoteJid ?? '';
  const fromMe    = msg.key.fromMe === true;

  // Populate lidMap from the most reliable source before resolving
  const altParticipant = (msg.key as Record<string, unknown>)['participantAlt'] as string | undefined;
  const altRemote      = (msg.key as Record<string, unknown>)['remoteJidAlt']   as string | undefined;
  const rawSender = fromMe
    ? (selfNumber + '@s.whatsapp.net')
    : (msg.key.participant ?? remoteJid);

  if (altParticipant && rawSender.endsWith('@lid')) lidMap.set(rawSender, altParticipant);
  if (altRemote      && remoteJid.endsWith('@lid'))  lidMap.set(remoteJid, altRemote);

  const senderJid = fromMe
    ? (selfNumber + '@s.whatsapp.net')
    : await resolveJid(rawSender);
  const groupJid  = isGroupJid(remoteJid) ? remoteJid : null;
  const rawLid    = rawSender.endsWith('@lid') ? rawSender : null;


  // Test GC image detection — handle before rawText guard
  if (hasImage && groupJid && groupJid === testGcJid) {
    void (async () => {
      try {
        const buffer = await downloadMediaMessage(msg as WAMessage, 'buffer', {});
        const result = await detectCard(buffer as Buffer);
        const gen  = result.generation === 'new' ? '🆕 NEW' : result.generation === 'old' ? '🕰️ OLD' : '❓ UNKNOWN';
        const conf = result.confidence === 'high' ? '🟢' : result.confidence === 'medium' ? '🟡' : '🔴';
        const s    = result.signals;
        await sock.sendMessage(groupJid, {
          text:
            `${gen} ${conf} ${result.confidence}\n` +
            `Spread: ${s.cornerSpread}px | Variance: ${s.cornerVariance}px\n` +
            `TL:${s.cornerDepthTopLeft} TR:${s.cornerDepthTopRight} BL:${s.cornerDepthBottomLeft} BR:${s.cornerDepthBottomRight}\n` +
            `INFO: ${s.infoSide} (${s.ocrText || 'no text'})\n` +
            `${result.timingMs}ms`,
        });
      } catch (e) {
        await sock.sendMessage(groupJid, { text: `❌ Detection failed: ${(e as Error).message}` });
      }
    })();
    if (!rawText) return; // image-only, nothing else to process
  }

  if (!rawText) return;

  if (groupJid) void upsertGroupName(sock, groupJid);

  if (senderJid && msg.pushName) {
    void db.from('players').upsert(
      {
        jid:        normalizeJid(senderJid),
        number:     getNumber(senderJid),
        moniker:    msg.pushName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'jid' },
    );
  }

  // ── People tracking — passive, every message ─────────────
  if (senderJid && !fromMe) {
    void (async () => {
      const normJid = normalizeJid(senderJid);
      const { data: existing } = await db.from('people').select('gcs').eq('jid', normJid).maybeSingle();
      const currentGcs: string[] = (existing?.gcs as string[] | null) ?? [];
      const updatedGcs = groupJid && !currentGcs.includes(groupJid)
        ? [...currentGcs, groupJid]
        : currentGcs;
      await db.from('people').upsert({
        jid:          normJid,
        number:       getNumber(senderJid),
        display_name: msg.pushName ?? null,
        gcs:          updatedGcs,
        last_seen:    new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      }, { onConflict: 'jid' });
    })();
  }

  // ── Parse first (sync) ───────────────────────────────────
  const trace = registry.trace(rawText);


  // ── GROUP_STATS detection ─────────────────────────────────
  // Triggered by .gs reply (full stats) or .anticamp on/off bot confirmation
  if (groupJid) {
    const anticampToggle = rawText.match(/Anti-Camping has been turned \*(on|off)\*/i);
    if (anticampToggle) {
      const isOn = anticampToggle[1]!.toLowerCase() === 'on';
      gsPending.delete(groupJid);
      const { error } = await db.from('groups').update({
        anticamping:   isOn,
        gs_scanned_at: new Date().toISOString(),
        gs_timeout:    false,
      }).eq('group_id', groupJid);
      if (error) console.error('[GS-TOGGLE] update failed:', error.message);
      else console.log(`[GS-TOGGLE] ${groupJid} anticamping → ${isOn}`);
      return;
    }

    if (trace.normalized.includes('Anti-Camping:')) {
      const norm = trace.normalized;
      const extract = (key: string): string | null =>
        norm.match(new RegExp(`${key}:\\s*(\\S+)`))?.[1] ?? null;

      const anticamping   = extract('Anti-Camping');
      const antibot       = extract('Anti-Bot');
      const cards         = extract('Cards');
      const canSpawn      = extract('Can Spawn');
      const participantsS = extract('Participants');

      gsPending.delete(groupJid);
      const update = {
        anticamping:   anticamping === 'on',
        antibot:       antibot === 'on',
        cards_enabled: cards === 'on',
        can_spawn:     canSpawn?.toLowerCase() === 'yes',
        participants:  participantsS ? parseInt(participantsS, 10) : null,
        gs_scanned_at: new Date().toISOString(),
        gs_timeout:    false,
      };

      const { error: gsErr } = await db.from('groups').update(update).eq('group_id', groupJid);
      if (gsErr) console.error('[GS] update failed:', gsErr.message);
      else console.log(`[GS] ${groupJid} → anticamping=${update.anticamping} canSpawn=${update.can_spawn} cards=${update.cards_enabled}`);
      return;
    }
  }

  // ── MY_SERIES ─────────────────────────────────────────────
  if (trace.result?.templateId === 'MY_SERIES') {
    const series = (trace.result.fields as { series: { name: string; count: number }[] }).series;

    // The Tensura bot REPLIES to whoever ran .myseries.
    // contextInfo.participant is the JID of the sender of the quoted/replied-to message.
    // That person IS the owner of the series list — use it directly, no DB lookup needed.
    const ctx            = msg.message?.extendedTextMessage?.contextInfo;
    const quotedSenderJid = ctx?.participant ?? ctx?.remoteJid ?? null;

    if (!quotedSenderJid) {
      console.warn('[SERIES] MY_SERIES: contextInfo.participant missing — cannot determine owner, skipping');
      return;
    }

    const realOwnerJid = normalizeJid(quotedSenderJid);
    console.log(`[SERIES] MY_SERIES owner resolved → ${realOwnerJid} (${series.length} series)`);

    void (async () => {
      for (const s of series) {
        await db.from('player_series').upsert({
          jid:        realOwnerJid,
          series:     s.name,
          card_count: s.count,
          gc_id:      groupJid,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'jid,series' });
      }
      console.log(`[SERIES] Saved ${series.length} series for ${realOwnerJid}`);
    })();
  }

  // ── SERIES_LEADERBOARD ────────────────────────────────────
  if (trace.result?.templateId === 'SERIES_LEADERBOARD') {
    const { series, leaders } = trace.result.fields as {
      series:  string;
      leaders: { rank: number; name: string; count: number }[];
    };
    void (async () => {
      for (const leader of leaders) {
        await db.from('series_leaders').upsert({
          series:      series,
          rank:        leader.rank,
          player_name: leader.name,
          card_count:  leader.count,
          gc_id:       groupJid,
          seen_at:     new Date().toISOString(),
        }, { onConflict: 'series,rank,gc_id' });
      }
      console.log(`[SERIES] Updated leaderboard for ${series} (${leaders.length} entries)`);
    })();
  }

  // ── CARD_COLLECTION ───────────────────────────────────────
  if (trace.result?.templateId === 'CARD_COLLECTION') {
    const { cards } = trace.result.fields as { cards: { name: string; tier: number }[] };

    const ctx             = msg.message?.extendedTextMessage?.contextInfo;
    const quotedSenderJid = ctx?.participant ?? ctx?.remoteJid ?? null;

    if (!quotedSenderJid) {
      console.warn('[COL] CARD_COLLECTION: contextInfo.participant missing — cannot determine owner, skipping');
      return;
    }

    const ownerJid = normalizeJid(quotedSenderJid);
    console.log(`[COL] CARD_COLLECTION owner → ${ownerJid} (${cards.length} cards)`);

    void (async () => {
      // 1. Delete ALL existing cards for this jid across all groups
      const { error: delErr } = await db.from('player_cards').delete().eq('jid', ownerJid);
      if (delErr) console.error('[COL] delete error:', delErr.message);

      // 2. Batch-look up card_ids by name+tier — fetch all matching names then filter by tier in code
      //    so T4 "Momo" and T6 "Momo" resolve to different card_ids.
      const cardNames = cards.map(c => c.name);
      const { data: dbMatches, error: lookupErr } = await db
        .from('card_db')
        .select('card_id,name,tier')
        .in('name', cardNames);
      if (lookupErr) console.error('[COL] card_db lookup error:', lookupErr.message);

      // Key: "name|tier" — tier in card_db is stored as string ('1','2',...,'S')
      const cardIdMap = new Map<string, string>();
      for (const r of (dbMatches ?? []) as { card_id: string; name: string; tier: string | null }[]) {
        cardIdMap.set(`${r.name}|${r.tier ?? ''}`, r.card_id);
      }

      // 3. Insert the new collection
      const rows = cards.map(card => ({
        jid:        ownerJid,
        card_id:    cardIdMap.get(`${card.name}|${card.tier}`) ?? cardIdMap.get(`${card.name}|${String(card.tier)}`) ?? null,
        card_name:  card.name,
        tier:       card.tier,
        gc_id:      groupJid ?? null,
        updated_at: new Date().toISOString(),
      }));

      const { error: insErr } = await db.from('player_cards').insert(rows);
      if (insErr) {
        console.error('[COL] insert error:', insErr.message);
      } else {
        console.log(`[COL] Saved ${rows.length} cards for ${ownerJid} (${cardIdMap.size}/${cards.length} matched in card_db)`);
      }
    })();
  }

  // ── CARD_SPAWN fast path ──────────────────────────────────
  if (trace.result?.templateId === 'CARD_SPAWN') {
    if (!groupJid) {
      console.log(`[CARD] CARD_SPAWN in DM from ${senderJid} — ignored`);
      return;
    }

    // ── Gate 1: sender must be a known bot OR message is from test GC ──
    // Check this FIRST — before logging, ntfy, or anything else.
    // Real GCs: sender must be in known_bots.
    // Test GC:  only fromMe (self) messages are trusted as fake spawns.
    const isTestGc = groupJid === testGcJid;
    if (!isTestGc) {
      const jidsToCheck = [normalizeJid(senderJid)];
      if (rawLid) jidsToCheck.push(rawLid);
      const { data: botRow } = await db
        .from('known_bots')
        .select('jid')
        .in('jid', jidsToCheck)
        .maybeSingle();
      if (!botRow) {
        console.log(`[CARD] IGNORED — sender "${msg.pushName ?? senderJid}" not in known_bots (jid=${normalizeJid(senderJid)}, lid=${rawLid ?? 'none'})`);
        // Auto-register if name matches known bot list for next time
        if (BOT_NAMES.has(msg.pushName?.trim() ?? '')) {
          void db.from('known_bots').upsert(
            { jid: normalizeJid(senderJid), lid: rawLid, number: getNumber(senderJid), moniker: msg.pushName ?? null, status: 'unverified' },
            { onConflict: 'jid' },
          );
          console.log(`[BOT AUTO-REG] "${msg.pushName}" registered as unverified`);
        }
        return; // ← hard stop — no ntfy, no DB, nothing
      }
    } else if (!fromMe) {
      // Test GC: only self (fromMe) can trigger fake spawns — ignore everyone else
      console.log(`[CARD] IGNORED — test GC spawn not from self (${msg.pushName ?? senderJid})`);
      return;
    }

    const f = trace.result.fields as {
      cardName: string;
      tier:     string | number;
      price:    number;
      spawnId:  string;
      issue:    number;
    };
    const targetGroup = groupJid;

    console.log(`[SPAWN] Received spawn: ${f.spawnId} — messageId: ${messageId ?? 'null'}`);

    // Layer 1: fast in-memory check (survives within a session)
    if (attemptedSpawns.has(f.spawnId)) {
      console.log(`[CARD] ${f.spawnId} already in memory — duplicate delivery ignored`);
      return;
    }

    // Layer 2: DB check — survives restarts/reconnects
    const { data: existingRow } = await db
      .from('card_events')
      .select('id, claimed')
      .eq('spawn_id', f.spawnId)
      .maybeSingle();
    if (existingRow) {
      console.log(`[CARD] ${f.spawnId} already in DB (claimed=${String(existingRow.claimed)}) — skipping`);
      attemptedSpawns.add(f.spawnId); // sync back to memory
      return;
    }

    // Per-group dedup — only one claim in flight per group
    if (claimInFlight.has(targetGroup)) {
      console.log(`[CARD] ${f.spawnId} skipped — claim already in-flight for this group`);
      return;
    }
    claimInFlight.add(targetGroup);
    const spawnDetectedAt = Date.now(); // exact moment spawn message arrived

    // ── Decision ──────────────────────────────────────────────
    const tier = String(f.tier);
    const [modeConfig, activityScore] = await Promise.all([
      getClaimModeConfig(),
      activityLog.getScore(targetGroup).then(r => r.score),
    ]);

    const tierKey    = tier.toUpperCase() === 'S' ? 'S' : tier; // normalise
    const isHighTier = HIGH_TIERS.has(tier);
    const delayMs    = pickDelayMs(isHighTier);

    let decision: { shouldClaim: boolean; delayMs: number; reason: string; claimChance: number; configUsed: string };

    if (modeConfig.claimMode === 'auto') {
      // Auto: claim every spawn regardless of humaniser or tier filters
      decision = { shouldClaim: true, delayMs, reason: 'auto mode — always claim', claimChance: 100, configUsed: 'auto' };
    } else {
      // Manual: check tier enabled first, then run humaniser
      const tierAllowed = modeConfig.tierEnabled[tierKey] ?? modeConfig.tierEnabled[tier] ?? false;
      if (!tierAllowed) {
        decision = { shouldClaim: false, delayMs, reason: `manual mode — T${tier} disabled`, claimChance: 0, configUsed: 'manual-tier-filter' };
      } else if (isHighTier) {
        decision = { shouldClaim: true, delayMs, reason: `manual mode — T${tier} always claim`, claimChance: 100, configUsed: 'high-tier' };
      } else {
        const h = await humaniser.decide({ tier, design: 'unknown', issue: f.issue, activityScore });
        decision = { ...h, delayMs };
      }
    }

    console.log(`[CARD] ${f.cardName} (${f.spawnId}) T${tier} #${f.issue} — ${decision.shouldClaim ? 'CLAIMING' : 'SKIPPING'} | delay=${(delayMs/1000).toFixed(2)}s | ${decision.reason}`);

    // ── ntfy — only when we are actually claiming ────────────
    const ntfyTopic = process.env['NTFY_TOPIC'];
    if (ntfyTopic && decision.shouldClaim) {
      fetch(`https://ntfy.sh/${ntfyTopic}`, {
        method: 'POST',
        headers: {
          'Title':        `Claiming T${tier} - Issue #${f.issue}`,
          'Priority':     isHighTier ? 'urgent' : 'high',
          'Tags':         isHighTier ? 'rotating_light' : 'bell',
          'Content-Type': 'text/plain',
        },
        body: `Card: ${f.cardName}\nSpawn: ${f.spawnId}\nGroup: ${targetGroup}\nReason: ${decision.reason}`,
      }).then(async (res) => {
        const responseText = await res.text();
        if (!res.ok) {
          console.error(`[NTFY] Failed — status ${res.status}: ${responseText}`);
        } else {
          console.log(`[NTFY] Sent — status ${res.status} | ${responseText.slice(0, 80)}`);
        }
      }).catch((e: Error) => console.error('[NTFY] Failed:', e.message));
    }

    // ── Claim flow: pause → type → fire → retry ─────────────────
    // Bot/sender already verified in Gate 1 above — proceed directly.
    void (async () => {
      // 1. If skipping — do nothing, no typing flash, no tell
      if (!decision.shouldClaim) {
        claimInFlight.delete(targetGroup);
        return;
      }

      // 2. Pre-typing pause — 200–500ms for all tiers
      const prePause = 200 + Math.random() * 300;
      await new Promise<void>(r => setTimeout(r, prePause));

      // 4. Typing starts — stays on until we fire
      typingSim.startLoop(targetGroup);
      const typingStartedAt = Date.now();

      // 5. Wait remainder of humaniser delay (subtract time already elapsed)
      const elapsed  = Date.now() - typingStartedAt;
      const remainMs = Math.max(300, decision.delayMs - elapsed);
      await new Promise<void>(r => setTimeout(r, remainMs));

      // 6. Check if someone else claimed while we were waiting
      if (claimCancelled.has(targetGroup)) {
        claimCancelled.delete(targetGroup);
        typingSim.stopLoop(targetGroup);
        claimInFlight.delete(targetGroup);
        console.log(`[CLAIMER] ${f.spawnId} cancelled — already taken`);
        return;
      }

      // 7. Mark spawnId attempted in memory AND DB before sending — if bot
      //    restarts between here and sendMessage, the next delivery sees the
      //    DB row (layer 2 check above) and skips. No duplicate sends ever.
      attemptedSpawns.add(f.spawnId);
      await db.from('card_events').upsert({
        group_id:  targetGroup,
        spawn_id:  f.spawnId,
        card_name: f.cardName,
        tier:      String(f.tier),
        price:     f.price,
        issue:     f.issue,
        claimed:   false,
        decision_should_claim: decision.shouldClaim,
        decision_reason:       decision.reason,
      }, { onConflict: 'spawn_id' });

      // 8. Fire — message first, stop typing after (no gap)
      pendingClaims.set(f.cardName, f.spawnId);
      const spawnToClaimMs = Date.now() - spawnDetectedAt;
      await sock.sendMessage(targetGroup, { text: `.claim ${f.spawnId}` });
      typingSim.stopLoop(targetGroup);
      claimInFlight.delete(targetGroup);
      awaitingConfirm.add(targetGroup);
      console.log(`[CLAIMER] .claim ${f.spawnId} sent | spawn→claim ${spawnToClaimMs}ms`);
      void db.from('card_events').update({ spawn_to_claim_ms: spawnToClaimMs }).eq('spawn_id', f.spawnId);

      // 9. NO RETRY — sending .claim twice risks cooldown/flag from Tensura.
      //    CLAIM_SUCCESS/CLAIM_TAKEN handlers clear awaitingConfirm when reply arrives.
      //    If no reply comes the card was likely already taken; we already have the DB row.
    })();

    void (async () => {
      // Row is already in DB (written before .claim was sent).
      // Download image if present and patch it onto the existing row.
      if (hasImage) {
        try {
          const buffer = await downloadMediaMessage(msg as WAMessage, 'buffer', {});
          const stored = await imager.store({
            spawnId:     f.spawnId,
            groupId:     targetGroup,
            senderJid,
            rawCaption:  rawText ?? '',
            imageBuffer: buffer as Buffer,
            detectedAt:  new Date(),
          });
          if (stored) {
            void db.from('card_events')
              .update({ image_url: stored.publicUrl, image_id: stored.id })
              .eq('spawn_id', f.spawnId);
          }
        } catch (e: unknown) {
          console.error('[IMAGE] Failed:', e instanceof Error ? e.message : String(e));
        }
      }

      void db.from('parse_log').insert({
        group_id:          groupJid,
        sender_jid:        senderJid,
        sender_type:       'bot',
        message_id:        messageId,
        quoted_message_id: quotedMessageId,
        has_image:         hasImage,
        raw_text:          rawText,
        template_id:       'CARD_SPAWN',
        fields_json:       trace.result?.fields ?? null,
        trace_json:        trace,
        line_count:        trace.lines.length,
        auto_flagged:      false,
      });
    })();

    return;
  }

  // ── Classify ─────────────────────────────────────────────
  const classification = await classifier.classify(senderJid);
  const senderType     = classification.senderType;

  // Auto-discovery: BOT_PING
  if (trace.result?.templateId === 'BOT_PING') {
    await db.from('known_bots').upsert(
      { jid: normalizeJid(senderJid), lid: rawLid, number: getNumber(senderJid), moniker: msg.pushName ?? null, status: 'verified' },
      { onConflict: 'jid' },
    );
    classifier.invalidate(senderJid);
    console.log(`[BOT FOUND] ${getNumber(senderJid)} auto-registered via .ping reply`);
  }

  // Auto-discovery: unknown sender matched bot-only template
  const BOT_ONLY_TEMPLATES = new Set(['BOT_PING', 'CARD_SPAWN', 'CLAIM_SUCCESS', 'CLAIM_TAKEN']);
  if (senderType !== 'bot' && senderType !== 'self'
      && trace.result !== null
      && BOT_ONLY_TEMPLATES.has(trace.result.templateId)) {
    await db.from('known_bots').upsert(
      { jid: normalizeJid(senderJid), lid: rawLid, number: getNumber(senderJid), moniker: msg.pushName ?? null, status: 'unverified' },
      { onConflict: 'jid' },
    );
    classifier.invalidate(senderJid);
    console.log(`[AUTO-DISCOVERED] ${getNumber(senderJid)} matched ${trace.result.templateId}`);
  }

  // ── parse_log ────────────────────────────────────────────
  let parseLogId: string | null = null;
  const parseLogResult = await db.from('parse_log').insert({
    group_id:          groupJid,
    sender_jid:        senderJid,
    sender_type:       senderType,
    message_id:        messageId,
    quoted_message_id: quotedMessageId,
    has_image:         hasImage,
    raw_text:          rawText,
    template_id:       trace.result?.templateId ?? null,
    fields_json:       trace.result?.fields     ?? null,
    trace_json:        trace,
    line_count:        trace.lines.length,
    auto_flagged:      senderType !== 'bot' && senderType !== 'self' && trace.result !== null,
  }).select('id').single();

  if (parseLogResult.error) console.error('[DB] parse_log insert failed:', parseLogResult.error.message);
  parseLogId = parseLogResult.data?.id ?? null;

  const label = trace.result
    ? `[PARSED] ${trace.result.templateId}`
    : `[NULL] ${trace.lines.length} line(s), no match`;
  const selfTag     = senderType === 'self' ? ' ★ SELF' : '';
  const displayNum  = formatDisplay(senderJid);
  const displayName = msg.pushName ? `${msg.pushName} (${displayNum})` : displayNum;
  const groupName   = groupJid ? (groupNameCache.get(groupJid)?.name ?? groupJid) : 'DM';
  console.log(`${label} — from ${displayName} in ${groupName}${selfTag}`);

  // ── Test commands ─────────────────────────────────────────
  if (groupJid) {
    const cmd = rawText.trim();

    // .start — register this GC as the activity-log test GC (fires once)
    if (cmd === '.starttesthere' && testGcJid === null) {
      testGcJid = groupJid;
      const name = groupNameCache.get(groupJid)?.name ?? groupJid;
      await activityLog.record({ groupId: groupJid, messageId: messageId ?? null });
      const score = await activityLog.getScore(groupJid);
      await sock.sendMessage(groupJid, { text: `✅ Test GC registered: ${name}\nActivity score: ${score.score} (${score.messageCount}/4 msgs)` });
      return;
    }


    // .score — print current activity score for test GC
    if (cmd === '.score' && groupJid === testGcJid) {
      const score = await activityLog.getScore(groupJid);
      await sock.sendMessage(groupJid, { text: `📊 Activity score: ${score.score}\n${score.messageCount}/4 msgs in last 60min` });
      return;
    }

    // .decide T<tier> <design> <issue> — simulate a full card spawn end-to-end
    // Example: .decide T3 new 1   or   .decide T1 old 5
    if (cmd.startsWith('.decide') && groupJid === testGcJid) {
      const parts  = cmd.split(/\s+/);
      const tier   = (parts[1] ?? 'T1').replace(/^T/i, '');
      const design = (parts[2] ?? 'new') as 'new' | 'old' | 'unknown';
      const issue  = parseInt(parts[3] ?? '1', 10);

      void (async () => {
        const HIGH_TIERS = new Set(['4', '5', '6', 'S', 's']);

        // 1. Human pause (600–800ms)
        const pauseMs = 600 + Math.random() * 200;
        await new Promise<void>(r => setTimeout(r, pauseMs));

        // 2. Typing starts — doesn't stop until we act
        typingSim.startLoop(groupJid);
        const typingStartedAt = Date.now();

        let waitMs: number;
        let summary: string;

        if (HIGH_TIERS.has(tier)) {
          waitMs  = pickDelayMs(true);
          summary = `T${tier} — always claim | delay ${(waitMs / 1000).toFixed(2)}s`;
        } else {
          const score    = await activityLog.getScore(groupJid);
          const decision = await humaniser.decide({ tier, design, issue, activityScore: score.score });
          waitMs  = decision.delayMs;
          summary = `T${tier} ${design} #${issue} | ${decision.shouldClaim ? '✅ CLAIM' : '❌ SKIP'} | ${decision.reason}`;

          if (!decision.shouldClaim) {
            typingSim.stopLoop(groupJid);
            await sock.sendMessage(groupJid, { text: `❌ SKIP\n${summary}` });
            return;
          }
        }

        // 3. Wait remainder (deduct time already spent deciding)
        const elapsed  = Date.now() - typingStartedAt;
        const remainMs = Math.max(300, waitMs - elapsed);
        await new Promise<void>(r => setTimeout(r, remainMs));

        // 4. Fire (message first, then stop typing — no gap)
        await sock.sendMessage(groupJid, { text: `✅ FIRED\n${summary}\nTotal: ${Math.round((Date.now() - typingStartedAt + pauseMs) / 1000)}s from spawn` });
        typingSim.stopLoop(groupJid);
      })();
      return;
    }

    // .clean — fix LIDs, missing monikers, and unnamed groups in the DB
    if (cmd === '.clean' && groupJid === testGcJid) {
      void (async () => {
        await sock.sendMessage(groupJid, { text: '🧹 Cleaning…' });
        const summary = await cleaner.clean();
        await sock.sendMessage(groupJid, { text: `✅ Done\n${summary}` });
      })();
      return;
    }

    // .gscan — send .gs to every known group, 3min apart, 2min timeout per group
    if (cmd === '.gscan' && groupJid !== testGcJid) {
      await sock.sendMessage(groupJid, { text: `❌ Not the test GC. Run .starttesthere here first (current testGC: ${testGcJid ?? 'none'})` });
      return;
    }
    if (cmd === '.gscan' && groupJid === testGcJid) {
      void (async () => {
        const { data: gcList, error: gErr } = await db.from('groups').select('group_id, name');
        if (gErr || !gcList?.length) {
          await sock.sendMessage(groupJid, { text: `❌ gscan failed: ${gErr?.message ?? 'no groups'}` });
          return;
        }
        await sock.sendMessage(groupJid, { text: `📡 Scanning ${gcList.length} groups (3min/group)…` });

        let completed = 0;
        for (let i = 0; i < gcList.length; i++) {
          const g = gcList[i]!;
          const label = g.name ?? g.group_id;
          console.log(`[GSCAN] ${i + 1}/${gcList.length} — sending .gs to ${label}`);

          try {
            // Brief typing before send (looks natural)
            typingSim.startLoop(g.group_id);
            await new Promise<void>(r => setTimeout(r, 1200 + Math.random() * 800));
            gsPending.add(g.group_id);
            await sock.sendMessage(g.group_id, { text: '.gs' });
            typingSim.stopLoop(g.group_id);
            completed++;
          } catch (e) {
            typingSim.stopLoop(g.group_id);
            gsPending.delete(g.group_id);
            const msg = (e as Error).message;
            console.error(`[GSCAN] failed for ${label}:`, msg);
            // Connection dropped — abort the scan, no point continuing on a dead socket
            if (msg.includes('Connection Closed') || msg.includes('Connection Failure')) {
              console.error('[GSCAN] Connection lost — aborting scan');
              return;
            }
            continue;
          }

          // Wait 2min for reply
          await new Promise<void>(r => setTimeout(r, 2 * 60 * 1000));

          // Check if reply came — if still pending, mark timeout
          if (gsPending.has(g.group_id)) {
            gsPending.delete(g.group_id);
            await db.from('groups').update({
              gs_scanned_at: new Date().toISOString(),
              gs_timeout:    true,
            }).eq('group_id', g.group_id);
            console.log(`[GSCAN] ${label} — timeout (no reply in 2min)`);
          }

          // Wait remaining 1min before next group (3min total interval)
          if (i < gcList.length - 1) {
            await new Promise<void>(r => setTimeout(r, 60 * 1000));
          }
        }

        try {
          await sock.sendMessage(groupJid, { text: `✅ gscan complete — ${completed}/${gcList.length} groups reached` });
        } catch {
          console.log(`[GSCAN] complete — ${completed}/${gcList.length} groups reached (couldn't notify, connection gone)`);
        }
      })().catch(e => console.error('[GSCAN] Unhandled error:', (e as Error).message));
      return;
    }

    if (cmd === '.humtest') {
      const ms = await typingSim.beforeSend(groupJid);
      await sock.sendMessage(groupJid, { text: `⌨️ Typing sim: ${Math.round(ms)}ms` });
      return;
    }
    if (cmd === '.simulatetypehere') { typingSim.startLoop(groupJid); return; }
    if (cmd === '.simulatetypestop')  { typingSim.stopLoop(groupJid);  return; }
  }

  // ── "gimme" — save view-once media to self chat ───────────
  if (senderType === 'self' && rawText?.trim().toLowerCase() === 'gimme') {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;
    if (!quoted) return;

    // Unwrap view-once layers
    const inner =
      quoted.viewOnceMessageV2?.message ??
      quoted.viewOnceMessageV2Extension?.message ??
      (quoted as Record<string, any>)['viewOnceMessage']?.message ??
      quoted;

    const mediaMsg =
      inner.imageMessage ?? inner.videoMessage ?? null;

    if (!mediaMsg) {
      console.log('[GIMME] No media found in quoted message');
      return;
    }

    try {
      // Build a fake msg object so downloadMediaMessage can fetch it
      const fakeMsg = {
        key: { ...msg.key, id: ctx.stanzaId ?? msg.key.id },
        message: inner,
      } as typeof msg;

      const buffer = await downloadMediaMessage(fakeMsg as WAMessage, 'buffer', {});
      const selfJid = `${selfNumber}@s.whatsapp.net`;

      if (inner.imageMessage) {
        await sock.sendMessage(selfJid, {
          image: buffer as Buffer,
          caption: inner.imageMessage.caption ?? '',
        });
      } else if (inner.videoMessage) {
        await sock.sendMessage(selfJid, {
          video: buffer as Buffer,
          caption: inner.videoMessage.caption ?? '',
        });
      }
      console.log('[GIMME] Forwarded view-once to self');
    } catch (e) {
      console.error('[GIMME] Failed:', (e as Error).message);
    }
    return;
  }

  // ── Verbose logging + image detection for test GC ─────────
  if (groupJid && groupJid === testGcJid) {
    const displayNum  = formatDisplay(senderJid);
    const displayName = msg.pushName ? `${msg.pushName} (${displayNum})` : displayNum;
    console.log(`[TEST-GC] ${senderType.toUpperCase()} | ${displayName} | "${rawText?.slice(0, 60)}"`);

  }

  // ── Record activity for every self message in test GC ─────
  if (senderType === 'self' && groupJid && groupJid === testGcJid) {
    await activityLog.record({ groupId: groupJid, messageId: messageId ?? null });
    const score = await activityLog.getScore(groupJid);
    console.log(`[ACTIVITY-TEST] Recorded self message. Score: ${score.score} (${score.messageCount} msgs in last 60min)`);
  }

  // ── CLAIM_SUCCESS ─────────────────────────────────────────
  if (trace.result?.templateId === 'CLAIM_SUCCESS') {
    console.log(`[CLAIM_SUCCESS] quotedMessageId=${quotedMessageId ?? 'null'}`);

    let spawnId:    string | null = null;
    let claimerJid: string | null = null;
    let ourClaim    = false; // true only when success is a reply to OUR .claim message

    if (quotedMessageId) {
      const { data: quotedRow, error: qErr } = await db
        .from('parse_log')
        .select('sender_jid, sender_type, fields_json, raw_text')
        .eq('message_id', quotedMessageId)
        .maybeSingle();
      if (qErr) console.error('[CLAIM_SUCCESS] quotedRow lookup error:', qErr.message);
      if (quotedRow) {
        claimerJid = quotedRow.sender_jid as string;
        const rawQuoted = (quotedRow.raw_text as string | null) ?? '';
        // The quoted message is our .claim if: sender_type='self' AND text starts with .claim
        ourClaim = quotedRow.sender_type === 'self' && /^\.claim\s+/i.test(rawQuoted.trim());
        spawnId  = rawQuoted.match(/\.claim\s+([a-z0-9]+)/i)?.[1]
          ?? (quotedRow.fields_json as { spawnId?: string } | null)?.spawnId
          ?? null;
      }
    }

    // Card is claimed by ANYONE — always cancel our pending retry for this group.
    // There's no point resending .claim if someone already got the card.
    if (groupJid) {
      claimCancelled.add(groupJid);
      awaitingConfirm.delete(groupJid);
    }

    if (!spawnId) {
      // Fallback: match by card name from the success message fields
      const rawCardName = (trace.result.fields as { cardName?: string } | undefined)?.cardName ?? null;
      const cardName    = rawCardName?.replace(/\*/g, '') ?? null;
      if (cardName) {
        if (pendingClaims.has(cardName)) {
          spawnId    = pendingClaims.get(cardName)!;
          claimerJid = selfNumber + '@s.whatsapp.net';
          ourClaim   = true;
          pendingClaims.delete(cardName);
        } else {
          const { data: cardRow } = await db
            .from('card_events')
            .select('spawn_id')
            .eq('card_name', cardName)
            .eq('claimed', false)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          spawnId = cardRow?.spawn_id ?? null;
        }
      }
    }

    if (spawnId) {
      if (ourClaim) claimer.confirm(spawnId);
      const selfJid     = selfNumber + '@s.whatsapp.net';
      const claimSource = ourClaim && claimerJid && normalizeJid(claimerJid) === normalizeJid(selfJid) ? 'bot' : 'other';
      console.log(`[CLAIM_SUCCESS] spawnId=${spawnId} ourClaim=${ourClaim} source=${claimSource}`);
      const { error: updateErr } = await db.from('card_events')
        .update({
          claimed:      true,
          claim_source: claimSource,
          claimed_at:   new Date().toISOString(),
          claimer_jid:  claimerJid,
          claim_log_id: parseLogId,
        })
        .eq('spawn_id', spawnId);
      if (updateErr) console.error('[CLAIM_SUCCESS] update failed:', updateErr.message);
      else {
        console.log(`[CLAIMED] ${spawnId} | source=${claimSource} | by ${claimerJid ? formatDisplay(claimerJid) : 'unknown'}`);
        // Enrich card_events with series metadata from card_db
        const rawCardName = (trace.result.fields as { cardName?: string } | undefined)?.cardName ?? null;
        const claimedCardName = rawCardName?.replace(/\*/g, '') ?? null;
        if (claimedCardName) {
          void (async () => {
            const { data: cardData } = await db
              .from('card_db')
              .select('card_id, series, tier, stars, image_url, description, event')
              .ilike('name', `%${claimedCardName}%`)
              .limit(1)
              .maybeSingle();
            if (cardData) {
              await db.from('card_events').update({
                card_db_id:  cardData.card_id,
                series:      cardData.series,
                description: cardData.description,
                event_pool:  cardData.event,
              }).eq('spawn_id', spawnId);
              console.log(`[ENRICH] ${spawnId} → series=${cardData.series}`);
            }
          })();
        }
      }
    } else {
      console.warn('[CLAIM_SUCCESS] could not resolve spawnId');
    }
  }

  // ── CLAIM_TAKEN ───────────────────────────────────────────
  if (trace.result?.templateId === 'CLAIM_TAKEN' && quotedMessageId) {
    if (groupJid) {
      claimCancelled.add(groupJid); // signal the in-flight claim to abort
      awaitingConfirm.delete(groupJid);
    }
    const { data: quotedRow, error: qErr } = await db
      .from('parse_log')
      .select('fields_json')
      .eq('message_id', quotedMessageId)
      .maybeSingle();
    if (qErr) console.error('[CLAIM_TAKEN] quotedRow lookup error:', qErr.message);
    const spawnId = (quotedRow?.fields_json as { spawnId?: string } | null)?.spawnId ?? null;
    if (spawnId) {
      claimer.confirm(spawnId);
      console.log(`[CLAIM_TAKEN] ${spawnId} taken by someone else`);
    } else {
      console.warn('[CLAIM_TAKEN] could not resolve spawnId');
    }
  }
}

// ── Graceful shutdown ────────────────────────────────────────
process.on('SIGINT',  () => { isShuttingDown = true; console.log('\n[BOOT] Shutting down'); process.exit(0); });
process.on('SIGTERM', () => { isShuttingDown = true; console.log('\n[BOOT] Shutting down'); process.exit(0); });

// ── Boot ─────────────────────────────────────────────────────
async function main(): Promise<void> {
  validateEnv();
  console.log('[BOOT] Starting Mariabelle...');
  if (!sessionExists()) {
    console.log('[BOOT] No session — QR will appear below');
  } else {
    console.log('[BOOT] Session found — connecting...');
  }
  await connectToWhatsApp();
}

main().catch(err => {
  console.error('[BOOT] Fatal:', (err as Error).message);
  process.exit(1);
});
