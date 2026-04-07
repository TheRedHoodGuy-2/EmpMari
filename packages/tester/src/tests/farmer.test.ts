import type { SupabaseClient } from '@supabase/supabase-js';
import type { Personality } from '@mariabelle/personality';
import type { TestResult, TestStep } from '../types.js';

const GEMINI_MODEL = 'gemma-3-27b-it';

export async function testFarmer(
  supabase:     SupabaseClient,
  personality:  Personality,
  geminiApiKey: string,
  testGroupId:  string,
): Promise<TestResult> {
  const start = Date.now();
  const steps: TestStep[] = [];

  // Step 1: API key present
  steps.push({
    label:  'GEMINI_API_KEY set',
    passed: geminiApiKey.length > 0,
    error:  geminiApiKey.length === 0 ? 'GEMINI_API_KEY is empty' : undefined,
    fix:    'Add GEMINI_API_KEY to .env file',
  });

  // Step 2: Gemini responds
  if (geminiApiKey.length > 0) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents:         [{ role: 'user', parts: [{ text: 'Say "test ok" and nothing else.' }] }],
            generationConfig: { maxOutputTokens: 10 },
          }),
        },
      );
      const data = await res.json() as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        error?: { message: string };
      };
      if (data.error) throw new Error(data.error.message);
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      steps.push({
        label:  'Gemini API responds',
        passed: reply.length > 0,
        detail: `Reply: "${reply.trim()}"`,
        error:  reply.length === 0 ? 'Empty response from Gemini' : undefined,
        fix:    'Check API key is valid and model name is correct',
      });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      steps.push({ label: 'Gemini API responds', passed: false, error: err.message, fix: 'Check GEMINI_API_KEY and internet connection', stack: err.stack });
    }
  }

  // Step 3: farm_sessions accessible
  try {
    const { error } = await supabase.from('farm_sessions').select('id').limit(1);
    if (error) throw error;
    steps.push({ label: 'farm_sessions table accessible', passed: true });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    steps.push({ label: 'farm_sessions table accessible', passed: false, error: err.message, fix: 'Run the farm sessions SQL migration', stack: err.stack });
  }

  // Step 4: GC history queryable
  try {
    const { data, error } = await supabase
      .from('parse_log').select('raw_text').eq('group_id', testGroupId).limit(5);
    if (error) throw error;
    steps.push({
      label:  'GC history queryable from parse_log',
      passed: true,
      detail: `${data?.length ?? 0} messages found in test GC`,
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    steps.push({ label: 'GC history queryable', passed: false, error: err.message, stack: err.stack });
  }

  // Step 5: full dry run — personality prompt + Gemini reply
  if (geminiApiKey.length > 0) {
    try {
      const { systemPrompt } = await personality.buildSystemPrompt({
        conversationHistory: [{ sender: 'bot', content: 'lol yeah that card was fire' }],
      });
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [{ text: `${systemPrompt}\n\nReply now.` }],
            }],
            generationConfig: { maxOutputTokens: 60, temperature: 0.9 },
          }),
        },
      );
      const data = await res.json() as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        error?: { message: string };
      };
      if (data.error) throw new Error(data.error.message);
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
      steps.push({
        label:  'Full farmer dry run (personality + Gemini)',
        passed: reply.length > 0,
        detail: `Mariabelle would say: "${reply}"`,
        error:  reply.length === 0 ? 'Gemini returned empty reply' : undefined,
      });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      steps.push({ label: 'Full farmer dry run', passed: false, error: err.message, stack: err.stack });
    }
  }

  const passed = steps.every(s => s.passed);
  return { module: 'farmer', passed, steps, durationMs: Date.now() - start };
}
