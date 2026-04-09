// ============================================================
// Humaniser — Typing Simulator
//
// Simulates a human typing a message:
//   1. sendPresenceUpdate('composing')       ← show typing indicator
//   2. wait  composingMs  (weighted random)  ← "thinking + typing"
//   3. sendPresenceUpdate('paused')          ← stop indicator
//   4. caller sends the actual message
//
// For long-running simulate mode (e.g. test commands):
//   startLoop() — keeps composing alive until stopLoop()
// ============================================================

// ── Types ────────────────────────────────────────────────────

export interface TypingBracket {
  minMs: number;
  maxMs: number;
  weight: number; // relative probability
}

export interface TypingSimulatorOptions {
  /** Brackets to pick composing duration from. Defaults to SHORT_BRACKETS. */
  brackets?: TypingBracket[];
  /** How often (ms) to re-send composing in loop mode. Default 5000. */
  loopIntervalMs?: number;
}

// ── Preset bracket sets ──────────────────────────────────────

/** Fast reply — suited for short commands like .claim */
export const SHORT_BRACKETS: TypingBracket[] = [
  { minMs: 300, maxMs: 550,  weight: 60 },
  { minMs: 550, maxMs: 700,  weight: 30 },
  { minMs: 700, maxMs: 850,  weight: 10 },
];

/** Normal reply — suited for conversational messages */
export const NORMAL_BRACKETS: TypingBracket[] = [
  { minMs: 1000, maxMs: 2000, weight: 20 },
  { minMs: 2000, maxMs: 3500, weight: 50 },
  { minMs: 3500, maxMs: 5000, weight: 25 },
  { minMs: 5000, maxMs: 7000, weight: 5  },
];

/** Claim delay — human reads the spawn, thinks, types. Weighted towards 5–8s. */
export const CLAIM_BRACKETS: TypingBracket[] = [
  { minMs: 2000, maxMs: 4000, weight: 20 },
  { minMs: 4000, maxMs: 6000, weight: 45 },
  { minMs: 6000, maxMs: 8000, weight: 35 },
];

// ── Weighted random ──────────────────────────────────────────

function weightedRandom(brackets: TypingBracket[]): number {
  const total = brackets.reduce((s, b) => s + b.weight, 0);
  let roll = Math.random() * total;
  for (const b of brackets) {
    roll -= b.weight;
    if (roll <= 0) return b.minMs + Math.random() * (b.maxMs - b.minMs);
  }
  const last = brackets[brackets.length - 1]!;
  return last.minMs + Math.random() * (last.maxMs - last.minMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Presence adapter ─────────────────────────────────────────
// Keeps Baileys out of this package — caller injects these two functions.

export interface PresenceAdapter {
  startTyping(groupId: string): Promise<void>;
  stopTyping(groupId: string):  Promise<void>;
}

// ── TypingSimulator ──────────────────────────────────────────

export class TypingSimulator {
  private readonly brackets:       TypingBracket[];
  private readonly loopIntervalMs: number;
  private readonly loops = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private readonly presence: PresenceAdapter,
    opts: TypingSimulatorOptions = {},
  ) {
    this.brackets       = opts.brackets       ?? SHORT_BRACKETS;
    this.loopIntervalMs = opts.loopIntervalMs ?? 4000;
  }

  /**
   * Show composing indicator, wait a human-like duration, then hide it.
   * Call this immediately before sock.sendMessage().
   *
   * @param groupId  WhatsApp JID of the group/chat
   * @param brackets Override brackets for this specific call
   * @returns        How many ms we waited (useful for logging)
   */
  async beforeSend(groupId: string, brackets?: TypingBracket[]): Promise<number> {
    const duration = weightedRandom(brackets ?? this.brackets);
    return this.composingFor(groupId, duration);
  }

  /**
   * Show composing indicator for an exact duration, then hide it.
   * Use this when the caller already knows how long to wait (e.g. humaniser decision).
   *
   * @param groupId    WhatsApp JID of the group/chat
   * @param durationMs Exact ms to show composing for
   * @returns          The duration passed in (for logging consistency)
   */
  async composingFor(groupId: string, durationMs: number): Promise<number> {
    await this.presence.startTyping(groupId);

    // Re-ping composing every 4500ms so the bubble stays alive for long delays
    const repingInterval = 4500;
    let elapsed = 0;
    while (elapsed + repingInterval < durationMs) {
      await sleep(repingInterval);
      elapsed += repingInterval;
      await this.presence.startTyping(groupId);
    }
    await sleep(durationMs - elapsed);

    await this.presence.stopTyping(groupId);
    return durationMs;
  }

  /**
   * Start a composing loop in groupId — keeps the typing indicator alive
   * until stopLoop() is called. Use for .simulatetypehere / .simulatetypestop.
   */
  startLoop(groupId: string): void {
    if (this.loops.has(groupId)) return; // already running
    void this.presence.startTyping(groupId);
    const handle = setInterval(() => {
      void this.presence.startTyping(groupId);
    }, this.loopIntervalMs);
    this.loops.set(groupId, handle);
    console.log(`[HUMANISER] typing loop started → ${groupId}`);
  }

  /** Stop the composing loop and send paused presence. */
  stopLoop(groupId: string): void {
    const handle = this.loops.get(groupId);
    if (!handle) return;
    clearInterval(handle);
    this.loops.delete(groupId);
    void this.presence.stopTyping(groupId);
    console.log(`[HUMANISER] typing loop stopped → ${groupId}`);
  }

  isLooping(groupId: string): boolean {
    return this.loops.has(groupId);
  }
}
