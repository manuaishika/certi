-- Optional, run once per project (needs pg_cron + pg_net enabled in Dashboard > Database > Extensions).
-- Drains the outbox (webhooks + notifications) and AI queue every minute even if no browser triggers them.
-- Replace <project-ref> and set the same secret as an Edge Function secret:  supabase secrets set CRON_SECRET=...
select cron.schedule('cergema-outbox', '* * * * *', $$
  select net.http_post(url := 'https://<project-ref>.supabase.co/functions/v1/dispatch-outbox',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>', 'Authorization', 'Bearer <ANON_KEY>'), body := '{}'::jsonb) $$);
select cron.schedule('cergema-ai', '* * * * *', $$
  select net.http_post(url := 'https://<project-ref>.supabase.co/functions/v1/ai-worker',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>', 'Authorization', 'Bearer <ANON_KEY>'), body := '{}'::jsonb) $$);
