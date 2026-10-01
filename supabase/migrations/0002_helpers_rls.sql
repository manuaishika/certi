-- Internal helpers (schema `app`, not exposed through PostgREST) and RLS policies.
-- Every helper is SECURITY DEFINER with a pinned search_path so RLS policies can call them safely.

create or replace function app.uid() returns uuid
language sql stable as $$ select auth.uid() $$;

create or replace function app.role() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function app.is_super() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select role = 'super' from public.profiles where id = auth.uid()), false)
$$;

create or replace function app.root_of(p_org uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(parent_id, id) from public.orgs where id = p_org
$$;

create or replace function app.tenant() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select app.root_of(org_id) from public.profiles where id = auth.uid()
$$;

create or replace function app.can_access_org(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (app.is_super() or app.root_of(p_org) is not distinct from app.tenant())
$$;

create or replace function app.assert_user() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or app.role() is null then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
end $$;

create or replace function app.assert_admin() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if app.role() is null or app.role() not in ('super','org_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function app.assert_super() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.is_super() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

-- returns the tenant root of p_org after checking the caller may touch it
create or replace function app.assert_org(p_org uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_root uuid := app.root_of(p_org);
begin
  if v_root is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not app.can_access_org(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  return v_root;
end $$;

create or replace function app.event_for(p_event uuid) returns public.events
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare e public.events;
begin
  select * into e from public.events where id = p_event;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform app.assert_org(e.org_id);
  return e;
end $$;

create or replace function app.setting(p_key text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select value from public.app_settings where key = p_key
$$;

-- ------------------------------------------------------------------ plans / entitlements
create or replace function app.plan_of(p_root uuid) returns public.plans
language sql stable security definer set search_path = public, pg_temp as $$
  select p.* from public.orgs o join public.plans p on p.key = o.plan where o.id = p_root
$$;

create or replace function app.modules_of(p_root uuid) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(o.modules_override, p.modules) from public.orgs o join public.plans p on p.key = o.plan where o.id = p_root
$$;

create or replace function app.has_module(p_root uuid, p_module text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_module = any (app.modules_of(p_root))
$$;

create or replace function app.quota_of(p_root uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(o.quota_override, p.quota) from public.orgs o join public.plans p on p.key = o.plan where o.id = p_root
$$;

create or replace function app.issued_count(p_root uuid, p_event uuid default null) returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_plan public.plans := app.plan_of(p_root); v_n integer; v_since timestamptz;
begin
  if v_plan.period = 'event' and p_event is not null then
    select count(*) into v_n from public.certificates where tenant_id = p_root and not revoked and event_id = p_event;
  else
    v_since := case v_plan.period when 'year' then date_trunc('year', now()) else date_trunc('month', now()) end;
    select count(*) into v_n from public.certificates where tenant_id = p_root and not revoked and issued_at >= v_since;
  end if;
  return v_n;
end $$;

-- remaining certificates inside the quota; null = unlimited
create or replace function app.remaining(p_root uuid, p_event uuid default null) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.quota_of(p_root) is null then null
              else greatest(0, app.quota_of(p_root) - app.issued_count(p_root, p_event)) end
$$;

create or replace function app.branch_count(p_root uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.orgs where parent_id = p_root
$$;

-- ------------------------------------------------------------------ text helpers
create or replace function app.norm_mobile(p text) returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) > 10 and left(d, 2) = '91' then d := substr(d, 3); end if;
  if length(d) = 11 and left(d, 1) = '0' then d := substr(d, 2); end if;
  return d;
end $$;

create or replace function app.clean(p text) returns text language sql immutable as $$
  select regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')
$$;

create or replace function app.new_token(p_prefix text, p_len int) returns text language sql volatile as $$
  select p_prefix || upper(substr(translate(encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'), '01ilo', '9ABCD'), 1, p_len))
$$;

create or replace function app.reg_errors(d jsonb) returns text[] language plpgsql immutable as $$
declare errs text[] := '{}';
begin
  if length(app.clean(d->>'name_en')) < 2 then errs := array_append(errs, 'Name (English) is required'); end if;
  if app.norm_mobile(d->>'mobile') !~ '^[6-9][0-9]{9}$' then errs := array_append(errs, 'Enter a valid 10-digit mobile number'); end if;
  if coalesce(d->>'email', '') <> '' and (d->>'email') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    errs := array_append(errs, 'Email looks invalid');
  end if;
  if coalesce(d->>'name_hi', '') <> '' and (d->>'name_hi') !~ '[ऀ-ॿ]' then
    errs := array_append(errs, 'Devanagari name must be written in Devanagari script (or left blank)');
  end if;
  return errs;
end $$;

-- ------------------------------------------------------------------ outbox
create or replace function app.enqueue(p_tenant uuid, p_kind text, p_type text, p_payload jsonb) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  insert into public.outbox (kind, tenant_id, event_type, payload) values (p_kind, p_tenant, p_type, p_payload)
$$;

-- ------------------------------------------------------------------ RLS policies
-- Reads only; all writes go through SECURITY DEFINER RPCs.
create policy plans_read    on public.plans        for select using (true);
create policy settings_read on public.app_settings for select using (key in ('overage_inr','ai_credits_per_run','max_cohosts','max_sponsors','gateway_mode','usd_per_inr'));

create policy orgs_read on public.orgs for select using (app.can_access_org(id));
create policy domains_read on public.tenant_domains for select using (app.can_access_org(org_id));
create policy profiles_read on public.profiles for select using (
  id = auth.uid() or app.is_super() or (org_id is not null and app.root_of(org_id) is not distinct from app.tenant()));
create policy events_read on public.events for select using (app.can_access_org(org_id));
create policy regs_read on public.registrations for select using (
  exists (select 1 from public.events e where e.id = event_id and app.can_access_org(e.org_id)));
create policy certs_read on public.certificates for select using (app.can_access_org(tenant_id));
create policy feedback_read on public.feedback for select using (
  exists (select 1 from public.certificates c where c.cert_id = feedback.cert_id and app.can_access_org(c.tenant_id)));
create policy txn_read on public.transactions for select using (app.can_access_org(org_id));
create policy coupons_read on public.coupons for select using (
  app.is_super() or code = (select coupon_code from public.profiles where id = auth.uid()));
create policy commissions_read on public.commissions for select using (
  app.is_super() or coupon_code = (select coupon_code from public.profiles where id = auth.uid()));
create policy ai_read on public.ai_jobs for select using (app.can_access_org(org_id));
create policy webhooks_read on public.webhook_endpoints for select using (app.can_access_org(tenant_id));
