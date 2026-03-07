import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/**
 * Returns a server-side Supabase client using the service role key,
 * or null if the required environment variables are not configured.
 * The client is created lazily so missing env vars don't break module load.
 * Only use this in API routes / server-side code.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (_client) return _client;
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;
  _client = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
  return _client;
}
