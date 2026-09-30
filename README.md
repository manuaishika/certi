# CerGeMA — Smart Events, Instant Certificates

Multi-tenant certificate + event-management SaaS (registration → ID pass → QR check-in → approval →
bilingual certificate → public verification), built **Python-first**:

| Layer | Choice |
|---|---|
| Web / API | FastAPI + Jinja2 server-rendered pages, HTMX for inline interactions |
| Data | SQLModel → SQLite (dev) or **PostgreSQL / Supabase** (`DATABASE_URL`) |
| Certificates | Pillow + libraqm: 300 DPI A4 PNG/PDF, landscape & portrait, real Devanagari shaping |
| QR | `qrcode` (verification + ID-pass tokens); html5-qrcode (vendored) for the gate scanner |
| AI backgrounds | Google Imagen via Gemini API when `GEMINI_API_KEY` is set, else a built-in procedural generator |
| Payments | Razorpay (INR / UPI) and Stripe (USD) over `httpx`; mock gateway when no keys are set |
| Messaging | Twilio SMS / WhatsApp (logged only when unset) |
| Front end | Tailwind **pre-built to `app/static/app.css`** (no CDN, no Node at runtime), PWA manifest + service worker, TWA `assetlinks.json` |

## Run it

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload          # http://localhost:8000
python -m pytest                        # 12 end-to-end tests
```

Seeded logins (first start, `SEED_DEMO=1`): Super Admin `admin@cergema.local / admin123`,
demo organiser `demo@cergema.local / demo123`. Demo event: `/events/svabhasha-samman-2026`.
**Change `SECRET_KEY`, `ADMIN_PASSWORD`, set `SEED_DEMO=0` before deploying** (see `.env.example`).

Docker (installs libraqm + Noto fonts for correct Hindi): `docker compose up --build`.

Devanagari on PDFs needs `libraqm` (Pillow) and a Devanagari font (Noto Sans/Serif Devanagari, Mukta, Lohit, FreeSerif…).
The console shows a warning banner if shaping is unavailable. Drop extra `.ttf` files in `app/assets/fonts/` or set `FONT_DIR`.

After editing templates: `tools/build_css.sh` (needs Node, dev-time only) to rebuild `app.css`.

## What maps to the SRS

| SRS module | Where |
|---|---|
| A. Certificate engine — dual orientation, templates, custom background + drag-and-drop field mapper, verify QR, feedback gate, WhatsApp/LinkedIn/Facebook share + OG badge | `services/render.py`, `services/backgrounds.py`, `/admin/events/{id}/design`, `/certificate/*`, `/verify/*`, `/share/*` |
| B. Event lifecycle — offline / online (link gated to registered online attendees) / hybrid, SEO landing + Schema.org JSON-LD, bilingual intake with confirmation modal | `/events/{slug}`, `_confirm.html` |
| C. Digital ID pass + QR gate scanner + attendance-gated certificates | `/pass/{token}`, `/admin/scan`, `issuing.eligible()` |
| 5. Parent org → branches, co-host logos (equal size), sponsor grid ("Supported By") | `Org.parent_id`, `Event.cohosts/sponsors` |
| 7. Plans, per-tenant overrides (quota, price, modules), wallet, AI credits, overage | `services/plans.py`, `/admin/orgs`, `/admin/billing` |
| 8. Razorpay/UPI, Stripe/USD by country, affiliate coupons with recurring commission | `services/payments.py`, `/admin/coupons` |
| Phase 4: ERP/SIS REST API | `POST/GET /api/v1/events/{slug}/registrations`, `GET .../certificates` (`X-API-Key`) |

Passwordless retrieval: `/claim` by mobile number or certificate ID. Corrections made in the admin grid
propagate to already-issued certificates (they render from the live record), so a spelling fix never needs a reissue.

## Deviations from the SRS (deliberate)

* **Python instead of React/Supabase-Edge/jsPDF.** Rendering is server-side (Pillow) rather than client-side jsPDF,
  which gives identical output on every device and one font stack. Postgres/Supabase is still supported as the database,
  but tenant isolation is enforced in the application layer (`org_access`) rather than with Row-Level Security.
* **Tier table followed literally**: QR attendance is an *Enterprise* module, AI gives 5 free runs/month on Pro
  (then 12 credits/run), co-hosts/sponsors need Pro+. Super Admin can override modules per tenant.
* Co-branding limit defaults to 1 co-host + 2 sponsors (`MAX_COHOSTS`, `MAX_SPONSORS`) — the open question in SRS §10.

## Known gaps — please read

* **Not verified against live services**: Razorpay, Stripe, Twilio and Imagen calls are written to their documented
  REST APIs but could only be exercised in mock/offline mode here. Test each with sandbox keys before launch.
  Razorpay payments are confirmed by signature-verified redirect *and* `/api/webhooks/razorpay` (set `RAZORPAY_WEBHOOK_SECRET`).
* **Play Store TWA** needs packaging with Bubblewrap/PWABuilder and your signing key; the app serves the PWA manifest,
  service worker and `/.well-known/assetlinks.json` (`ANDROID_SHA256`) it requires.
* No CSRF tokens (cookies are `SameSite=Lax`); add them if you host the console on a shared parent domain.
* Rate limiting is in-process memory — use a shared store (Redis) when running multiple workers.
* Only `en`/`hi` UI strings exist (`app/i18n.py`); regional scripts in certificates work if a matching font is installed.
* Uploaded files live on local disk (`DATA_DIR/uploads`); mount a persistent volume or move to object storage.
