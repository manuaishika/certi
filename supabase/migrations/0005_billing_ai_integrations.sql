-- Billing + wallet, AI job queue, affiliate programme, webhooks, ERP + service-role functions.

-- ------------------------------------------------------------------ billing
create or replace function public.get_billing(p_org uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_root uuid; o public.orgs;
begin
  perform app.assert_admin();
  v_root := app.assert_org(coalesce(p_org, app.tenant()));
  select * into o from public.orgs where id = v_root;
  return jsonb_build_object(
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'plan', o.plan, 'wallet', o.wallet),
    'plans', (select jsonb_agg(to_jsonb(p) || jsonb_build_object('price',
                case when p.key = o.plan and o.price_override_inr is not null then o.price_override_inr else p.price_inr end) order by p.sort) from public.plans p),
    'transactions', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from (select * from public.transactions where org_id = v_root order by created_at desc limit 30) t), '[]'::jsonb),
    'settings', public.get_public_settings());
end $$;

create or replace function public.create_payment_order(p_org uuid, p_kind text, p_amount_inr numeric, p_plan text default '', p_coupon text default '', p_currency text default 'INR') returns jsonb
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_root uuid; o public.orgs; pl public.plans; cp public.coupons; v_inr numeric; v_amt numeric; v_provider text; v_rate numeric; t public.transactions;
begin
  perform app.assert_admin();
  v_root := app.assert_org(p_org);
  select * into o from public.orgs where id = v_root;
  if p_currency not in ('INR','USD') then raise exception 'Unsupported currency' using errcode = '22023'; end if;
  if p_kind = 'topup' then
    if p_amount_inr is null or p_amount_inr < 100 or p_amount_inr > 200000 then raise exception 'Top-up must be between Rs 100 and Rs 2,00,000' using errcode = '22023'; end if;
    v_inr := round(p_amount_inr, 2);
  elsif p_kind = 'plan' then
    select * into pl from public.plans where key = p_plan;
    if not found or pl.key = 'free' then raise exception 'Choose a paid plan' using errcode = '22023'; end if;
    v_inr := case when o.plan = pl.key and o.price_override_inr is not null then o.price_override_inr else pl.price_inr end;   -- price is computed server-side
    if coalesce(btrim(p_coupon), '') <> '' then
      select * into cp from public.coupons where code = upper(btrim(p_coupon)) and active;
      if not found then raise exception 'That coupon code is not valid' using errcode = '22023'; end if;
      v_inr := round(v_inr * (100 - cp.percent_off) / 100.0, 2);
    end if;
  else raise exception 'Bad order kind' using errcode = '22023'; end if;
  v_rate := (app.setting('usd_per_inr') #>> '{}')::numeric;
  v_amt := case when p_currency = 'USD' then ceil(v_inr * v_rate * 100) / 100 else v_inr end;
  v_provider := case when (app.setting('gateway_mode') #>> '{}') = 'mock' then 'mock'
                     when p_currency = 'INR' then 'razorpay' else 'stripe' end;
  insert into public.transactions (org_id, kind, amount, currency, amount_inr, credits, provider, plan, coupon)
  values (v_root, p_kind, v_amt, p_currency, v_inr, case when p_kind = 'topup' then v_inr else 0 end, v_provider,
          coalesce(p_plan, ''), coalesce(cp.code, ''))
  returning * into t;
  return to_jsonb(t);
end $$;

-- applies a paid transaction exactly once; recurring affiliate commission accrues on every paid order of a referred tenant
create or replace function app.fulfill(p_txn uuid, p_ref text default '') returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare t public.transactions; o public.orgs; cp public.coupons;
begin
  select * into t from public.transactions where id = p_txn for update;
  if not found then raise exception 'Transaction not found' using errcode = 'P0002'; end if;
  if t.status = 'paid' then return; end if;
  select * into o from public.orgs where id = t.org_id for update;
  update public.transactions set status = 'paid', provider_ref = case when p_ref <> '' then p_ref else provider_ref end where id = t.id;
  if t.kind = 'topup' then update public.orgs set wallet = wallet + t.credits where id = o.id;
  elsif t.kind = 'plan' then update public.orgs set plan = t.plan where id = o.id; end if;
  if t.coupon <> '' and o.referral_coupon is null then
    update public.orgs set referral_coupon = t.coupon where id = o.id;
    update public.coupons set uses = uses + 1 where code = t.coupon;
    o.referral_coupon := t.coupon;
  end if;
  if o.referral_coupon is not null then
    select * into cp from public.coupons where code = o.referral_coupon;
    if found and t.amount_inr > 0 then
      insert into public.commissions (coupon_code, transaction_id, tenant_id, amount_inr)
      values (cp.code, t.id, o.id, round(t.amount_inr * cp.commission_percent / 100.0, 2)) on conflict do nothing;
    end if;
  end if;
end $$;

create or replace function public.mock_pay(p_txn uuid) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare t public.transactions;
begin
  perform app.assert_admin();
  select * into t from public.transactions where id = p_txn;
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.assert_org(t.org_id);
  if t.provider <> 'mock' or (app.setting('gateway_mode') #>> '{}') <> 'mock' then
    raise exception 'Test payments are disabled when a live gateway is configured' using errcode = '42501';
  end if;
  perform app.fulfill(p_txn, 'mock');
end $$;

-- ------------------------------------------------------------------ AI queue
create or replace function public.ai_policy(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare e public.events; v_root uuid; pl public.plans; o public.orgs; v_used int; v_cost int := (app.setting('ai_credits_per_run') #>> '{}')::int; v_enabled boolean;
begin
  perform app.assert_admin(); e := app.event_for(p_event); v_root := app.root_of(e.org_id);
  select * into o from public.orgs where id = v_root; pl := app.plan_of(v_root);
  v_enabled := pl.ai_enabled or 'ai' = any (app.modules_of(v_root));
  if not v_enabled then return jsonb_build_object('state', 'blocked', 'detail', 'AI backgrounds are not included in your plan.', 'cost', v_cost); end if;
  if pl.ai_free is null then return jsonb_build_object('state', 'free', 'detail', 'Unlimited AI generations with priority processing.', 'cost', 0); end if;
  select count(*) into v_used from public.ai_jobs where org_id = v_root and credits_charged = 0 and status <> 'failed' and created_at >= date_trunc('month', now());
  if v_used < pl.ai_free then
    return jsonb_build_object('state', 'free', 'detail', format('%s of %s free generations left this month.', pl.ai_free - v_used, pl.ai_free), 'cost', 0);
  end if;
  return jsonb_build_object('state', 'wallet', 'detail', format('Each generation costs %s credits (wallet: %s).', v_cost, o.wallet::numeric(12,0)), 'cost', v_cost);
end $$;

create or replace function public.request_ai_job(p_event uuid, p_prompt text) returns jsonb
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare e public.events; v_root uuid; pol jsonb; v_cost numeric; j public.ai_jobs; v_prompt text := left(btrim(coalesce(p_prompt, '')), 300);
begin
  perform app.assert_admin(); e := app.event_for(p_event); v_root := app.root_of(e.org_id);
  if length(v_prompt) < 3 then raise exception 'Describe the background you want (3+ characters)' using errcode = '22023'; end if;
  perform 1 from public.orgs where id = v_root for update;
  pol := public.ai_policy(p_event);
  if pol->>'state' = 'blocked' then raise exception '%', pol->>'detail' using errcode = '42501'; end if;
  v_cost := case when pol->>'state' = 'wallet' then (pol->>'cost')::numeric else 0 end;
  if v_cost > 0 then
    if (select wallet from public.orgs where id = v_root) < v_cost then
      raise exception 'Not enough credits: need %, top up the wallet', v_cost using errcode = '22023';
    end if;
    update public.orgs set wallet = wallet - v_cost where id = v_root;
    insert into public.transactions (org_id, kind, credits, provider, status, note) values (v_root, 'ai', -v_cost, 'wallet', 'paid', 'AI background: ' || left(v_prompt, 60));
  end if;
  insert into public.ai_jobs (org_id, event_id, prompt, orientation, priority, credits_charged)
  values (v_root, e.id, v_prompt, e.orientation, (app.plan_of(v_root)).priority, v_cost) returning * into j;
  return to_jsonb(j);
end $$;

create or replace function public.get_ai_job(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare j public.ai_jobs;
begin
  perform app.assert_admin();
  select * into j from public.ai_jobs where id = p_id;
  if not found then return null; end if;
  perform app.assert_org(j.org_id);
  return to_jsonb(j) || jsonb_build_object('queue_position',
    (select count(*) from public.ai_jobs q where q.status = 'pending' and (q.priority > j.priority or (q.priority = j.priority and q.created_at < j.created_at))));
end $$;

-- service: pick the next jobs, highest plan priority first, FIFO within a priority
create or replace function public.claim_ai_jobs(p_limit int default 1) returns jsonb
language sql volatile security definer set search_path = public, app, pg_temp as $$
  with picked as (
    select id from public.ai_jobs where status = 'pending' order by priority desc, created_at asc limit p_limit for update skip locked),
  upd as (
    update public.ai_jobs j set status = 'running' from picked where j.id = picked.id returning j.*)
  select coalesce(jsonb_agg(to_jsonb(upd) order by upd.priority desc, upd.created_at), '[]'::jsonb) from upd
$$;

-- service: finish a job. On failure the credits are refunded.
create or replace function public.complete_ai_job(p_id uuid, p_url text, p_engine text, p_error text default '') returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare j public.ai_jobs;
begin
  select * into j from public.ai_jobs where id = p_id for update;
  if not found or j.status in ('done','failed') then return; end if;
  if coalesce(p_error, '') <> '' then
    update public.ai_jobs set status = 'failed', error = left(p_error, 500) where id = p_id;
    if j.credits_charged > 0 then
      update public.orgs set wallet = wallet + j.credits_charged where id = j.org_id;
      insert into public.transactions (org_id, kind, credits, provider, status, note) values (j.org_id, 'refund', j.credits_charged, 'wallet', 'paid', 'AI job failed: refund');
    end if;
  else
    update public.ai_jobs set status = 'done', result_url = coalesce(p_url, ''), engine = coalesce(p_engine, '') where id = p_id;
  end if;
end $$;

-- ------------------------------------------------------------------ affiliate programme
create or replace function public.list_coupons() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.assert_super();
  return coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object(
      'accrued', (select coalesce(sum(amount_inr), 0) from public.commissions m where m.coupon_code = c.code and m.status = 'accrued'),
      'requested', (select coalesce(sum(amount_inr), 0) from public.commissions m where m.coupon_code = c.code and m.status = 'requested'),
      'paid', (select coalesce(sum(amount_inr), 0) from public.commissions m where m.coupon_code = c.code and m.status = 'paid')) order by c.code)
    from public.coupons c), '[]'::jsonb);
end $$;

create or replace function public.create_coupon(p_code text, p_percent int, p_affiliate text, p_commission int) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_code text := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
begin
  perform app.assert_super();
  if v_code = '' then raise exception 'Code is required' using errcode = '22023'; end if;
  insert into public.coupons (code, percent_off, affiliate_name, commission_percent) values (v_code, p_percent, coalesce(p_affiliate, ''), p_commission);
exception when unique_violation then raise exception 'That code already exists' using errcode = '23505';
end $$;

create or replace function public.toggle_coupon(p_code text) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  perform app.assert_super();
  update public.coupons set active = not active where code = upper(p_code);
end $$;

create or replace function public.mark_commissions_paid(p_code text) returns integer
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_n int;
begin
  perform app.assert_super();
  update public.commissions set status = 'paid' where coupon_code = upper(p_code) and status in ('accrued','requested');
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.my_affiliate() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare p public.profiles; c public.coupons;
begin
  perform app.assert_user();
  select * into p from public.profiles where id = auth.uid();
  if p.role <> 'affiliate' or p.coupon_code is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from public.coupons where code = p.coupon_code;
  return jsonb_build_object('coupon', to_jsonb(c),
    'referred_tenants', (select count(*) from public.orgs where referral_coupon = c.code),
    'accrued',   (select coalesce(sum(amount_inr), 0) from public.commissions where coupon_code = c.code and status = 'accrued'),
    'requested', (select coalesce(sum(amount_inr), 0) from public.commissions where coupon_code = c.code and status = 'requested'),
    'paid',      (select coalesce(sum(amount_inr), 0) from public.commissions where coupon_code = c.code and status = 'paid'),
    'recent', coalesce((select jsonb_agg(x) from (select jsonb_build_object('amount_inr', amount_inr, 'status', status, 'created_at', created_at) x
                from public.commissions where coupon_code = c.code order by created_at desc limit 20) t), '[]'::jsonb));
end $$;

create or replace function public.request_payout() returns integer
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare p public.profiles; v_n int;
begin
  perform app.assert_user();
  select * into p from public.profiles where id = auth.uid();
  if p.role <> 'affiliate' or p.coupon_code is null then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.commissions set status = 'requested' where coupon_code = p.coupon_code and status = 'accrued';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ------------------------------------------------------------------ webhooks (outbound ERP / SIS integration)
create or replace function public.add_webhook(p_org uuid, p_url text, p_events jsonb default null) returns jsonb
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_root uuid; v_secret text := 'whsec_' || encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'); w public.webhook_endpoints;
begin
  perform app.assert_admin(); v_root := app.assert_org(p_org);
  if p_url !~ '^https://' then raise exception 'Webhook URL must start with https://' using errcode = '22023'; end if;
  insert into public.webhook_endpoints (tenant_id, url, secret, events)
  values (v_root, p_url, v_secret, coalesce((select array_agg(x) from jsonb_array_elements_text(p_events) x), '{registration.created,certificate.issued,attendance.checked_in}')) returning * into w;
  return jsonb_build_object('id', w.id, 'secret', v_secret);
end $$;

create or replace function public.remove_webhook(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare w public.webhook_endpoints;
begin
  perform app.assert_admin();
  select * into w from public.webhook_endpoints where id = p_id;
  if found then perform app.assert_org(w.tenant_id); delete from public.webhook_endpoints where id = p_id; end if;
end $$;

-- ------------------------------------------------------------------ Super Admin: plans & settings
create or replace function public.update_plan(p_key text, p jsonb) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare pl public.plans;
begin
  perform app.assert_super();
  select * into pl from public.plans where key = p_key;
  if not found then raise exception 'Unknown plan' using errcode = 'P0002'; end if;
  if p ? 'name' then pl.name := btrim(p->>'name'); end if;
  if p ? 'price_inr' then pl.price_inr := (p->>'price_inr')::int; end if;
  if p ? 'quota' then pl.quota := case jsonb_typeof(p->'quota') when 'number' then (p->>'quota')::int end; end if;
  if p ? 'branches' then pl.branches := case jsonb_typeof(p->'branches') when 'number' then (p->>'branches')::int end; end if;
  if p ? 'watermark' then pl.watermark := (p->>'watermark')::boolean; end if;
  if p ? 'ai_free' then pl.ai_free := case jsonb_typeof(p->'ai_free') when 'number' then (p->>'ai_free')::int end; end if;
  if p ? 'ai_enabled' then pl.ai_enabled := (p->>'ai_enabled')::boolean; end if;
  if p ? 'modules' then
    pl.modules := (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(p->'modules') x
                   where x in ('certificates','registration','lifecycle','idpass','attendance','ai','cobrand','whitelabel'));
  end if;
  update public.plans set name = pl.name, price_inr = pl.price_inr, quota = pl.quota, branches = pl.branches,
    watermark = pl.watermark, ai_free = pl.ai_free, ai_enabled = pl.ai_enabled, modules = pl.modules where key = p_key;
end $$;

create or replace function public.update_setting(p_key text, p_value jsonb) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  perform app.assert_super();
  if p_key not in ('gateway_mode','usd_per_inr','ai_credits_per_run','overage_inr','max_cohosts','max_sponsors') then
    raise exception 'Unknown setting' using errcode = '22023';
  end if;
  if p_key = 'gateway_mode' and p_value #>> '{}' not in ('mock','live') then raise exception 'gateway_mode must be mock or live' using errcode = '22023'; end if;
  update public.app_settings set value = p_value where key = p_key;
end $$;

-- ------------------------------------------------------------------ service-role functions (Edge Functions)
create or replace function public.fulfill_transaction(p_txn uuid, p_ref text) returns void
language sql volatile security definer set search_path = public, app, pg_temp as $$ select app.fulfill(p_txn, p_ref) $$;

create or replace function public.claim_outbox(p_limit int default 25) returns jsonb
language sql volatile security definer set search_path = public, app, pg_temp as $$
  with picked as (
    select id from public.outbox where status = 'pending' and run_after <= now() order by id limit p_limit for update skip locked),
  upd as (
    update public.outbox o set status = 'sending', attempts = attempts + 1 from picked where o.id = picked.id returning o.*)
  select coalesce(jsonb_agg(to_jsonb(upd) order by upd.id), '[]'::jsonb) from upd
$$;

create or replace function public.mark_outbox(p_id bigint, p_ok boolean, p_error text default '') returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare o public.outbox;
begin
  select * into o from public.outbox where id = p_id;
  if not found then return; end if;
  if p_ok then update public.outbox set status = 'sent', last_error = '' where id = p_id;
  elsif o.attempts >= 5 then update public.outbox set status = 'failed', last_error = left(coalesce(p_error, ''), 500) where id = p_id;
  else update public.outbox set status = 'pending', last_error = left(coalesce(p_error, ''), 500),
         run_after = now() + (o.attempts * o.attempts || ' minutes')::interval where id = p_id; end if;
end $$;

create or replace function public.outbox_endpoints(p_tenant uuid, p_type text) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'url', url, 'secret', secret)), '[]'::jsonb)
  from public.webhook_endpoints where tenant_id = p_tenant and active and p_type = any (events)
$$;

create or replace function public.verify_api_key(p_key text) returns uuid
language sql stable security definer set search_path = public, app, pg_temp as $$
  select id from public.orgs where parent_id is null and active and api_key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
$$;

create or replace function public.erp_import(p_tenant uuid, p_slug text, p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare e public.events;
begin
  select * into e from public.events where slug = p_slug and app.root_of(org_id) = p_tenant;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  return app.import_regs(e, p_rows);
end $$;

create or replace function public.erp_certificates(p_tenant uuid, p_slug text) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('certificate_id', c.cert_id, 'name', c.name, 'mobile', c.mobile,
           'issued_at', c.issued_at, 'revoked', c.revoked) order by c.issued_at), '[]'::jsonb)
  from public.certificates c join public.events e on e.id = c.event_id where e.slug = p_slug and c.tenant_id = p_tenant
$$;

create or replace function public.erp_registrations(p_tenant uuid, p_slug text) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name_en', r.name_en, 'name_hi', r.name_hi, 'mobile', r.mobile,
           'institution', r.institution, 'grade', r.grade, 'approved', r.approved, 'status', r.status, 'pass_token', r.token) order by r.created_at), '[]'::jsonb)
  from public.registrations r join public.events e on e.id = r.event_id where e.slug = p_slug and app.root_of(e.org_id) = p_tenant
$$;

-- Supabase grants EXECUTE on new public functions to anon/authenticated by default. Lock the service-only ones down.
revoke execute on function public.fulfill_transaction(uuid, text) from public, anon, authenticated;
revoke execute on function public.claim_outbox(int) from public, anon, authenticated;
revoke execute on function public.mark_outbox(bigint, boolean, text) from public, anon, authenticated;
revoke execute on function public.outbox_endpoints(uuid, text) from public, anon, authenticated;
revoke execute on function public.verify_api_key(text) from public, anon, authenticated;
revoke execute on function public.erp_import(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.erp_certificates(uuid, text) from public, anon, authenticated;
revoke execute on function public.erp_registrations(uuid, text) from public, anon, authenticated;
revoke execute on function public.claim_ai_jobs(int) from public, anon, authenticated;
revoke execute on function public.complete_ai_job(uuid, text, text, text) from public, anon, authenticated;
grant  execute on function public.fulfill_transaction(uuid, text) to service_role;
grant  execute on function public.claim_outbox(int) to service_role;
grant  execute on function public.mark_outbox(bigint, boolean, text) to service_role;
grant  execute on function public.outbox_endpoints(uuid, text) to service_role;
grant  execute on function public.verify_api_key(text) to service_role;
grant  execute on function public.erp_import(uuid, text, jsonb) to service_role;
grant  execute on function public.erp_certificates(uuid, text) to service_role;
grant  execute on function public.erp_registrations(uuid, text) to service_role;
grant  execute on function public.claim_ai_jobs(int) to service_role;
grant  execute on function public.complete_ai_job(uuid, text, text, text) to service_role;

-- The `app` schema is internal: callable by definer functions and RLS policies, never exposed over the API.
revoke all on schema app from public;
grant usage on schema app to anon, authenticated, service_role;
revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to anon, authenticated, service_role;
