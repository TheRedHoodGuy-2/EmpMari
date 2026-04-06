// ============================================================
// Supabase client singleton (service role)
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = process.env['SUPABASE_URL'];
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!url || !key) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
    'Copy apps/whatsapp-bot/.env.example to .env and fill in your credentials.',
  );
}

export const db: SupabaseClient = createClient(url, key);
