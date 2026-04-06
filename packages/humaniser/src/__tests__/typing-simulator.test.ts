import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TypingSimulator, SHORT_BRACKETS, NORMAL_BRACKETS } from '../typing-simulator.js';
import type { PresenceAdapter } from '../typing-simulator.js';

// ── Mock presence ─────────────────────────────────────────────

function makeMockPresence(): PresenceAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async startTyping(groupId) { calls.push(`start:${groupId}`); },
    async stopTyping(groupId)  { calls.push(`stop:${groupId}`);  },
  };
}

// ── beforeSend ───────────────────────────────────────────────

describe('TypingSimulator.beforeSend', () => {
  beforeEach(() => { vi.useRealTimers(); });

  it('calls startTyping then stopTyping in order', async () => {
    vi.useFakeTimers();
    const presence = makeMockPresence();
    const sim = new TypingSimulator(presence);

    const promise = sim.beforeSend('group@g.us');
    await vi.runAllTimersAsync();
    await promise;

    expect(presence.calls[0]).toBe('start:group@g.us');
    expect(presence.calls[1]).toBe('stop:group@g.us');
    expect(presence.calls).toHaveLength(2);
  });

  it('returns a duration within SHORT_BRACKETS range', async () => {
    vi.useFakeTimers();
    const presence = makeMockPresence();
    const sim = new TypingSimulator(presence);

    const promise = sim.beforeSend('group@g.us');
    await vi.runAllTimersAsync();
    const ms = await promise;

    const min = SHORT_BRACKETS[0]!.minMs;
    const max = SHORT_BRACKETS[SHORT_BRACKETS.length - 1]!.maxMs;
    expect(ms).toBeGreaterThanOrEqual(min);
    expect(ms).toBeLessThanOrEqual(max);
  });

  it('respects custom bracket override', async () => {
    vi.useFakeTimers();
    const presence = makeMockPresence();
    const sim = new TypingSimulator(presence, { brackets: NORMAL_BRACKETS });

    const promise = sim.beforeSend('group@g.us');
    await vi.runAllTimersAsync();
    const ms = await promise;

    expect(ms).toBeGreaterThanOrEqual(NORMAL_BRACKETS[0]!.minMs);
    expect(ms).toBeLessThanOrEqual(NORMAL_BRACKETS[NORMAL_BRACKETS.length - 1]!.maxMs);
  });
});

// ── loop mode ────────────────────────────────────────────────

describe('TypingSimulator loop mode', () => {
  beforeEach(() => { vi.useRealTimers(); });

  it('startLoop fires startTyping immediately', () => {
    const presence = makeMockPresence();
    const sim = new TypingSimulator(presence);
    sim.startLoop('group@g.us');
    expect(presence.calls[0]).toBe('start:group@g.us');
    sim.stopLoop('group@g.us');
  });

  it('stopLoop fires stopTyping and clears loop', () => {
    const presence = makeMockPresence();
    const sim = new TypingSimulator(presence);
    sim.startLoop('group@g.us');
    sim.stopLoop('group@g.us');
    const stopCall = presence.calls.find(c => c.startsWith('stop:'));
    expect(stopCall).toBe('stop:group@g.us');
    expect(sim.isLooping('group@g.us')).toBe(false);
  });

  it('startLoop is idempotent — double-start does not create two intervals', () => {
    vi.useFakeTimers();
    const presence = makeMockPresence();
    const sim = new TypingSimulator(presence, { loopIntervalMs: 100 });

    sim.startLoop('group@g.us');
    sim.startLoop('group@g.us'); // second call should no-op
    presence.calls.length = 0;   // reset after initial starts

    vi.advanceTimersByTime(150);
    // only one interval running → only one re-ping
    expect(presence.calls.filter(c => c.startsWith('start:')).length).toBe(1);

    sim.stopLoop('group@g.us');
    vi.useRealTimers();
  });

  it('loop re-pings startTyping at loopIntervalMs', () => {
    vi.useFakeTimers();
    const presence = makeMockPresence();
    const sim = new TypingSimulator(presence, { loopIntervalMs: 500 });

    sim.startLoop('group@g.us');
    presence.calls.length = 0; // reset

    vi.advanceTimersByTime(1600); // 3 ticks at 500ms
    expect(presence.calls.filter(c => c.startsWith('start:')).length).toBe(3);

    sim.stopLoop('group@g.us');
    vi.useRealTimers();
  });
});
