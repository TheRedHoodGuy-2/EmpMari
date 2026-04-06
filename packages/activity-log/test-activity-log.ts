/**
 * Standalone test for activity-log package.
 * Run: node --env-file=../../apps/whatsapp-bot/.env --import=tsx/esm test-activity-log.ts
 */

import { createClient } from '@supabase/supabase-js';
import { createActivityLog } from './src/activity-log.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const log = createActivityLog(supabase);
const TEST_GROUP = 'test-group-activity-log';

async function run() {
  console.log('=== Activity Log Test ===\n');

  // 1. Check score before any records
  const before = await log.getScore(TEST_GROUP);
  console.log('Score before records:', before);

  // 2. Insert 3 records
  console.log('\nInserting 3 records...');
  await log.record({ groupId: TEST_GROUP, messageId: 'msg-1' });
  await log.record({ groupId: TEST_GROUP, messageId: 'msg-2' });
  await log.record({ groupId: TEST_GROUP, messageId: 'msg-3' });

  // 3. Check score (should be 0.75 = 3/4)
  const after3 = await log.getScore(TEST_GROUP);
  console.log('Score after 3 records (expect ~0.75):', after3);

  // 4. Insert a 4th record
  await log.record({ groupId: TEST_GROUP, messageId: 'msg-4' });

  // 5. Check score (should be 1.0 = 4/4)
  const after4 = await log.getScore(TEST_GROUP);
  console.log('Score after 4 records (expect 1.0):', after4);

  // 6. Insert a 5th — score should still cap at 1.0
  await log.record({ groupId: TEST_GROUP, messageId: 'msg-5' });
  const after5 = await log.getScore(TEST_GROUP);
  console.log('Score after 5 records (expect 1.0, capped):', after5);

  // 7. Clean up test rows
  console.log('\nCleaning up test rows...');
  const { error } = await supabase
    .from('activity_log')
    .delete()
    .eq('group_id', TEST_GROUP);
  if (error) console.error('Cleanup failed:', error.message);
  else console.log('Cleanup done.');

  console.log('\n=== Test Complete ===');
}

run().catch(err => {
  console.error('Test crashed:', err);
  process.exit(1);
});
