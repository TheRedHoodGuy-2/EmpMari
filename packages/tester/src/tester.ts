import type { WASocket } from '@whiskeysockets/baileys';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Personality } from '@mariabelle/personality';
import { testParser }  from './tests/parser.test.js';
import { testFarmer }  from './tests/farmer.test.js';
import type { TestResult } from './types.js';

interface TesterDeps {
  personality:  Personality;
  geminiApiKey: string;
}

function formatResult(r: TestResult): string {
  const icon   = r.passed ? '✅' : '❌';
  const lines  = [`${icon} *${r.module}* (${r.durationMs}ms)`];
  for (const s of r.steps) {
    const si = s.passed ? '  ✓' : '  ✗';
    lines.push(`${si} ${s.label}${s.detail ? ` — ${s.detail}` : ''}`);
    if (!s.passed && s.error) lines.push(`    error: ${s.error}`);
    if (!s.passed && s.fix)   lines.push(`    fix: ${s.fix}`);
  }
  return lines.join('\n');
}

export function createTester(
  sock:    WASocket,
  supabase: SupabaseClient,
  deps:    TesterDeps,
) {
  const { personality, geminiApiKey } = deps;

  return {
    async setTestGc(groupId: string): Promise<void> {
      await supabase.from('control_config').upsert(
        { singleton: 'X', test_gc_id: groupId },
        { onConflict: 'singleton' },
      );
    },

    async run(command: string, testGroupId: string, replyJid: string): Promise<void> {
      const cmd = command.trim().toLowerCase();

      const runModule = async (name: string): Promise<TestResult | null> => {
        if (name === 'parser') return testParser();
        if (name === 'farmer') return testFarmer(supabase, personality, geminiApiKey, testGroupId);
        return null;
      };

      if (cmd === '.test all') {
        const modules = ['parser', 'farmer'];
        for (const name of modules) {
          const result = await runModule(name);
          if (!result) continue;
          await sock.sendMessage(replyJid, { text: formatResult(result) });
          if (!result.passed) {
            await sock.sendMessage(replyJid, { text: `⛔ Stopped at *${name}* — fix errors before continuing` });
            return;
          }
        }
        await sock.sendMessage(replyJid, { text: '🎉 All tests passed!' });
        return;
      }

      const moduleName = cmd.replace(/^\.test\s+/, '');
      const result = await runModule(moduleName);
      if (result) {
        await sock.sendMessage(replyJid, { text: formatResult(result) });
      } else {
        await sock.sendMessage(replyJid, { text: `❓ Unknown test module: ${moduleName}\nAvailable: parser, farmer, all` });
      }
    },
  };
}

export type Tester = ReturnType<typeof createTester>;
