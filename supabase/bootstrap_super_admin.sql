-- Run ONCE after creating your first user in Supabase Auth (Dashboard > Authentication > Users > Add user).
-- Replace the e-mail with the one you just created.
insert into public.profiles (id, email, name, role)
select id, email, 'Platform Owner', 'super' from auth.users where email = 'you@example.com'
on conflict (id) do update set role = 'super';
-- Then set the payment mode when you are ready for real money (Console > Settings, or):
--   select public.update_setting('gateway_mode', '"live"');   -- as the super admin
