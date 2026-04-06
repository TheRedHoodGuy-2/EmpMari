// ============================================================
// Mariabelle WhatsApp Bot
// receive → classify → parse → log + card_events
// ============================================================

import qrcode from 'qrcode-terminal';
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  DisconnectReason,
  downloadMediaMessage,
  type WASocket,
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
import { initClaimer }       from './claimer.js';
import { createActivityLog } from '@mariabelle/activity-log';
import { detectCard }        from '@mariabelle/card-detector';
import Jimp                  from 'jimp';

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

// ── Claim guards ─────────────────────────────────────────────
const claimInFlight   = new Set<string>(); // groupJid → claim in progress
const claimCancelled  = new Set<string>(); // groupJid → abort signal for in-flight claim
const attemptedSpawns = new Set<string>(); // spawnId  → already attempted, never retry

// ── Activity log + humaniser ──────────────────────────────────
const activityLog = createActivityLog(db);
const humaniser   = createHumaniser(db);
let testGcJid: string | null = null; // set by .start command

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

  const claimer = initClaimer(sock, typingSim);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('\n[CONN] Scan QR with Mariabelle\'s WhatsApp → Linked Devices:\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      reconnectCount = 0;
      console.log('[MARIABELLE] Connected');
      // Pre-warm humaniser cache so decide() is instant on first card spawn
      void humaniser.warmCache().then(() => console.log('[HUMANISER] Cache warmed'));
    }
    if (connection === 'close') {
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
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message) continue;
      handleMessage(msg, sock, classifier, claimer, typingSim, selfNumber).catch(err => {
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
  typingSim:   TypingSimulator,
  selfNumber:  string,
): Promise<void> {

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
  const senderJid = fromMe
    ? (selfNumber + '@s.whatsapp.net')
    : (msg.key.participant ?? remoteJid);
  const groupJid  = isGroupJid(remoteJid) ? remoteJid : null;

  // Test GC image detection — handle before rawText guard
  if (hasImage && groupJid && groupJid === testGcJid) {
    void (async () => {
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        const result = await detectCard(buffer as Buffer);
        const gen  = result.generation === 'new' ? '🆕 NEW' : result.generation === 'old' ? '🕰️ OLD' : '❓ UNKNOWN';
        const conf = result.confidence === 'high' ? '🟢' : result.confidence === 'medium' ? '🟡' : '🔴';
        const s    = result.signals;
        const corner = (v: number) => v < 400 ? '🟢' : '🔴';
        await sock.sendMessage(groupJid, {
          text:
            `${gen} ${conf} ${result.confidence}\n` +
            `Uniform corners: ${s.uniformCorners}/4\n` +
            `${corner(s.cornerVarianceTL)}TL:${s.cornerVarianceTL} ${corner(s.cornerVarianceTR)}TR:${s.cornerVarianceTR}\n` +
            `${corner(s.cornerVarianceBL)}BL:${s.cornerVarianceBL} ${corner(s.cornerVarianceBR)}BR:${s.cornerVarianceBR}\n` +
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

  // ── Parse first (sync) ───────────────────────────────────
  const trace = registry.trace(rawText);

  console.log('[DEBUG] messageId:', messageId);
  console.log('[DEBUG] senderJid:', senderJid);
  console.log('[DEBUG] hasImage:', hasImage);
  console.log('[DEBUG] rawText first 80:', rawText?.slice(0, 80));
  console.log('[DEBUG] templateId:', trace.result?.templateId ?? 'null');

  // ── CARD_SPAWN fast path ──────────────────────────────────
  if (trace.result?.templateId === 'CARD_SPAWN') {
    const f = trace.result.fields as {
      cardName: string;
      tier:     string | number;
      price:    number;
      spawnId:  string;
      issue:    number;
    };
    const targetGroup = groupJid ?? remoteJid;

    // Per-spawnId dedup — if we already attempted this spawn, ignore
    if (attemptedSpawns.has(f.spawnId)) {
      console.log(`[CARD] ${f.spawnId} already attempted — duplicate delivery ignored`);
      return;
    }
    // Per-group dedup — only one claim in flight per group
    if (claimInFlight.has(targetGroup)) {
      console.log(`[CARD] ${f.spawnId} skipped — claim already in-flight for this group`);
      return;
    }
    claimInFlight.add(targetGroup);

    // ── Claim flow: pause → type → decide → fire → retry ─────
    void (async () => {
      const tier = String(f.tier);

      // 1. Decide immediately — during the invisible pre-typing pause
      const activityScore = (await activityLog.getScore(targetGroup)).score;
      const decision = await humaniser.decide({
        tier, design: 'unknown', issue: f.issue, activityScore,
      });

      console.log(`[CARD] ${f.cardName} (${f.spawnId}) T${tier} #${f.issue} — ${decision.shouldClaim ? 'CLAIMING' : 'SKIPPING'} | ${decision.reason}`);

      // 2. If skipping — do nothing, no typing flash, no tell
      if (!decision.shouldClaim) {
        claimInFlight.delete(targetGroup);
        return;
      }

      // 3. 600–1200ms pause before typing — biased toward shorter end
      await new Promise<void>(r => setTimeout(r, 600 + Math.pow(Math.random(), 2) * 600));

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

      // 7. Mark spawnId as attempted — no matter what happens next, never fire again
      attemptedSpawns.add(f.spawnId);

      // 8. Fire — message first, stop typing after (no gap)
      await sock.sendMessage(targetGroup, { text: `.claim ${f.spawnId}` });
      typingSim.stopLoop(targetGroup);
      console.log(`[CLAIMER] .claim ${f.spawnId} sent`);

      // 9. ntfy push notification
      const ntfyTopic = process.env['NTFY_TOPIC'];
      if (ntfyTopic) {
        const tierNum    = parseInt(tier);
        const isHighTier = tier === 'S' || tierNum >= 4;
        fetch(`https://ntfy.sh/${ntfyTopic}`, {
          method: 'POST',
          headers: {
            'Title':        `T${tier} claimed - Issue #${f.issue}`,
            'Priority':     isHighTier ? 'urgent' : 'high',
            'Tags':         isHighTier ? 'rotating_light' : 'bell',
            'Content-Type': 'text/plain',
          },
          body: `Spawn: ${f.spawnId}\nCard: ${f.cardName}\nGroup: ${targetGroup}`,
        }).then(() => console.log('[NTFY] Sent'))
          .catch((e: Error) => console.error('[NTFY] Failed:', e.message));
      }

      // 10. Wait for confirmation — retry ONCE after 35–50s only if no reply came
      const retryAfterMs = 35000 + Math.random() * 15000;
      await new Promise<void>(r => setTimeout(r, retryAfterMs));

      // If CLAIM_SUCCESS or CLAIM_TAKEN arrived during the wait — skip retry
      if (claimCancelled.has(targetGroup) || !claimInFlight.has(targetGroup)) {
        claimCancelled.delete(targetGroup);
        claimInFlight.delete(targetGroup);
        return;
      }

      console.log(`[CLAIMER] No confirmation for ${f.spawnId} — retrying once`);
      await sock.sendMessage(targetGroup, { text: `.claim ${f.spawnId}` });
      claimInFlight.delete(targetGroup);
    })();

    void (async () => {
      const { data: existing } = await db
        .from('card_events')
        .select('id')
        .eq('spawn_id', f.spawnId)
        .maybeSingle();

      if (existing) {
        claimInFlight.delete(targetGroup);
        console.log(`[CARD] ${f.spawnId} already in DB — duplicate delivery`);
        return;
      }

      let imageUrl: string | null = null;
      let imageId:  string | null = null;

      if (hasImage) {
        try {
          const buffer = await downloadMediaMessage(msg, 'buffer', {});
          const stored = await imager.store({
            spawnId:     f.spawnId,
            groupId:     targetGroup,
            senderJid,
            rawCaption:  rawText ?? '',
            imageBuffer: buffer as Buffer,
            detectedAt:  new Date(),
          });
          if (stored) { imageUrl = stored.publicUrl; imageId = stored.id; }
        } catch (e: unknown) {
          console.error('[IMAGE] Failed:', e instanceof Error ? e.message : String(e));
        }
      }

      const { error: cardError } = await db.from('card_events').upsert({
        group_id:  targetGroup,
        spawn_id:  f.spawnId,
        card_name: f.cardName,
        tier:      String(f.tier),
        price:     f.price,
        issue:     f.issue,
        image_url: imageUrl,
        image_id:  imageId,
        claimed:   false,
      }, { onConflict: 'spawn_id' });

      if (cardError) console.error('[CARD_INSERT ERROR]', cardError.message);
      else console.log(`[CARD] ${f.cardName} (${f.spawnId}) saved`);

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
  console.log('[DEBUG] senderType:', senderType);

  // Auto-discovery: BOT_PING
  if (trace.result?.templateId === 'BOT_PING') {
    await db.from('known_bots').upsert(
      { jid: normalizeJid(senderJid), number: getNumber(senderJid), status: 'verified' },
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
      { jid: normalizeJid(senderJid), number: getNumber(senderJid), status: 'unverified' },
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
    if (cmd === '.start' && testGcJid === null) {
      testGcJid = groupJid;
      const name = groupNameCache.get(groupJid)?.name ?? groupJid;
      await activityLog.record({ groupId: groupJid, messageId: messageId ?? undefined });
      const score = await activityLog.getScore(groupJid);
      await sock.sendMessage(groupJid, { text: `✅ Test GC registered: ${name}\nActivity score: ${score.score} (${score.messageCount}/4 msgs)` });
      return;
    }

    // .image — DISABLED (image detection paused)
    if (false && cmd === '.image' && groupJid === testGcJid) {
      console.log(`[IMAGE-TEST] .image received | hasImage: ${hasImage}`);
      if (!hasImage) {
        await sock.sendMessage(groupJid, { text: '❌ No image attached — send image with caption .image' });
        return;
      }
      try {
        console.log('[IMAGE-TEST] Downloading...');
        const rawBuffer = await downloadMediaMessage(msg, 'buffer', {});
        console.log(`[IMAGE-TEST] Downloaded ${(rawBuffer as Buffer).length} bytes — converting to PNG`);
        // WhatsApp recompresses images to JPEG, stripping alpha. Re-encode as PNG so detectCard sees alpha.
        const img       = await Jimp.read(rawBuffer as Buffer);
        const pngBuffer = await img.getBufferAsync(Jimp.MIME_PNG);
        console.log(`[IMAGE-TEST] PNG buffer: ${pngBuffer.length} bytes`);
        const result    = await detectCard(pngBuffer);
        console.log(`[IMAGE-TEST] Detection done: ${result.generation} ${result.confidence}`);
        const gen = result.generation === 'new' ? '🆕 NEW' : result.generation === 'old' ? '🕰️ OLD' : '❓ UNKNOWN';
        const conf = result.confidence === 'high' ? '🟢' : result.confidence === 'medium' ? '🟡' : '🔴';
        const s = result.signals;
        await sock.sendMessage(groupJid, {
          text:
            `${gen} ${conf} ${result.confidence}\n` +
            `Spread: ${s.cornerSpread}px | Avg: ${s.avgCornerDepth.toFixed(1)}px\n` +
            `TL:${s.cornerDepthTopLeft} TR:${s.cornerDepthTopRight} BL:${s.cornerDepthBottomLeft} BR:${s.cornerDepthBottomRight}\n` +
            `fmt:${s.format} alpha:${s.hasAlphaChannel} | ${result.timingMs}ms`,
        });
      } catch (e) {
        console.error('[IMAGE-TEST] Error:', (e as Error).message);
        await sock.sendMessage(groupJid, { text: `❌ Failed: ${(e as Error).message}` });
      }
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
          const bracket = CLAIM_BRACKETS[Math.floor(Math.random() * CLAIM_BRACKETS.length)]!;
          waitMs  = bracket.minMs + Math.random() * (bracket.maxMs - bracket.minMs);
          summary = `T${tier} — always claim | delay ${Math.round(waitMs / 1000)}s`;
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

      const buffer = await downloadMediaMessage(fakeMsg, 'buffer', {});
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
    await activityLog.record({ groupId: groupJid, messageId: messageId ?? undefined });
    const score = await activityLog.getScore(groupJid);
    console.log(`[ACTIVITY-TEST] Recorded self message. Score: ${score.score} (${score.messageCount} msgs in last 60min)`);
  }

  // ── CLAIM_SUCCESS ─────────────────────────────────────────
  if (trace.result?.templateId === 'CLAIM_SUCCESS') {
    if (groupJid) {
      claimCancelled.add(groupJid); // stop any pending retry
      claimInFlight.delete(groupJid);
    }
    console.log(`[CLAIM_SUCCESS] quotedMessageId=${quotedMessageId ?? 'null'}`);

    let spawnId:    string | null = null;
    let claimerJid: string | null = null;

    if (quotedMessageId) {
      const { data: quotedRow, error: qErr } = await db
        .from('parse_log')
        .select('sender_jid, fields_json')
        .eq('message_id', quotedMessageId)
        .maybeSingle();
      if (qErr) console.error('[CLAIM_SUCCESS] quotedRow lookup error:', qErr.message);
      if (quotedRow) {
        claimerJid = quotedRow.sender_jid as string;
        spawnId    = (quotedRow.fields_json as { spawnId?: string } | null)?.spawnId ?? null;
      }
    }

    if (!spawnId) {
      const cardName = (trace.result.fields as { cardName?: string } | undefined)?.cardName ?? null;
      if (cardName) {
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

    if (spawnId) {
      claimer.confirm(spawnId);
      const { error: updateErr } = await db.from('card_events')
        .update({ claimed: true, claimed_at: new Date().toISOString(), claimer_jid: claimerJid, claim_log_id: parseLogId })
        .eq('spawn_id', spawnId);
      if (updateErr) console.error('[CLAIM_SUCCESS] update failed:', updateErr.message);
      else console.log(`[CLAIMED] ${spawnId} by ${claimerJid ? formatDisplay(claimerJid) : 'unknown'}`);
    } else {
      console.warn('[CLAIM_SUCCESS] could not resolve spawnId');
    }
  }

  // ── CLAIM_TAKEN ───────────────────────────────────────────
  if (trace.result?.templateId === 'CLAIM_TAKEN' && quotedMessageId) {
    if (groupJid) {
      claimCancelled.add(groupJid); // signal the in-flight claim to abort
      claimInFlight.delete(groupJid);
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
