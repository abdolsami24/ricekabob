// Browser Supabase client (anon key). Used by the kitchen page for
// Supabase Auth login and for the Realtime subscription that wakes the
// order feed up instantly (a 5-second polling loop runs as the fallback).
// The anon key can never read orders directly — RLS keeps the table closed;
// kitchen data comes from the session-checked API routes.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  if (!browserClient) browserClient = createClient(url, anon);
  return browserClient;
}
