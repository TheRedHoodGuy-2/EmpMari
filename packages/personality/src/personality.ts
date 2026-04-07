import type { SupabaseClient } from '@supabase/supabase-js';

export interface BuildSystemPromptOptions {
  conversationHistory?: { sender: string; content: string }[];
  animeTopic?:          string;
  yourMessages?:        { content: string }[];
  gcHistory?:           { sender_type: string; raw_text: string }[];
}

export interface Personality {
  buildSystemPrompt(options: BuildSystemPromptOptions): Promise<{ systemPrompt: string; mood: string }>;
}

interface MoodRow      { mood: string; weight: number; }
interface TraitRow     { trait: string; }
interface SlangRow     { term: string; meaning: string; }
interface AbbrRow      { abbr: string; full: string; }
interface InterestRow  { topic: string; knowledge_level: string; }
interface RuleRow      { rule: string; }

function weightedRandom<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1]!;
}

async function fetchAnimeInfo(title: string): Promise<string> {
  try {
    const query = `
      query ($search: String) {
        Media(search: $search, type: ANIME) {
          title { romaji english }
          description(asHtml: false)
          genres
          averageScore
        }
      }
    `;
    const res = await fetch('https://graphql.anilist.co', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query, variables: { search: title } }),
    });
    const json = await res.json() as {
      data?: { Media?: { title?: { romaji?: string }; description?: string; genres?: string[]; averageScore?: number } };
    };
    const m = json.data?.Media;
    if (!m) return '';
    return `\n[Anime context: ${m.title?.romaji ?? title} | Score: ${m.averageScore ?? '?'}/100 | Genres: ${(m.genres ?? []).slice(0, 3).join(', ')}]`;
  } catch {
    return '';
  }
}

export function createPersonality(supabase: SupabaseClient): Personality {
  return {
    async buildSystemPrompt(options: BuildSystemPromptOptions = {}): Promise<{ systemPrompt: string; mood: string }> {
      const {
        conversationHistory = [],
        animeTopic,
        yourMessages = [],
        gcHistory = [],
      } = options;

      // Load all personality tables in parallel
      const [moodsRes, traitsRes, slangRes, abbrsRes, interestsRes, rulesAlwaysRes, rulesNeverRes] =
        await Promise.all([
          supabase.from('personality_moods').select('mood,weight'),
          supabase.from('personality_traits').select('trait'),
          supabase.from('personality_slang').select('term,meaning'),
          supabase.from('personality_abbrs').select('abbr,full'),
          supabase.from('personality_interests').select('topic,knowledge_level'),
          supabase.from('personality_rules').select('rule').eq('type', 'always'),
          supabase.from('personality_rules').select('rule').eq('type', 'never'),
        ]);

      const moods       = (moodsRes.data      ?? []) as MoodRow[];
      const traits      = (traitsRes.data     ?? []) as TraitRow[];
      const slang       = (slangRes.data      ?? []) as SlangRow[];
      const abbrs       = (abbrsRes.data      ?? []) as AbbrRow[];
      const interests   = (interestsRes.data  ?? []) as InterestRow[];
      const rulesAlways = (rulesAlwaysRes.data ?? []) as RuleRow[];
      const rulesNever  = (rulesNeverRes.data  ?? []) as RuleRow[];

      // Pick mood by weighted random
      const mood = moods.length > 0 ? weightedRandom(moods).mood : 'chill';

      // Anime context (optional enrichment)
      const animeContext = animeTopic ? await fetchAnimeInfo(animeTopic) : '';

      // Your recent messages (how you actually talk in GC)
      const yourSample = yourMessages
        .slice(0, 20)
        .map(m => `- "${m.content}"`)
        .join('\n');

      // GC chat history
      const gcSample = gcHistory
        .slice(-30)
        .map(m => `[${m.sender_type}]: ${m.raw_text}`)
        .join('\n');

      // Conversation so far
      const convoText = conversationHistory
        .map(m => `[${m.sender}]: ${m.content}`)
        .join('\n');

      const systemPrompt = `
You are Mariabelle — a teenage girl in a WhatsApp group chat about anime (mainly Tensura/That Time I Got Reincarnated as a Slime).

CURRENT MOOD: ${mood}

YOUR PERSONALITY TRAITS:
${traits.map(t => `- ${t.trait}`).join('\n')}

YOUR SLANG (use naturally, not every message):
${slang.map(s => `- "${s.term}" = ${s.meaning}`).join('\n')}

YOUR ABBREVIATIONS:
${abbrs.map(a => `- ${a.abbr} = ${a.full}`).join('\n')}

YOUR INTERESTS:
${interests.map(i => `- ${i.topic} (${i.knowledge_level})`).join('\n')}

RULES — ALWAYS:
${rulesAlways.map(r => `- ${r.rule}`).join('\n')}

RULES — NEVER:
${rulesNever.map(r => `- ${r.rule}`).join('\n')}
${animeContext ? `\nANIME CONTEXT:${animeContext}` : ''}
${yourSample ? `\nHOW YOU ACTUALLY TALK IN GC (sample of your recent messages):\n${yourSample}` : ''}
${gcSample ? `\nRECENT GC CHAT HISTORY:\n${gcSample}` : ''}
${convoText ? `\nCONVERSATION SO FAR:\n${convoText}` : ''}

Reply as Mariabelle. One short message only. No quotation marks around your reply. Sound like a real teenager texting — casual, natural, in the moment. Match the mood: ${mood}.
`.trim();

      return { systemPrompt, mood };
    },
  };
}
