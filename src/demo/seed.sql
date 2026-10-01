-- DEMO DATA ONLY (PGlite). Production bootstraps its first Super Admin through Supabase Auth, see README.
create table public.dev_users (email text primary key, password text not null, profile_id uuid not null);

insert into public.orgs (id, name, plan, wallet, api_key_hash, api_key_prefix) values
 ('a0000000-0000-0000-0000-000000000001', 'Greenfield Public Schools', 'pro', 200, encode(sha256(convert_to('cgm_demo_pro_key', 'UTF8')), 'hex'), 'cgm_demo'),
 ('a0000000-0000-0000-0000-000000000003', 'Olympiad Academy Group', 'enterprise', 500, encode(sha256(convert_to('cgm_demo_ent_key', 'UTF8')), 'hex'), 'cgm_demo'),
 ('a0000000-0000-0000-0000-000000000004', 'Community Trust', 'free', 0, null, null);
insert into public.orgs (id, name, parent_id) values
 ('a0000000-0000-0000-0000-000000000002', 'City Girls College Campus', 'a0000000-0000-0000-0000-000000000001');

update public.orgs set brand = '{"app_name":"Olympiad Certs","color":"#7c3aed","hide_branding":true}'
 where id = 'a0000000-0000-0000-0000-000000000003';
insert into public.tenant_domains (host, org_id, verified) values ('olympiad.localhost', 'a0000000-0000-0000-0000-000000000003', true);

insert into public.profiles (id, email, name, role, org_id, coupon_code) values
 ('b0000000-0000-0000-0000-000000000001', 'admin@cergema.local',      'Super Admin',   'super',     null, null),
 ('b0000000-0000-0000-0000-000000000002', 'demo@cergema.local',       'Demo Admin',    'org_admin', 'a0000000-0000-0000-0000-000000000001', null),
 ('b0000000-0000-0000-0000-000000000003', 'enterprise@cergema.local', 'Olympiad Admin','org_admin', 'a0000000-0000-0000-0000-000000000003', null),
 ('b0000000-0000-0000-0000-000000000004', 'volunteer@cergema.local',  'Gate Volunteer','volunteer', 'a0000000-0000-0000-0000-000000000003', null),
 ('b0000000-0000-0000-0000-000000000005', 'free@cergema.local',       'Trust Admin',   'org_admin', 'a0000000-0000-0000-0000-000000000004', null),
 ('b0000000-0000-0000-0000-000000000006', 'partner@cergema.local',    'Demo Consultant','affiliate', null, 'PARTNER20');
insert into public.dev_users select email, 'admin123', id from public.profiles where role = 'super';
insert into public.dev_users select email, 'demo123', id from public.profiles where role <> 'super';

insert into public.coupons (code, percent_off, affiliate_name, commission_percent) values ('PARTNER20', 10, 'Demo Consultant', 25);

insert into public.events (id, org_id, title, title_hi, slug, description, mode, venue, meeting_url, starts_at, template, accent,
    signatory, signatory_role, cert_title, cohosts, sponsors, lat, lng, arrival_info) values
 ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'Annual Language Day 2026', 'वार्षिक भाषा दिवस 2026',
  'annual-language-day-2026', E'A native-language recognition drive celebrating Hindi, Marathi and regional scripts.\nOpen to students of every school.',
  'hybrid', 'City Girls College Auditorium', 'https://meet.google.com/demo-link', now() + interval '14 days', 'tricolour', '#0b5394',
  'Dr. A. Sharma', 'Campaign Director', 'Certificate of Appreciation',
  '[{"name":"Green Earth Foundation","logo":""}]', '[{"name":"Community CSR Partner","logo":""}]', 19.0760, 72.8777, 'Gate 2, near the library. Carry your ID pass.'),
 ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'Annual Maths Olympiad', '',
  'annual-maths-olympiad', 'Inter-school olympiad with QR gate attendance.', 'offline', 'Olympiad Hall', '', now() + interval '30 days',
  'modern', '#7c3aed', 'Prof. R. Iyer', 'Chief Examiner', 'Certificate of Merit', '[]', '[]', null, null, '');
update public.events set gate_attendance = true where id = 'c0000000-0000-0000-0000-000000000002';

do $$
declare e public.events;
begin
  select * into e from public.events where slug = 'annual-language-day-2026';
  perform app.insert_registration(e, '{"name_en":"Aarav Sharma","name_hi":"आरव शर्मा","grade":"8","mobile":"9876543210","institution":"Demo Public School"}', true);
  perform app.insert_registration(e, '{"name_en":"Priya Lalwani","name_hi":"प्रिया लालवानी","grade":"10","mobile":"9876501234","institution":"Demo Public School"}', true);
  select * into e from public.events where slug = 'annual-maths-olympiad';
  perform app.insert_registration(e, '{"name_en":"Kabir Iyer","grade":"9","mobile":"9811100001","institution":"Olympiad Academy"}', true);
  perform app.insert_registration(e, '{"name_en":"Meera Nair","grade":"9","mobile":"9811100002","institution":"Olympiad Academy"}', true);
  delete from public.outbox;
end $$;
