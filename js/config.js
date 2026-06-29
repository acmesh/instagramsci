/* Instagramsci — backend configuration.
   The frontend supports three modes, chosen automatically:

     1. POSTGRES — set API_BASE to your Python API (recommended for self-host).
                   e.g. "/api" if nginx proxies /api/ to the Flask app.
     2. SUPABASE — leave API_BASE empty and set the two SUPABASE_* values.
     3. DEMO     — leave everything empty: the site runs on local seed data,
                   login/posting simulated. Nothing breaks.

   If both are set, POSTGRES wins. */

// ---- Option 1: your own Python + Postgres backend ----
export const API_BASE = "";          // e.g. "/api"  or  "https://instagramsci.example.org/api"

// ---- Option 2: Supabase (alternative) ----
export const SUPABASE_URL = "";
export const SUPABASE_ANON_KEY = "";

// ---- derived ----
export const isSupabase = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const isConfigured = isSupabase;   // back-compat
export const MODE = API_BASE ? "postgres" : (isSupabase() ? "supabase" : "demo");
