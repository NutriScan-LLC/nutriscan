# nutriscan-web

Web app for NutriScan — a white-labeled clinical vitality-scanning platform
built on hardware scanners. Patients scan on the scanner vendor's
tablet/scanner; this app receives the result, displays it, and (from
Stream D onward) stores scan history and powers the clinician dashboard.

## Stack

- **Next.js (App Router) + TypeScript** — routing, SSR, API routes
- **Tailwind CSS v4** — styling
- **Supabase** — Postgres, Auth, Storage, Row-Level Security
- **Vercel** — hosting, custom domain, SSL, auto-deploy on push
- **Recharts** — added in Stream D for scan-history trend graphs

## Repo structure

```
src/
  app/
    page.tsx           landing page (placeholder for now)
    layout.tsx          root layout, fonts, metadata
    globals.css         Tailwind entry point
    result/
      page.tsx          /result — renders inside the scanner vendor's
                          tablet iframe. Reads ?data=&lang=&theme= query
                          params.
  lib/
    scanner-payload.ts   Scanner payload type + base64/JSON decoder
    supabase/
      client.ts          browser-side Supabase client (publishable key only)
      server.ts          server-only Supabase client (service_role key —
                          never imported from client code)
.env.local.example        template for local env vars — copy to .env.local
```

## Current status: Stream A (infrastructure)

This is infrastructure setup only. What exists:

- App scaffolded, builds and deploys cleanly.
- `/result` reads its query params and can decode a real scanner payload,
  but has no branding, no interpretation copy, and does not persist
  anything to Supabase yet.
- No Supabase tables exist yet — `server.ts` is a stub ready for Stream D.
- Landing page is a placeholder so there's something live to point the
  scanner vendor's config at.

Not yet built (later streams, per the NutriScan build plan): branded result
UI + interpretation copy (Stream B), patient accounts + scan history
(Stream D), clinician dashboard (Stream E).

## Local development

```bash
npm install
cp .env.local.example .env.local   # then fill in Supabase values
npm run dev
```

Visit `http://localhost:3000` and `http://localhost:3000/result?data=<base64>&lang=en&theme=light`.

## Environment variables

See `.env.local.example`. Three variables, all sourced from the Supabase
project dashboard (Project Settings -> API):

| Variable | Where it's used | Safe for browser? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client + server | yes (RLS-gated) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | **no — never expose** |

In production these are set as Vercel Environment Variables, not committed
to git. `.env.local` is gitignored.

## Deployment

Connected to Vercel: every push to `main` auto-deploys to production;
pushes to other branches get their own preview URL. Custom domain
`app.yournutriscan.com` points at this Vercel project (see the infra
checklist Brytt has for exact DNS steps).

# NutriScan

NutriScan is a white-label web application for connected nutrition scanners.

The application allows clinicians, retailers, wellness companies, and nutrition brands to deliver branded scanner experiences while using a shared codebase.

---

## Project Goals

Build the simplest, cleanest, and most trustworthy scanner experience possible.

Priorities:

1. Exceptional UX
2. Reliable scanner communication
3. White-label branding
4. Fast performance
5. Clean architecture

---

## Documentation

Read these documents in order:

1. Product.md
2. Design-System.md
3. Architecture.md
4. Scanner.md

---

## Tech Stack

- Next.js
- React
- TypeScript
- TailwindCSS
- Supabase
- Vercel
- WebUSB
- Scanner SDK

---

## Rules

Never invent scanner protocol behavior.

Never hardcode branding.

Always use reusable components.

Prefer simple solutions over clever ones.

Optimize for maintainability.
