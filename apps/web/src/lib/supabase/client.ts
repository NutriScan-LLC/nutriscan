"use client";

// Browser-side Supabase client. Uses the PUBLISHABLE (anon) key only —
// this key is safe to ship to the browser because Row-Level Security (RLS)
// policies in Postgres control what it can actually read/write.
//
// Never put the service_role key in any file under src/ that ships to the
// client. The service key belongs only in server-side code (see server.ts)
// and in Vercel's server-only env vars.
//
// Stream A note: this is a plain supabase-js client, sufficient for
// unauthenticated reads/writes. Stream D (patient/clinician auth) will
// likely swap this for @supabase/ssr's createBrowserClient so sessions
// persist correctly via cookies across server + client — that's a
// find-and-replace at that point, not a rearchitecture.

import { createClient } from "@supabase/supabase-js";

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. " +
        "Set them in .env.local (dev) or Vercel project env vars (prod).",
    );
  }

  return createClient(url, publishableKey);
}
