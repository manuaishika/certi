-- Authenticated console RPCs: tenants, branches, events, registrations, issuing, check-in.
-- Every function re-checks the caller (SECURITY DEFINER bypasses RLS, so authorisation is explicit).

-- ------------------------------------------------------------------ identity / overview
create or replace function public.get_me() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare p public.profiles; v_root uuid; o public.orgs; pl public.plans;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found then return null; end if;
  if p.org_id is not null then
    v_root := app.root_of(p.org_id);
    select * into o from public.orgs where id = v_root;
    select * into pl from public.plans where key = o.plan;
  end if;
  return jsonb_build_object(
    'profile', to_jsonb(p),
    'tenant', case when v_root is null then null else jsonb_build_object(
      'id', o.id, 'name', o.name, 'logo_url', o.logo_url, 'plan', o.plan, 'plan_name', pl.name,
      'modules', app.modules_of(v_root), 'wallet', o.wallet, 'quota', app.quota_of(v_root),
      'used', app.issued_count(v_root), 'branch_allowance', pl.branches,
      'branches', app.branch_count(v_root), 'brand', o.brand, 'watermark', pl.watermark) end);
end $$;

create or replace function public.dashboard() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_root uuid;
begin
  perform app.assert_admin();
  if app.is_super() then
    return jsonb_build_object('scope', 'platform',
      'tenants', (select count(*) from public.orgs where parent_id is null),
      'events', (select count(*) from public.events),
      'registrations', (select count(*) from public.registrations),
      'certificates', (select count(*) from public.certificates),
      'revenue_inr', (select coalesce(sum(amount_inr), 0) from public.transactions where status = 'paid' and kind in ('topup','plan')),
      'tenant_list', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'plan', o.plan, 'wallet', o.wallet) order by o.created_at), '[]'::jsonb)
                      from public.orgs o where o.parent_id is null));
  end if;
  v_root := app.tenant();
  return jsonb_build_object('scope', 'tenant',
    'events', (select count(*) from public.events e where app.root_of(e.org_id) = v_root),
    'registrations', (select count(*) from public.registrations r join public.events e on e.id = r.event_id where app.root_of(e.org_id) = v_root),
    'certificates', (select count(*) from public.certificates where tenant_id = v_root and not revoked));
end $$;

-- ------------------------------------------------------------------ organisations
create or replace function public.list_orgs() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.assert_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'root', to_jsonb(o) - 'api_key_hash',
      'plan_name', (select name from public.plans where key = o.plan),
      'branches', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'logo_url', b.logo_url) order by b.created_at)
                            from public.orgs b where b.parent_id = o.id), '[]'::jsonb),
      'users', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'role', u.role, 'name', u.name) order by u.email)
                         from public.profiles u where u.org_id = o.id), '[]'::jsonb),
      'domains', coalesce((select jsonb_agg(jsonb_build_object('host', d.host, 'verified', d.verified)) from public.tenant_domains d where d.org_id = o.id), '[]'::jsonb),
      'modules', app.modules_of(o.id), 'quota', app.quota_of(o.id), 'used', app.issued_count(o.id),
      'allowance', (select branches from public.plans where key = o.plan),
      'webhooks', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'url', w.url, 'events', w.events, 'active', w.active)) from public.webhook_endpoints w where w.tenant_id = o.id), '[]'::jsonb)
    ) order by o.created_at)
    from public.orgs o where o.parent_id is null and app.can_access_org(o.id)), '[]'::jsonb);
end $$;

create or replace function public.list_org_options() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.assert_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'is_branch', o.parent_id is not null)
                                    order by coalesce(o.parent_id, o.id), o.parent_id nulls first, o.name)
                   from public.orgs o where o.active and app.can_access_org(o.id)), '[]'::jsonb);
end $$;

create or replace function public.create_tenant(p_name text, p_plan text default 'free') returns uuid
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_id uuid;
begin
  perform app.assert_super();
  insert into public.orgs (name, plan) values (btrim(p_name), coalesce(p_plan, 'free')) returning id into v_id;
  return v_id;
end $$;

create or replace function public.add_branch(p_parent uuid, p_name text) returns uuid
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_root uuid; v_allow int; v_id uuid;
begin
  perform app.assert_admin();
  v_root := app.assert_org(p_parent);
  select branches into v_allow from public.plans where key = (select plan from public.orgs where id = v_root);
  if not app.is_super() and v_allow is not null and app.branch_count(v_root) >= v_allow then
    raise exception 'Your plan allows % branch(es). Upgrade to add more.', v_allow using errcode = '42501';
  end if;
  insert into public.orgs (name, parent_id) values (btrim(p_name), v_root) returning id into v_id;
  return v_id;
end $$;

create or replace function public.set_org_logo(p_org uuid, p_url text) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  perform app.assert_admin(); perform app.assert_org(p_org);
  update public.orgs set logo_url = coalesce(p_url, '') where id = p_org;
end $$;

-- Super Admin: plan, overrides, modules, wallet adjustments, activation
create or replace function public.update_tenant_settings(p_org uuid, p jsonb) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare o public.orgs; v_adj numeric;
begin
  perform app.assert_super();
  select * into o from public.orgs where id = p_org and parent_id is null;
  if not found then raise exception 'Tenant not found' using errcode = 'P0002'; end if;
  if p ? 'plan' then
    if not exists (select 1 from public.plans where key = p->>'plan') then raise exception 'Unknown plan' using errcode = '22023'; end if;
    o.plan := p->>'plan';
  end if;
  if p ? 'quota_override' then o.quota_override := case jsonb_typeof(p->'quota_override') when 'number' then (p->>'quota_override')::int end; end if;
  if p ? 'price_override_inr' then o.price_override_inr := case jsonb_typeof(p->'price_override_inr') when 'number' then (p->>'price_override_inr')::int end; end if;
  if p ? 'modules_override' then
    o.modules_override := case jsonb_typeof(p->'modules_override')
      when 'array' then (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(p->'modules_override') x
                         where x in ('certificates','registration','lifecycle','idpass','attendance','ai','cobrand','whitelabel')) end;
  end if;
  if p ? 'active' then o.active := (p->>'active')::boolean; end if;
  if p ? 'brand' then o.brand := p->'brand'; end if;
  v_adj := coalesce((p->>'wallet_adjust')::numeric, 0);
  if v_adj <> 0 then
    if o.wallet + v_adj < 0 then raise exception 'Wallet cannot go negative' using errcode = '22023'; end if;
    o.wallet := o.wallet + v_adj;
    insert into public.transactions (org_id, kind, credits, provider, status, note)
    values (o.id, 'adjustment', v_adj, 'manual', 'paid', 'Manual adjustment by ' || (select email from public.profiles where id = auth.uid()));
  end if;
  update public.orgs set plan = o.plan, quota_override = o.quota_override, price_override_inr = o.price_override_inr,
         modules_override = o.modules_override, active = o.active, brand = o.brand, wallet = o.wallet where id = o.id;
end $$;

-- Tenant admins may edit their own white-label branding when the module is enabled
create or replace function public.update_brand(p_org uuid, p_brand jsonb) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_root uuid;
begin
  perform app.assert_admin(); v_root := app.assert_org(p_org);
  if not app.has_module(v_root, 'whitelabel') then raise exception 'White-label is an Enterprise feature' using errcode = '42501'; end if;
  update public.orgs set brand = jsonb_build_object(
      'app_name', left(coalesce(p_brand->>'app_name', ''), 60),
      'color', case when p_brand->>'color' ~ '^#[0-9a-fA-F]{6}$' then p_brand->>'color' else '' end,
      'hide_branding', coalesce((p_brand->>'hide_branding')::boolean, false))
   where id = v_root;
end $$;

create or replace function public.add_domain(p_org uuid, p_host text) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_root uuid; v_host text := lower(btrim(p_host));
begin
  perform app.assert_admin(); v_root := app.assert_org(p_org);
  if not app.has_module(v_root, 'whitelabel') then raise exception 'Custom domains are an Enterprise feature' using errcode = '42501'; end if;
  if v_host !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$' then raise exception 'Enter a valid hostname' using errcode = '22023'; end if;
  insert into public.tenant_domains (host, org_id, verified) values (v_host, v_root, app.is_super());
exception when unique_violation then raise exception 'That domain is already mapped' using errcode = '23505';
end $$;

create or replace function public.set_domain_verified(p_host text, p_verified boolean) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  perform app.assert_super();
  update public.tenant_domains set verified = p_verified where host = lower(p_host);
end $$;

create or replace function public.remove_domain(p_host text) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare d public.tenant_domains;
begin
  perform app.assert_admin();
  select * into d from public.tenant_domains where host = lower(p_host);
  if found then perform app.assert_org(d.org_id); delete from public.tenant_domains where host = d.host; end if;
end $$;

create or replace function public.rotate_api_key(p_org uuid) returns text
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_root uuid; v_key text := 'cgm_' || encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex');
begin
  perform app.assert_admin(); v_root := app.assert_org(p_org);
  update public.orgs set api_key_hash = encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), api_key_prefix = left(v_key, 8) where id = v_root;
  return v_key;   -- shown once; only the hash is stored
end $$;

-- ------------------------------------------------------------------ events
create or replace function app.slugify(p_title text) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_base text := trim(both '-' from regexp_replace(lower(p_title), '[^a-z0-9]+', '-', 'g')); v_slug text; v_n int := 1;
begin
  if v_base = '' then v_base := 'event'; end if;
  v_slug := v_base;
  while exists (select 1 from public.events where slug = v_slug) loop v_n := v_n + 1; v_slug := v_base || '-' || v_n; end loop;
  return v_slug;
end $$;

create or replace function app.apply_event(e public.events, p jsonb) returns public.events
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_root uuid := app.root_of(e.org_id);
begin
  if p ? 'title' then e.title := btrim(p->>'title'); end if;
  if p ? 'title_hi' then e.title_hi := btrim(p->>'title_hi'); end if;
  if p ? 'description' then e.description := coalesce(p->>'description', ''); end if;
  if p ? 'venue' then e.venue := coalesce(p->>'venue', ''); end if;
  if p ? 'arrival_info' then e.arrival_info := coalesce(p->>'arrival_info', ''); end if;
  if p ? 'cert_title' and btrim(coalesce(p->>'cert_title','')) <> '' then e.cert_title := btrim(p->>'cert_title'); end if;
  if p ? 'cert_body' and btrim(coalesce(p->>'cert_body','')) <> '' then e.cert_body := btrim(p->>'cert_body'); end if;
  if p ? 'signatory' then e.signatory := btrim(coalesce(p->>'signatory', '')); end if;
  if p ? 'signatory_role' then e.signatory_role := btrim(coalesce(p->>'signatory_role', '')); end if;
  if p ? 'sponsor_label' and btrim(coalesce(p->>'sponsor_label','')) <> '' then e.sponsor_label := btrim(p->>'sponsor_label'); end if;
  if p ? 'mode' then
    e.mode := case when app.has_module(v_root, 'lifecycle') and p->>'mode' in ('offline','online','hybrid') then p->>'mode' else 'offline' end;
  end if;
  if p ? 'meeting_url' then e.meeting_url := case when app.has_module(v_root, 'lifecycle') then btrim(coalesce(p->>'meeting_url','')) else '' end; end if;
  if p ? 'lat' then e.lat := nullif(p->>'lat', '')::double precision; end if;
  if p ? 'lng' then e.lng := nullif(p->>'lng', '')::double precision; end if;
  if p ? 'starts_at' then e.starts_at := nullif(p->>'starts_at', '')::timestamptz; end if;
  if p ? 'orientation' and p->>'orientation' in ('landscape','portrait') and p->>'orientation' <> e.orientation then
    e.orientation := p->>'orientation'; e.layout := '{}'::jsonb;
  end if;
  if p ? 'gate_attendance' then e.gate_attendance := (p->>'gate_attendance')::boolean and app.has_module(v_root, 'attendance'); end if;
  if p ? 'feedback_gate' then e.feedback_gate := (p->>'feedback_gate')::boolean; end if;
  if p ? 'approval_required' then e.approval_required := (p->>'approval_required')::boolean; end if;
  if p ? 'reg_open' then e.reg_open := (p->>'reg_open')::boolean; end if;
  return e;
end $$;

create or replace function public.create_event(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare e public.events; v_org uuid := (p->>'org_id')::uuid;
begin
  perform app.assert_admin(); perform app.assert_org(v_org);
  if length(btrim(coalesce(p->>'title', ''))) < 2 then raise exception 'Title is required' using errcode = '22023'; end if;
  e.id := gen_random_uuid(); e.org_id := v_org; e.title := btrim(p->>'title');
  e.slug := app.slugify(e.title);
  e.mode := 'offline'; e.title_hi := ''; e.description := ''; e.venue := ''; e.arrival_info := ''; e.meeting_url := '';
  e.reg_open := true; e.orientation := 'landscape'; e.template := 'classic'; e.bg_url := ''; e.accent := '#1e3a8a';
  e.cert_title := 'Certificate of Participation'; e.cert_body := 'for actively participating in {event} held on {date}.';
  e.signatory := ''; e.signatory_role := ''; e.layout := '{}'; e.cohosts := '[]'; e.sponsors := '[]'; e.sponsor_label := 'Supported By';
  e.gate_attendance := false; e.feedback_gate := true; e.approval_required := true; e.created_at := now();
  e := app.apply_event(e, p);
  insert into public.events select e.*;
  return e.id;
end $$;

create or replace function public.update_event(p_event uuid, p jsonb) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare e public.events;
begin
  perform app.assert_admin();
  e := app.apply_event(app.event_for(p_event), p);
  update public.events set title = e.title, title_hi = e.title_hi, description = e.description, venue = e.venue,
    arrival_info = e.arrival_info, cert_title = e.cert_title, cert_body = e.cert_body, signatory = e.signatory,
    signatory_role = e.signatory_role, sponsor_label = e.sponsor_label, mode = e.mode, meeting_url = e.meeting_url,
    lat = e.lat, lng = e.lng, starts_at = e.starts_at, orientation = e.orientation, layout = e.layout,
    gate_attendance = e.gate_attendance, feedback_gate = e.feedback_gate, approval_required = e.approval_required,
    reg_open = e.reg_open where id = p_event;
end $$;

create or replace function public.list_events() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  perform app.assert_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'slug', e.slug, 'mode', e.mode,
        'starts_at', e.starts_at, 'regs', (select count(*) from public.registrations r where r.event_id = e.id),
        'certs', (select count(*) from public.certificates c where c.event_id = e.id and not c.revoked)) order by e.created_at desc)
      from public.events e where app.can_access_org(e.org_id)), '[]'::jsonb);
end $$;

create or replace function public.get_event_admin(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare e public.events; v_root uuid; o public.orgs; b public.orgs;
begin
  perform app.assert_admin();
  e := app.event_for(p_event); v_root := app.root_of(e.org_id);
  select * into o from public.orgs where id = v_root;
  select * into b from public.orgs where id = e.org_id;
  return jsonb_build_object('event', to_jsonb(e),
    'root', jsonb_build_object('id', o.id, 'name', o.name, 'logo_url', o.logo_url, 'plan', o.plan, 'wallet', o.wallet),
    'branch', case when b.id <> o.id then b.name else null end,
    'modules', app.modules_of(v_root), 'remaining', app.remaining(v_root, e.id),
    'watermark', (app.plan_of(v_root)).watermark,
    'feedback', jsonb_build_object(
        'count', (select count(*) from public.feedback f join public.certificates c on c.cert_id = f.cert_id where c.event_id = e.id),
        'avg', (select round(avg(f.rating), 2) from public.feedback f join public.certificates c on c.cert_id = f.cert_id where c.event_id = e.id),
        'recent', coalesce((select jsonb_agg(x) from (select jsonb_build_object('rating', f.rating, 'comment', f.comment) x
                    from public.feedback f join public.certificates c on c.cert_id = f.cert_id where c.event_id = e.id order by f.created_at desc limit 8) t), '[]'::jsonb)));
end $$;

create or replace function public.save_layout(p_event uuid, p_layout jsonb) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_clean jsonb := '{}'; f text; k text; v jsonb; v_field jsonb;
begin
  perform app.assert_admin(); perform app.event_for(p_event);
  for f in select jsonb_object_keys(coalesce(p_layout, '{}')) loop
    if f in ('org','branch','cohosts','title','certify','name','name_hi','body','grade','date','signature','qr','sponsors','id') then
      v_field := '{}';
      for k in select unnest(array['x','y','size']) loop
        v := p_layout->f->k;
        if jsonb_typeof(v) = 'number' then v_field := v_field || jsonb_build_object(k, least(1, greatest(0, (v #>> '{}')::numeric))); end if;
      end loop;
      v_clean := v_clean || jsonb_build_object(f, v_field);
    end if;
  end loop;
  update public.events set layout = v_clean where id = p_event;
end $$;

create or replace function public.set_event_style(p_event uuid, p_template text, p_accent text, p_orientation text) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare e public.events;
begin
  perform app.assert_admin(); e := app.event_for(p_event);
  if p_accent !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Bad colour' using errcode = '22023'; end if;
  if p_template in ('classic','modern','tricolour') then e.template := p_template; e.bg_url := ''; end if;
  if p_orientation in ('landscape','portrait') and p_orientation <> e.orientation then
    e.orientation := p_orientation; e.layout := '{}';
    if e.template = 'custom' then e.template := 'classic'; e.bg_url := ''; end if;
  end if;
  update public.events set template = e.template, bg_url = e.bg_url, accent = p_accent, orientation = e.orientation, layout = e.layout where id = p_event;
end $$;

create or replace function public.set_event_background(p_event uuid, p_url text) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  perform app.assert_admin(); perform app.event_for(p_event);
  update public.events set bg_url = coalesce(p_url, ''), template = case when coalesce(p_url, '') = '' then 'classic' else 'custom' end where id = p_event;
end $$;

create or replace function public.add_brand(p_event uuid, p_kind text, p_name text, p_logo text) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare e public.events; v_root uuid; v_limit int; v_cur jsonb;
begin
  perform app.assert_admin(); e := app.event_for(p_event); v_root := app.root_of(e.org_id);
  if not app.has_module(v_root, 'cobrand') then raise exception 'Co-hosts and sponsors need the Institutional Pro plan or higher' using errcode = '42501'; end if;
  if p_kind not in ('cohost','sponsor') then raise exception 'Bad kind' using errcode = '22023'; end if;
  v_cur := case p_kind when 'cohost' then e.cohosts else e.sponsors end;
  v_limit := (app.setting(case p_kind when 'cohost' then 'max_cohosts' else 'max_sponsors' end) #>> '{}')::int;
  if jsonb_array_length(v_cur) >= v_limit then raise exception 'Limit reached: % per event', v_limit using errcode = '22023'; end if;
  v_cur := v_cur || jsonb_build_array(jsonb_build_object('name', btrim(p_name), 'logo', coalesce(p_logo, '')));
  if p_kind = 'cohost' then update public.events set cohosts = v_cur, layout = layout where id = p_event;
  else update public.events set sponsors = v_cur where id = p_event; end if;
end $$;

create or replace function public.remove_brand(p_event uuid, p_kind text, p_idx int) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare e public.events; v_new jsonb;
begin
  perform app.assert_admin(); e := app.event_for(p_event);
  v_new := coalesce((select jsonb_agg(x order by ord) from jsonb_array_elements(case p_kind when 'cohost' then e.cohosts else e.sponsors end) with ordinality t(x, ord) where ord - 1 <> p_idx), '[]'::jsonb);
  if p_kind = 'cohost' then update public.events set cohosts = v_new where id = p_event;
  else update public.events set sponsors = v_new where id = p_event; end if;
end $$;

-- ------------------------------------------------------------------ registrations
create or replace function public.list_registrations(p_event uuid, p_q text default '') returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare e public.events; v_q text := lower(btrim(coalesce(p_q, '')));
begin
  perform app.assert_admin(); e := app.event_for(p_event);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name_en', r.name_en, 'name_hi', r.name_hi, 'institution', r.institution, 'grade', r.grade,
      'mobile', r.mobile, 'email', r.email, 'parent_name', r.parent_name, 'attend_mode', r.attend_mode, 'token', r.token,
      'status', r.status, 'approved', r.approved, 'cert_id', c.cert_id, 'cert_revoked', c.revoked) order by r.created_at, r.id)
    from public.registrations r
    left join lateral (select cert_id, revoked from public.certificates where registration_id = r.id order by issued_at desc limit 1) c on true
    where r.event_id = e.id and (v_q = '' or lower(r.name_en) like '%' || v_q || '%' or r.mobile like '%' || v_q || '%' or lower(r.institution) like '%' || v_q || '%')), '[]'::jsonb);
end $$;

create or replace function public.update_registration(p_id uuid, p_field text, p_value text) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare r public.registrations; v_val text; v_trial jsonb; errs text[];
begin
  perform app.assert_admin();
  select * into r from public.registrations where id = p_id;
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.event_for(r.event_id);
  if p_field not in ('name_en','name_hi','institution','grade','mobile','email','parent_name') then raise exception 'Bad field' using errcode = '22023'; end if;
  v_val := case p_field when 'mobile' then app.norm_mobile(p_value) else app.clean(p_value) end;
  v_trial := jsonb_build_object('name_en', r.name_en, 'name_hi', r.name_hi, 'mobile', r.mobile, 'email', r.email) || jsonb_build_object(p_field, v_val);
  errs := app.reg_errors(v_trial);
  if array_length(errs, 1) is not null then raise exception '%', array_to_string(errs, '; ') using errcode = '22023'; end if;
  execute format('update public.registrations set %I = $1 where id = $2', p_field) using v_val, p_id;
  -- corrections flow into already-issued certificates (they render from live data)
  update public.certificates c set name = r2.name_en, mobile = r2.mobile from public.registrations r2 where r2.id = p_id and c.registration_id = r2.id;
end $$;

create or replace function public.toggle_registration(p_id uuid, p_what text) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare r public.registrations;
begin
  perform app.assert_admin();
  select * into r from public.registrations where id = p_id;
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.event_for(r.event_id);
  if p_what = 'approved' then update public.registrations set approved = not approved where id = p_id;
  elsif p_what = 'present' then
    update public.registrations set status = case when status = 'present' then 'registered' else 'present' end,
      checked_in_at = case when status = 'present' then null else now() end where id = p_id;
  else raise exception 'Bad toggle' using errcode = '22023'; end if;
end $$;

create or replace function public.delete_registration(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare r public.registrations;
begin
  perform app.assert_admin();
  select * into r from public.registrations where id = p_id;
  if not found then return; end if;
  perform app.event_for(r.event_id);
  if exists (select 1 from public.certificates where registration_id = p_id) then
    raise exception 'Certificate already issued: revoke it first' using errcode = '23503';
  end if;
  delete from public.registrations where id = p_id;
end $$;

create or replace function public.add_registration(p_event uuid, p_data jsonb) returns void
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare e public.events;
begin
  perform app.assert_admin(); e := app.event_for(p_event);
  perform app.insert_registration(e, p_data, true);
end $$;

create or replace function app.import_regs(e public.events, p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_row jsonb; v_i int := 1; v_created int := 0; v_errors jsonb := '[]'; errs text[];
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_i := v_i + 1;
    errs := app.reg_errors(v_row);
    if array_length(errs, 1) is not null then
      v_errors := v_errors || to_jsonb('Row ' || v_i || ': ' || array_to_string(errs, '; '));
    else
      perform app.insert_registration(e, v_row, true);
      v_created := v_created + 1;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'errors', v_errors);
end $$;

create or replace function public.import_registrations(p_event uuid, p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
begin
  perform app.assert_admin();
  if jsonb_array_length(coalesce(p_rows, '[]')) > 5000 then raise exception 'Import at most 5000 rows at a time' using errcode = '22023'; end if;
  return app.import_regs(app.event_for(p_event), p_rows);
end $$;

create or replace function public.approve_all(p_event uuid) returns integer
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_n int;
begin
  perform app.assert_admin(); perform app.event_for(p_event);
  update public.registrations set approved = true where event_id = p_event and not approved;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ------------------------------------------------------------------ issuing
create or replace function public.issue_certificates(p_event uuid, p_notify boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare e public.events; v_root uuid; v_rem int; r public.registrations; v_issued int := 0; v_skipped jsonb := '[]';
        v_blocked text := ''; v_over numeric := 0; v_fee numeric := (app.setting('overage_inr') #>> '{}')::numeric;
        v_wallet numeric; v_is_over boolean; v_cid text;
begin
  perform app.assert_admin();
  e := app.event_for(p_event); v_root := app.root_of(e.org_id);
  if not app.has_module(v_root, 'certificates') then
    return jsonb_build_object('issued', 0, 'skipped', '[]'::jsonb, 'blocked', 'The certificate module is disabled for this organisation.', 'overage', 0);
  end if;
  select wallet into v_wallet from public.orgs where id = v_root for update;   -- serialise concurrent issuing
  v_rem := app.remaining(v_root, e.id);
  for r in select * from public.registrations where event_id = e.id order by created_at, id loop
    continue when exists (select 1 from public.certificates c where c.registration_id = r.id and not c.revoked);
    if e.approval_required and not r.approved then v_skipped := v_skipped || to_jsonb(r.name_en || ': not approved'); continue; end if;
    if e.gate_attendance and r.status <> 'present' then v_skipped := v_skipped || to_jsonb(r.name_en || ': not marked present'); continue; end if;
    v_is_over := v_rem is not null and v_rem <= 0;
    if v_is_over then
      if v_wallet < v_fee then
        v_blocked := format('Quota reached and wallet balance is too low for overage (Rs %s per certificate). Top up the wallet or upgrade the plan.', v_fee);
        exit;
      end if;
      v_wallet := v_wallet - v_fee; v_over := v_over + v_fee;
    elsif v_rem is not null then v_rem := v_rem - 1; end if;
    v_cid := app.new_token('CGM-', 10);
    insert into public.certificates (cert_id, event_id, registration_id, tenant_id, name, mobile, overage)
    values (v_cid, e.id, r.id, v_root, r.name_en, r.mobile, v_is_over);
    perform app.enqueue(v_root, 'webhook', 'certificate.issued',
      jsonb_build_object('event_slug', e.slug, 'certificate_id', v_cid, 'name', r.name_en, 'mobile', r.mobile));
    if p_notify then
      perform app.enqueue(v_root, 'notify', 'certificate.ready',
        jsonb_build_object('event_title', e.title, 'name', r.name_en, 'mobile', r.mobile, 'email', r.email, 'cert_id', v_cid));
    end if;
    v_issued := v_issued + 1;
  end loop;
  if v_over > 0 then
    update public.orgs set wallet = v_wallet where id = v_root;
    insert into public.transactions (org_id, kind, amount, amount_inr, credits, provider, status, note)
    values (v_root, 'overage', v_over, v_over, -v_over, 'wallet', 'paid', 'Overage for event ' || e.title);
  end if;
  return jsonb_build_object('issued', v_issued, 'skipped', v_skipped, 'blocked', v_blocked, 'overage', v_over);
end $$;

create or replace function public.revoke_certificate(p_cert_id text) returns boolean
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare c public.certificates;
begin
  perform app.assert_admin();
  select * into c from public.certificates where cert_id = upper(p_cert_id);
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.assert_org(c.tenant_id);
  update public.certificates set revoked = not revoked where id = c.id;
  return not c.revoked;
end $$;

-- ------------------------------------------------------------------ gate check-in (volunteers allowed)
create or replace function public.checkin(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare r public.registrations; e public.events; v_root uuid; v_already boolean;
begin
  perform app.assert_user();
  if app.role() = 'affiliate' then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from public.registrations where token = upper(btrim(p_token));
  if not found then return jsonb_build_object('ok', false, 'message', 'Unknown pass'); end if;
  select * into e from public.events where id = r.event_id;
  v_root := app.assert_org(e.org_id);
  if not app.is_super() and not app.has_module(v_root, 'attendance') then
    return jsonb_build_object('ok', false, 'message', 'QR attendance is not enabled for this organisation');
  end if;
  v_already := r.status = 'present';
  if not v_already then
    update public.registrations set status = 'present', checked_in_at = now() where id = r.id;
    perform app.enqueue(v_root, 'webhook', 'attendance.checked_in',
      jsonb_build_object('event_slug', e.slug, 'registration_id', r.id, 'name', r.name_en));
  end if;
  return jsonb_build_object('ok', true, 'already', v_already, 'name', r.name_en, 'event', e.title, 'approved', r.approved,
    'mode', r.attend_mode, 'message', case when v_already then 'Already checked in' else 'Welcome!' end);
end $$;
