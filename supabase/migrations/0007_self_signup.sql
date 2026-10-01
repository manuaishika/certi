-- Self-service onboarding: anyone with a Supabase Auth login (no profile yet) can create their own organisation
-- on the Free plan. Everything an organisation can then do is already bounded by its plan (quota, modules).
-- Optional referral code attributes the new organisation to an affiliate (recurring commission).
create or replace function public.create_my_tenant(p_org_name text, p_name text default '', p_email text default '', p_ref text default '') returns jsonb
language plpgsql volatile security definer set search_path = public, app, pg_temp as $$
declare v_uid uuid := auth.uid(); v_email text; v_org uuid; v_ref text := nullif(upper(btrim(coalesce(p_ref, ''))), '');
begin
  if v_uid is null then raise exception 'unauthorized' using errcode = '28000'; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'You already have an account. Please log in.' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_org_name, ''))) < 2 then raise exception 'Enter your organisation name' using errcode = '22023'; end if;
  -- the e-mail comes from the verified login token whenever there is one; the parameter is only the fallback (demo mode)
  v_email := lower(btrim(coalesce(nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'email', ''), p_email, '')));
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'A valid email is required' using errcode = '22023'; end if;
  if v_ref is not null and not exists (select 1 from public.coupons where code = v_ref and active) then v_ref := null; end if;

  insert into public.orgs (name, plan, referral_coupon) values (btrim(p_org_name), 'free', v_ref) returning id into v_org;
  insert into public.profiles (id, email, name, role, org_id) values (v_uid, v_email, left(btrim(coalesce(p_name, '')), 80), 'org_admin', v_org);
  if v_ref is not null then update public.coupons set uses = uses + 1 where code = v_ref; end if;
  return jsonb_build_object('org_id', v_org);
exception when unique_violation then
  raise exception 'That email is already registered. Please log in.' using errcode = '23505';
end $$;
