/* Instagramsci — Supabase client (buildless, loaded from CDN).
   The client library is fetched ONLY when a backend is configured, so demo mode
   needs no network and never depends on the CDN. Uses top-level await (supported
   in modern browsers for ES modules). */
import { SUPABASE_URL, SUPABASE_ANON_KEY, MODE } from "./config.js";

let _supabase = null;
if (MODE === "supabase") {
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
}

export const supabase = _supabase;
export const LIVE = Boolean(_supabase);
