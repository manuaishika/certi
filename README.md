# CerGeMA — Smart Events, Instant Certificates

Multi-tenant SaaS for event registration, QR attendance and verified bilingual (English + Devanagari) certificates,
built on the stack specified in the SRS: **React 18 · Vite · Tailwind · shadcn-style UI · Lucide · PWA/TWA · Supabase
(PostgreSQL, Row Level Security, Edge Functions) · client-side Canvas + jsPDF (300 DPI) · react-i18next ·
Imagen / FLUX · Razorpay / Stripe · dynamic Open Graph + Schema.org JSON-LD.**

## Try it in 30 seconds (no backend)

```bash
npm install
npm run dev          # http://localhost:5173
```

With no `VITE_SUPABASE_URL`, the app runs in **demo mode**: a complete PostgreSQL (PGlite/WASM) boots inside your browser
and applies the *same migrations* used in production, so every rule (RLS, quota, gating, billing) behaves identically.
Data persists in IndexedDB; "Reset demo data" in the yellow banner wipes it. The login page has one-click demo accounts
(Super Admin, Pro school, Enterprise, Free trust, Gate volunteer, Affiliate). Public pages: `/events/svabhasha-samman-2026`, `/claim`, `/verify/<id>`.

## Architecture

```
React SPA (src/)  ──rpc()──►  Postgres functions (supabase/migrations)   ◄── single source of business rules
   │  Canvas → PNG/PDF (jsPDF)        │ SECURITY DEFINER + explicit authorisation, RLS on every table
   │  Supabase Auth / Storage         │
   └──invoke()──►  Edge Functions (supabase/functions): checkout · razorpay/stripe webhooks · ai-worker ·
                   dispatch-outbox (webhooks + WhatsApp/SMS/email) · erp-api · invite-user · share-meta · sitemap
```

* **All business logic lives in SQL** (`0002`–`0005`), so there is exactly one implementation, used by Supabase in production
  and by PGlite in demo/tests. The UI only calls `api.rpc(...)`; `src/lib/backend.ts` picks the transport.
* **Tenancy:** a tenant is a root org; branches are child orgs. Every RPC re-checks the caller; tables also have RLS for direct reads.
  The `app` schema (helpers) is not exposed over the API. Service-only functions are `REVOKE`d from `anon`/`authenticated`.
* **Plans are data** (`plans` table, editable by the Super Admin) with per-tenant overrides of quota, price, modules and branding.
* **Payments:** prices are computed in the database; fulfilment happens only in signature-verified webhooks (amount and currency
  re-checked) or the mock gateway, which the database refuses once `gateway_mode = live`.
* **Outbox pattern:** registrations, issuances and check-ins enqueue signed ERP webhooks and customer notifications transactionally.
* **AI queue:** jobs carry the plan's priority (Enterprise first); credits are charged at request time and refunded if a job fails.

## Deploy

1. **Supabase:** create a project; `supabase link --project-ref <ref> && supabase db push` (applies `migrations/`, incl. the `assets` storage bucket).
2. Create your first user in *Auth → Users*, then run `supabase/bootstrap_super_admin.sql` with that e-mail.
3. `supabase secrets set --env-file supabase/.env.secrets` (see `.env.example`) and `supabase functions deploy`.
4. Optional but recommended: run `supabase/cron.sql` (pg_cron) so webhooks/notifications/AI jobs drain even with no browser open.
5. **Front end:** import the repo into Vercel (Framework: Vite; `vercel.json` adds the SPA fallback + security headers).
   Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PUBLIC_URL`. With none set it deploys in demo mode.
   Optional, for rich link previews: merge `vercel.crawlers.example.json` into `vercel.json` after replacing `<project-ref>`
   (rewrites WhatsApp/LinkedIn/Google crawlers to the `share-meta` function and serves `/sitemap.xml`).
6. Payments: configure Razorpay/Stripe webhooks to `…/functions/v1/razorpay-webhook` and `…/stripe-webhook`, then switch **Settings → gateway to live**.
7. **White-label:** add a wildcard / custom domain to the same deployment. A tenant adds the host under *Organisations*, the Super Admin verifies it.
8. **Google Play (TWA):** `cd twa && npx @bubblewrap/cli init --manifest https://cergema.mangalhands.com/manifest.webmanifest`
   (a starting `twa-manifest.json` is included), build, then put the signing-key SHA-256 into `public/.well-known/assetlinks.json`.

## ERP / SIS integration

`POST /functions/v1/erp-api/events/<slug>/registrations` (object or array), `GET …/registrations`, `GET …/certificates` with header `x-api-key`
(generated per tenant under *Organisations*; stored hashed, shown once). Outbound: register an https URL under *Organisations → webhooks* to receive
`registration.created`, `certificate.issued`, `attendance.checked_in`, signed `x-cergema-signature: t=<unix>,v1=<hmac_sha256(secret, "<t>.<body>")>`.

## Tests

| Command | What it proves |
|---|---|
| `npm test` | 44 tests. Migrations on real Postgres: tenant isolation, RLS, anon/authenticated/service privileges, issuing gates, quota + overage, billing, recurring commission, AI queue priority and refunds, webhooks/outbox, white-label domains. Plus webhook-signature and notification helpers. |
| `npm run check:edge` | `deno check` of every Edge Function against the real supabase-js types. |
| `npm run test:edge` | Payment webhooks (bad signature, replay, under-payment, idempotence), ERP API auth and limits, outbox/webhook signing, cron-secret auth, run under Deno with a faked client. |
| `npm run test:e2e` | Playwright through the whole product in a real browser (registration → pass → claim → feedback gate → 300 DPI PDF/PNG → verify; designer; AI background; scanner; billing; roles; Hindi; white-label host). |

## What is and isn't verified

Verified here: all SQL (on PGlite, Postgres-compatible), the UI end-to-end in Chromium, and Edge Function types/logic with a faked Supabase client.

**Not verified against live services** (needs your keys/project): Supabase Auth sign-in and `invite-user`, the Storage policies in `0006`
(that block is skipped on PGlite, which has no `storage` schema), Razorpay/Stripe order creation, Twilio/Resend delivery, Imagen/FLUX calls,
pg_cron scheduling. Demo mode uses seeded `dev_users` instead of Supabase Auth.

Known limits: Open Graph images are one static card (titles/descriptions are dynamic per certificate and event); UI languages are English and Hindi
(add a JSON file in `src/i18n/` for more; certificates already render any script a loaded font supports); no CAPTCHA / rate limiting on public RPCs
(put Supabase/Cloudflare rate limits in front); certificate files are generated in the browser, so the feedback gate withholds the certificate *data*
until feedback is given but cannot stop a user from re-downloading afterwards; custom-domain verification is a manual Super Admin step.

## Defaults worth confirming (SRS §10)

Co-branding = 1 co-host + 2 sponsors (`max_cohosts`, `max_sponsors` in Settings); Pro = ₹9,999/year; Pay-Per-Event ₹1,199 (inside ₹799–1,499); overage ₹0.75; AI 12 credits.
Tier rules follow the SRS table literally (QR attendance and ID-pass QR are Enterprise modules; the Super Admin can override per tenant).
