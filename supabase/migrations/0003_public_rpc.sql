-- Public (anon) surface. Everything here is SECURITY DEFINER and returns only what a participant may see.
-- Abuse protection (rate limiting / captcha) belongs at the edge (Supabase / CDN); see README.

create or replace function public.get_public_settings() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select jsonb_build_object(
    'overage_inr', app.setting('overage_inr'), 'ai_credits_per_run', app.setting('ai_credits_per_run'),
    'max_cohosts', app.setting('max_cohosts'), 'max_sponsors', app.setting('max_sponsors'),
    'gateway_mode', app.setting('gateway_mode'), 'usd_per_inr', app.setting('usd_per_inr'))
$$;

create or replace function public.list_plans() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(p) order by p.sort), '[]'::jsonb) from public.plans p
$$;

create or replace function public.list_open_events() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', e.slug, 'title', e.title, 'title_hi', e.title_hi,
           'mode', e.mode, 'starts_at', e.starts_at) order by e.created_at desc), '[]'::jsonb)
  from (select * from public.events where reg_open and app.has_module(app.root_of(org_id), 'registration')
        order by created_at desc limit 12) e
$$;

-- white-label: map a request host to tenant branding
create or replace function public.resolve_tenant_host(p_host text) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select jsonb_build_object('org_id', o.id, 'name', o.name, 'logo_url', o.logo_url, 'brand', o.brand)
  from public.tenant_domains d join public.orgs o on o.id = d.org_id
  where d.host = lower(p_host) and d.verified and o.active and app.has_module(o.id, 'whitelabel')
$$;

create or replace function public.get_public_event(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare e public.events; v_root uuid; r public.orgs; b public.orgs;
begin
  select * into e from public.events where slug = p_slug;
  if not found then return null; end if;
  v_root := app.root_of(e.org_id);
  select * into r from public.orgs where id = v_root;
  select * into b from public.orgs where id = e.org_id;
  return jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'slug', e.slug, 'title', e.title, 'title_hi', e.title_hi,
      'description', e.description, 'mode', e.mode, 'venue', e.venue, 'lat', e.lat, 'lng', e.lng,
      'arrival_info', e.arrival_info, 'starts_at', e.starts_at, 'reg_open', e.reg_open),
    'org', jsonb_build_object('name', r.name, 'logo_url', r.logo_url),
    'branch', case when b.id <> r.id then b.name else null end,
    'registration_enabled', app.has_module(v_root, 'registration'),
    'lifecycle', app.has_module(v_root, 'lifecycle'));
end $$;

-- shared by public registration, admin "add participant", bulk import and the ERP API
create or replace function app.insert_registration(e public.events, d jsonb, p_approved boolean) returns public.registrations
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare errs text[] := app.reg_errors(d); v_mode text; r public.registrations;
begin
  if array_length(errs, 1) is not null then raise exception '%', array_to_string(errs, '; ') using errcode = '22023'; end if;
  v_mode := case when e.mode = 'offline' then 'offline'
                 when e.mode = 'online' then 'online'
                 when d->>'attend_mode' = 'online' then 'online' else 'offline' end;
  insert into public.registrations (event_id, name_en, name_hi, parent_name, institution, grade, mobile, email, attend_mode, token, approved)
  values (e.id, app.clean(d->>'name_en'), app.clean(d->>'name_hi'), app.clean(d->>'parent_name'),
          app.clean(d->>'institution'), app.clean(d->>'grade'), app.norm_mobile(d->>'mobile'),
          btrim(coalesce(d->>'email', '')), v_mode, app.new_token('P', 10),
          coalesce(p_approved, not e.approval_required))
  on conflict (event_id, mobile, name_en) do nothing
  returning * into r;
  if r.id is null then   -- duplicate: hand back the existing registration (idempotent)
    select * into r from public.registrations
     where event_id = e.id and mobile = app.norm_mobile(d->>'mobile') and name_en = app.clean(d->>'name_en');
  else
    perform app.enqueue(app.root_of(e.org_id), 'webhook', 'registration.created',
      jsonb_build_object('event_slug', e.slug, 'registration_id', r.id, 'name', r.name_en, 'mobile', r.mobile));
    perform app.enqueue(app.root_of(e.org_id), 'notify', 'registration.confirmation',
      jsonb_build_object('event_title', e.title, 'name', r.name_en, 'mobile', r.mobile, 'email', r.email, 'token', r.token));
  end if;
  return r;
end $$;

create or replace function public.validate_registration(p_data jsonb) returns jsonb
language sql immutable security definer set search_path = public, app, pg_temp as $$
  select to_jsonb(app.reg_errors(p_data))
$$;

create or replace function public.register_participant(p_slug text, p_data jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare e public.events; r public.registrations; v_root uuid;
begin
  select * into e from public.events where slug = p_slug;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  v_root := app.root_of(e.org_id);
  if not e.reg_open or not app.has_module(v_root, 'registration') then
    raise exception 'Registration is closed for this event' using errcode = '42501';
  end if;
  r := app.insert_registration(e, p_data, null);
  return jsonb_build_object('token', r.token);
end $$;

create or replace function public.get_pass(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare r public.registrations; e public.events; v_root uuid; o public.orgs; b public.orgs; c public.certificates;
begin
  select * into r from public.registrations where token = upper(p_token);
  if not found then return null; end if;
  select * into e from public.events where id = r.event_id;
  v_root := app.root_of(e.org_id);
  select * into o from public.orgs where id = v_root;
  select * into b from public.orgs where id = e.org_id;
  select * into c from public.certificates where registration_id = r.id and not revoked order by issued_at desc limit 1;
  return jsonb_build_object(
    'registration', jsonb_build_object('name_en', r.name_en, 'name_hi', r.name_hi, 'institution', r.institution,
        'grade', r.grade, 'token', r.token, 'status', r.status, 'approved', r.approved, 'attend_mode', r.attend_mode),
    'event', jsonb_build_object('title', e.title, 'slug', e.slug, 'approval_required', e.approval_required,
        'starts_at', e.starts_at, 'venue', e.venue, 'mode', e.mode),
    'org', jsonb_build_object('name', o.name, 'logo_url', o.logo_url),
    'branch', case when b.id <> o.id then b.name else null end,
    'qr_enabled', app.has_module(v_root, 'idpass'),
    'meeting_url', case when r.attend_mode = 'online' and app.has_module(v_root, 'lifecycle') then e.meeting_url else '' end,
    'cert_id', c.cert_id);
end $$;

-- passwordless retrieval by mobile number or certificate id
create or replace function public.claim_lookup(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_q text := btrim(coalesce(p_q, '')); v_mobile text;
begin
  if upper(v_q) like 'CGM-%' then
    return coalesce((select jsonb_agg(jsonb_build_object('cert_id', c.cert_id, 'name', c.name, 'event_title', e.title, 'issued_at', c.issued_at) order by c.issued_at desc)
      from public.certificates c join public.events e on e.id = c.event_id
      where c.cert_id = upper(v_q) and not c.revoked), '[]'::jsonb);
  end if;
  v_mobile := app.norm_mobile(v_q);
  if length(v_mobile) <> 10 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('cert_id', c.cert_id, 'name', c.name, 'event_title', e.title, 'issued_at', c.issued_at) order by c.issued_at desc)
    from public.certificates c join public.events e on e.id = c.event_id
    where c.mobile = v_mobile and not c.revoked), '[]'::jsonb);
end $$;

create or replace function app.cert_unlocked(c public.certificates, e public.events) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select not e.feedback_gate or exists (select 1 from public.feedback f where f.cert_id = c.cert_id)
$$;

create or replace function public.get_certificate(p_cert_id text) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare c public.certificates; e public.events; o public.orgs;
begin
  select * into c from public.certificates where cert_id = upper(p_cert_id) and not revoked;
  if not found then return null; end if;
  select * into e from public.events where id = c.event_id;
  select * into o from public.orgs where id = app.root_of(e.org_id);
  return jsonb_build_object('cert_id', c.cert_id, 'name', c.name, 'issued_at', c.issued_at,
    'event_title', e.title, 'org', o.name, 'unlocked', app.cert_unlocked(c, e), 'feedback_gate', e.feedback_gate);
end $$;

create or replace function public.submit_feedback(p_cert_id text, p_rating int, p_comment text) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Rating must be 1-5' using errcode = '22023'; end if;
  if not exists (select 1 from public.certificates where cert_id = upper(p_cert_id) and not revoked) then
    raise exception 'Certificate not found' using errcode = 'P0002';
  end if;
  insert into public.feedback (cert_id, rating, comment) values (upper(p_cert_id), p_rating, left(coalesce(p_comment, ''), 1000))
  on conflict (cert_id) do nothing;
end $$;

-- Everything the client-side renderer needs. Withheld until the feedback gate is satisfied.
create or replace function public.get_certificate_render(p_cert_id text) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare c public.certificates; e public.events; r public.registrations; o public.orgs; b public.orgs;
begin
  select * into c from public.certificates where cert_id = upper(p_cert_id) and not revoked;
  if not found then return null; end if;
  select * into e from public.events where id = c.event_id;
  if not app.cert_unlocked(c, e) then raise exception 'locked' using errcode = '42501'; end if;
  select * into r from public.registrations where id = c.registration_id;
  select * into o from public.orgs where id = app.root_of(e.org_id);
  select * into b from public.orgs where id = e.org_id;
  return jsonb_build_object(
    'cert_id', c.cert_id, 'issued_at', c.issued_at,
    'event', to_jsonb(e) - 'meeting_url' - 'org_id',
    'person', jsonb_build_object('name_en', r.name_en, 'name_hi', r.name_hi, 'grade', r.grade, 'institution', r.institution),
    'org', jsonb_build_object('name', o.name, 'logo_url', o.logo_url),
    'branch', case when b.id <> o.id then b.name else null end,
    'watermark', (app.plan_of(o.id)).watermark and not coalesce((o.brand->>'hide_branding')::boolean, false));
end $$;

create or replace function public.verify_certificate(p_cert_id text) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare c public.certificates; e public.events; r public.registrations; o public.orgs; b public.orgs;
begin
  select * into c from public.certificates where cert_id = upper(btrim(p_cert_id));
  if not found then return jsonb_build_object('status', 'not_found', 'cert_id', upper(btrim(p_cert_id))); end if;
  select * into e from public.events where id = c.event_id;
  select * into r from public.registrations where id = c.registration_id;
  select * into o from public.orgs where id = app.root_of(e.org_id);
  select * into b from public.orgs where id = e.org_id;
  return jsonb_build_object('status', case when c.revoked then 'revoked' else 'valid' end,
    'cert_id', c.cert_id, 'name', r.name_en, 'name_hi', r.name_hi, 'event_title', e.title,
    'org', o.name, 'branch', case when b.id <> o.id then b.name else null end, 'issued_at', c.issued_at);
end $$;
