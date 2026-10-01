-- CerGeMA core schema (PostgreSQL / Supabase).
-- Tenancy model: a tenant is a ROOT org (parent_id is null); branches/campuses are child orgs.
-- Money: 1 credit = Rs 1.00. All writes happen through SECURITY DEFINER functions (see 0003+);
-- tables additionally carry Row Level Security so direct PostgREST reads are tenant-isolated.

create schema if not exists app;

-- ------------------------------------------------------------------ plans & settings
create table public.plans (
  key           text primary key,
  name          text not null,
  price_inr     integer not null default 0,
  period        text not null check (period in ('month','event','year')),
  quota         integer,                       -- null = unlimited
  branches      integer,                       -- null = unlimited
  watermark     boolean not null default false,
  modules       text[] not null default '{}',
  ai_enabled    boolean not null default false,
  ai_free       integer,                       -- free AI runs per month; null = unlimited
  priority      integer not null default 0,    -- AI queue priority, higher runs first
  sort          integer not null default 0
);

insert into public.plans (key, name, price_inr, period, quota, branches, watermark, modules, ai_enabled, ai_free, priority, sort) values
 ('free',       'Free Community',    0,     'month', 100,   1,    true,  '{certificates}',                                   false, 0,    0,  1),
 ('event',      'Pay-Per-Event',     1199,  'event', 1000,  1,    false, '{certificates,registration}',                     true,  0,    1,  2),
 ('pro',        'Institutional Pro', 9999,  'year',  15000, 3,    false, '{certificates,registration,lifecycle,cobrand}',   true,  5,    2,  3),
 ('enterprise', 'Enterprise Custom', 24999, 'year',  null,  null, false, '{certificates,registration,lifecycle,idpass,attendance,ai,cobrand,whitelabel}', true, null, 10, 4);

create table public.app_settings (
  key   text primary key,
  value jsonb not null
);
insert into public.app_settings (key, value) values
 ('gateway_mode',       '"mock"'),      -- mock | live  (live = Razorpay / Stripe via Edge Functions)
 ('usd_per_inr',        '0.012'),
 ('ai_credits_per_run', '12'),          -- SRS: 10-15 credits per generation
 ('overage_inr',        '0.75'),        -- SRS: Rs 0.50 - 1.00 per extra certificate
 ('max_cohosts',        '1'),
 ('max_sponsors',       '2');

-- ------------------------------------------------------------------ organisations
create table public.orgs (
  id                 uuid primary key default gen_random_uuid(),
  parent_id          uuid references public.orgs(id) on delete cascade,
  name               text not null check (length(btrim(name)) > 0),
  logo_url           text not null default '',
  -- tenant (root) level settings
  plan               text not null default 'free' references public.plans(key),
  modules_override   text[],
  quota_override     integer,
  price_override_inr integer,
  wallet             numeric(12,2) not null default 0 check (wallet >= 0),
  api_key_hash       text,
  api_key_prefix     text,
  referral_coupon    text,
  active             boolean not null default true,
  brand              jsonb not null default '{}'::jsonb,   -- white-label: {app_name, color, hide_branding}
  created_at         timestamptz not null default now()
);
create index on public.orgs (parent_id);

create table public.tenant_domains (
  host     text primary key check (host = lower(host)),
  org_id   uuid not null references public.orgs(id) on delete cascade,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

-- profiles.id == auth.users.id (Supabase Auth)
create table public.profiles (
  id          uuid primary key,
  email       text not null unique,
  name        text not null default '',
  role        text not null check (role in ('super','org_admin','volunteer','affiliate')),
  org_id      uuid references public.orgs(id) on delete cascade,
  coupon_code text
);

-- ------------------------------------------------------------------ events
create table public.events (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,   -- hosting branch (or root)
  title            text not null,
  title_hi         text not null default '',
  slug             text not null unique,
  description      text not null default '',
  mode             text not null default 'offline' check (mode in ('offline','online','hybrid')),
  venue            text not null default '',
  lat              double precision,
  lng              double precision,
  arrival_info     text not null default '',
  meeting_url      text not null default '',
  starts_at        timestamptz,
  reg_open         boolean not null default true,
  orientation      text not null default 'landscape' check (orientation in ('landscape','portrait')),
  template         text not null default 'classic',
  bg_url           text not null default '',
  accent           text not null default '#1e3a8a' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  cert_title       text not null default 'Certificate of Participation',
  cert_body        text not null default 'for actively participating in {event} held on {date}.',
  signatory        text not null default '',
  signatory_role   text not null default '',
  layout           jsonb not null default '{}'::jsonb,
  cohosts          jsonb not null default '[]'::jsonb,   -- [{name, logo}]
  sponsors         jsonb not null default '[]'::jsonb,
  sponsor_label    text not null default 'Supported By',
  gate_attendance  boolean not null default false,
  feedback_gate    boolean not null default true,
  approval_required boolean not null default true,
  created_at       timestamptz not null default now()
);
create index on public.events (org_id);

create table public.registrations (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  name_en       text not null,
  name_hi       text not null default '',
  parent_name   text not null default '',
  institution   text not null default '',
  grade         text not null default '',
  mobile        text not null,
  email         text not null default '',
  attend_mode   text not null default 'offline' check (attend_mode in ('offline','online')),
  token         text not null unique,
  status        text not null default 'registered' check (status in ('registered','present')),
  approved      boolean not null default false,
  checked_in_at timestamptz,
  created_at    timestamptz not null default now(),
  unique (event_id, mobile, name_en)
);
create index on public.registrations (event_id);
create index on public.registrations (mobile);

create table public.certificates (
  id              uuid primary key default gen_random_uuid(),
  cert_id         text not null unique,
  event_id        uuid not null references public.events(id) on delete cascade,
  registration_id uuid not null references public.registrations(id) on delete cascade,
  tenant_id       uuid not null references public.orgs(id) on delete cascade,
  name            text not null,
  mobile          text not null,
  issued_at       timestamptz not null default now(),
  revoked         boolean not null default false,
  overage         boolean not null default false
);
create index on public.certificates (event_id);
create index on public.certificates (registration_id);
create index on public.certificates (mobile);
create index on public.certificates (tenant_id);

create table public.feedback (
  cert_id    text primary key references public.certificates(cert_id) on delete cascade,
  rating     integer not null check (rating between 1 and 5),
  comment    text not null default '',
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ money
create table public.transactions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  kind         text not null check (kind in ('topup','plan','ai','overage','commission','adjustment','refund')),
  amount       numeric(12,2) not null default 0,    -- money charged, in `currency`
  currency     text not null default 'INR',
  amount_inr   numeric(12,2) not null default 0,    -- INR equivalent (used for commissions)
  credits      numeric(12,2) not null default 0,    -- signed wallet delta
  provider     text not null default '',            -- razorpay | stripe | mock | wallet | manual
  provider_ref text not null default '',
  plan         text not null default '',
  coupon       text not null default '',
  status       text not null default 'created' check (status in ('created','paid','failed')),
  note         text not null default '',
  created_at   timestamptz not null default now()
);
create index on public.transactions (org_id, created_at desc);

create table public.coupons (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique check (code = upper(code)),
  percent_off        integer not null default 10 check (percent_off between 0 and 90),
  affiliate_name     text not null default '',
  commission_percent integer not null default 20 check (commission_percent between 0 and 50),
  uses               integer not null default 0,
  active             boolean not null default true
);

create table public.commissions (
  id             uuid primary key default gen_random_uuid(),
  coupon_code    text not null references public.coupons(code),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  tenant_id      uuid not null references public.orgs(id) on delete cascade,
  amount_inr     numeric(12,2) not null,
  status         text not null default 'accrued' check (status in ('accrued','requested','paid')),
  created_at     timestamptz not null default now(),
  unique (transaction_id)
);

-- ------------------------------------------------------------------ AI queue
create table public.ai_jobs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  event_id        uuid not null references public.events(id) on delete cascade,
  prompt          text not null,
  orientation     text not null default 'landscape',
  status          text not null default 'pending' check (status in ('pending','running','done','failed')),
  priority        integer not null default 0,
  credits_charged numeric(12,2) not null default 0,
  engine          text not null default '',          -- imagen | flux | procedural
  result_url      text not null default '',
  error           text not null default '',
  created_at      timestamptz not null default now()
);
create index on public.ai_jobs (status, priority desc, created_at);

-- ------------------------------------------------------------------ integrations
create table public.webhook_endpoints (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.orgs(id) on delete cascade,
  url       text not null check (url ~ '^https://'),
  secret    text not null,
  events    text[] not null default '{registration.created,certificate.issued,attendance.checked_in}',
  active    boolean not null default true,
  created_at timestamptz not null default now()
);

-- Transactional outbox: webhooks + customer notifications (WhatsApp / SMS / email),
-- drained by the `dispatch-outbox` Edge Function.
create table public.outbox (
  id         bigserial primary key,
  kind       text not null check (kind in ('webhook','notify')),
  tenant_id  uuid not null references public.orgs(id) on delete cascade,
  event_type text not null,
  payload    jsonb not null,
  status     text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts   integer not null default 0,
  last_error text not null default '',
  run_after  timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on public.outbox (status, run_after);

-- ------------------------------------------------------------------ Row Level Security
alter table public.plans             enable row level security;
alter table public.app_settings      enable row level security;
alter table public.orgs              enable row level security;
alter table public.tenant_domains    enable row level security;
alter table public.profiles          enable row level security;
alter table public.events            enable row level security;
alter table public.registrations     enable row level security;
alter table public.certificates      enable row level security;
alter table public.feedback          enable row level security;
alter table public.transactions      enable row level security;
alter table public.coupons           enable row level security;
alter table public.commissions       enable row level security;
alter table public.ai_jobs           enable row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.outbox            enable row level security;   -- no policies: service role only
