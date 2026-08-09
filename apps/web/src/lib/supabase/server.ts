import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only Supabase client. This is the ONLY place the service_role key
// should ever be used — it bypasses Row-Level Security entirely, so it must
// never reach the browser. The `server-only` import above makes it a build
// error if this file is ever imported from client-side code.
//
// Use this for: ingesting scan results from /result (Stream B/D onward),
// and any other write that must bypass RLS deliberately (e.g. the ingest
// pipeline resolving a scanner serial -> clinician_id).

export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "Set them in .env.local (dev) or Vercel's server-side env vars (prod). " +
        "SUPABASE_SERVICE_ROLE_KEY must NOT be prefixed with NEXT_PUBLIC_.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
