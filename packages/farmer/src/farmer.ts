import type { WASocket } from '@whiskeysockets/baileys';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Personality } from '@mariabelle/personality';

const GEMINI_MODEL     = 'gemma-3-27b-it';
const BOT_QUIET_TIMEOUT = 60_000;

interface FarmSession {
  id:                 string;
  groupId:            string;
  botJid:             string;
  triggerMessageId:   string;
  lastBotMessageId:   string | null;
  lastBotContent:     string | null;
  quietTimer:         ReturnType<typeof setTimeout> | null;
  active:             boolean;
}

// Typing speed: ~280-320 chars/minute for a teen texter + 1-3s reading delay
function calculateTypingDelay(message: string): number {
  const charsPerMinute = 280 + Math.random() * 40;
  const typingMs       = (message.length / charsPerMinute) * 60 * 1000;
  const readingDelay   = 1000 + Math.random() * 2000;
  const jitter         = (Math.random() - 0.5) * 500;
  return Math.max(1500, Math.round(typingMs + readingDelay + jitter));
}

function detectAnimeTopic(text: string): string | undefined {
  const keywords = [
    'tensura', 'slime', 'naruto', 'bleach', 'one piece', 'fairy tail',
    'attack on titan', 'aot', 'demon slayer', 'kimetsu', 'jujutsu',
    'fullmetal', 'fma', 'death note', 'hunter x hunter', 'hxh',
    'genshin', 'sword art', 'sao', 'black clover', 'my hero', 'mha',
    'dragonball', 'dragon ball', 'boruto', 'chainsaw man', 'spy family',
  ];
  const lower = text.toLowerCase();
  return keywords.find(k => lower.includes(k));
}

export function createFarmer(
  sock: WASocket,
  supabase: SupabaseClient,
  personality: Personality,
  geminiApiKey: string,
  selfNumber: string,
) {
  void selfNumber; // available for future use (e.g. DM routing)
  const sessions = new Map<string, FarmSession>();

  async function callGemini(systemPrompt: string): Promise<string> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents:           [{ role: 'user', parts: [{ text: 'Reply now.' }] }],
          generationConfig:   { maxOutputTokens: 150, temperature: 0.9 },
        }),
      },
    );
    const data = await res.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
  }

  async function getSessionHistory(sessionId: string) {
    const { data } = await supabase
      .from('farm_messages')
      .select('sender,content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    return (data ?? []) as { sender: string; content: string }[];
  }

  async function fetchYourMessages() {
    const { data } = await supabase
      .from('activity_log')
      .select('content')
      .not('content', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);
    return (data ?? []) as { content: string }[];
  }

  async function fetchGcHistory(groupId: string) {
    const { data } = await supabase
      .from('parse_log')
      .select('sender_type, raw_text')
      .eq('group_id', groupId)
      .not('raw_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(150);
    return ((data ?? []) as { sender_type: string; raw_text: string }[]).reverse();
  }

  async function mariabelleReply(
    session: FarmSession,
    botMessageId: string,
    botContent:   string,
  ): Promise<void> {
    if (!session.active) return;

    await supabase.from('farm_messages').insert({
      session_id: session.id,
      message_id: botMessageId,
      sender:     'bot',
      content:    botContent,
    });

    const [history, yourMessages, gcHistory] = await Promise.all([
      getSessionHistory(session.id),
      fetchYourMessages(),
      fetchGcHistory(session.groupId),
    ]);

    const recentText = history.slice(-5).map(m => m.content).join(' ');
    const animeTopic = detectAnimeTopic(recentText + ' ' + botContent);

    const { systemPrompt } = await personality.buildSystemPrompt({
      conversationHistory: history,
      animeTopic,
      yourMessages,
      gcHistory,
    });

    const reply = await callGemini(systemPrompt);
    if (!reply) {
      console.log('[FARMER] Gemini returned empty — skipping');
      return;
    }

    const delay = calculateTypingDelay(reply);
    console.log(`[FARMER] Typing for ${Math.round(delay / 1000)}s — "${reply.slice(0, 40)}..."`);

    await sock.sendPresenceUpdate('composing', session.groupId);
    await new Promise<void>(r => setTimeout(r, delay));
    await sock.sendPresenceUpdate('paused', session.groupId);

    const sent = await sock.sendMessage(session.groupId, {
      text:   reply,
      quoted: { key: { id: botMessageId, remoteJid: session.groupId } } as never,
    });

    await supabase.from('farm_messages').insert({
      session_id: session.id,
      message_id: sent?.key.id ?? null,
      sender:     'mariabelle',
      content:    reply,
      quoted_id:  botMessageId,
    });

    await supabase.from('farm_sessions')
      .update({ message_count: history.length + 2 })
      .eq('id', session.id);

    session.lastBotMessageId = botMessageId;
    session.lastBotContent   = botContent;
    resetQuietTimer(session);
  }

  function resetQuietTimer(session: FarmSession): void {
    if (session.quietTimer) clearTimeout(session.quietTimer);

    session.quietTimer = setTimeout(() => {
      if (!session.active) return;
      console.log('[FARMER] Bot quiet 60s — retrying with last message');

      if (session.lastBotMessageId && session.lastBotContent) {
        void mariabelleReply(session, session.lastBotMessageId, session.lastBotContent);

        session.quietTimer = setTimeout(() => {
          if (!session.active) return;
          console.log('[FARMER] Still quiet — sending .test and ending');
          void sock.sendMessage(session.groupId, { text: '.test' });
          void endSession(session.groupId, 'ended_by_timeout');
        }, BOT_QUIET_TIMEOUT);
      }
    }, BOT_QUIET_TIMEOUT);
  }

  async function endSession(groupId: string, reason: string): Promise<void> {
    const session = sessions.get(groupId);
    if (!session) return;
    session.active = false;
    if (session.quietTimer) clearTimeout(session.quietTimer);
    sessions.delete(groupId);
    await supabase.from('farm_sessions')
      .update({ status: reason, ended_at: new Date().toISOString() })
      .eq('id', session.id);
    console.log(`[FARMER] Session ended — ${reason}`);
  }

  return {
    async startSession(
      groupId:          string,
      triggerMessageId: string,
      botJid:           string,
    ): Promise<void> {
      if (sessions.has(groupId)) {
        console.log('[FARMER] Already active in this GC');
        return;
      }

      const { data } = await supabase.from('farm_sessions').insert({
        group_id:           groupId,
        trigger_message_id: triggerMessageId,
        bot_jid:            botJid,
        status:             'active',
      }).select('id').single();

      if (!data) return;

      const session: FarmSession = {
        id:               (data as { id: string }).id,
        groupId,
        botJid,
        triggerMessageId,
        lastBotMessageId: null,
        lastBotContent:   null,
        quietTimer:       null,
        active:           true,
      };
      sessions.set(groupId, session);

      await supabase.from('farm_messages').insert({
        session_id: session.id,
        sender:     'you',
        content:    'I wanna farm',
        message_id: triggerMessageId,
      });

      console.log(`[FARMER] Session started — ${groupId}`);
    },

    async onBotMessage(
      groupId:   string,
      messageId: string,
      content:   string,
      quotedId:  string | null,
    ): Promise<void> {
      const session = sessions.get(groupId);
      if (!session || !session.active) return;

      const isFirstReply  = session.lastBotMessageId === null;
      const isReplyingToUs =
        quotedId === session.triggerMessageId ||
        quotedId === session.lastBotMessageId;

      if (!isFirstReply && !isReplyingToUs) return;

      await mariabelleReply(session, messageId, content);
    },

    async stopSession(groupId: string): Promise<void> {
      await endSession(groupId, 'ended_by_user');
    },

    isActive(groupId: string): boolean {
      return sessions.has(groupId);
    },
  };
}

export type Farmer = ReturnType<typeof createFarmer>;
