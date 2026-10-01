// Drains the transactional outbox: signed webhooks to ERP/SIS endpoints + WhatsApp / SMS / email notifications.
// Triggered by: an organiser's session after issuing, pg_cron (every minute, with x-cron-secret), or a DB webhook.
import { admin, asUser, baseUrl } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/cors.ts'
import { signWebhook } from '../_shared/crypto.ts'
import { composeNotification, toE164 } from '../_shared/messages.ts'

async function twilio(channel: 'sms' | 'whatsapp', to: string, body: string): Promise<boolean | null> {
  const sid = Deno.env.get('TWILIO_SID'), token = Deno.env.get('TWILIO_TOKEN')
  const from = channel === 'whatsapp' ? Deno.env.get('TWILIO_WA_FROM') : Deno.env.get('TWILIO_SMS_FROM')
  if (!sid || !token || !from) return null                       // channel not configured
  const wa = channel === 'whatsapp'
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST', headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: wa ? `whatsapp:${to}` : to, From: wa && !from.startsWith('whatsapp:') ? `whatsapp:${from}` : from, Body: body }),
  })
  return r.ok
}

async function email(to: string, subject: string, html: string, text: string): Promise<boolean | null> {
  const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('EMAIL_FROM')
  if (!key || !from || !to) return null
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to, subject, html, text }) })
  return r.ok
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  const cron = Deno.env.get('CRON_SECRET')
  const isCron = !!cron && req.headers.get('x-cron-secret') === cron
  if (!isCron && !(await asUser(req).auth.getUser()).data.user) return json({ error: 'unauthorized' }, 401)

  const svc = admin()
  const { data: rows } = await svc.rpc('claim_outbox', { p_limit: 25 })
  let sent = 0, failed = 0
  for (const row of (rows ?? []) as any[]) {
    try {
      let ok = true, err = ''
      if (row.kind === 'webhook') {
        const { data: eps } = await svc.rpc('outbox_endpoints', { p_tenant: row.tenant_id, p_type: row.event_type })
        const body = JSON.stringify({ id: row.id, type: row.event_type, created_at: row.created_at, data: row.payload })
        for (const ep of (eps ?? []) as { url: string; secret: string }[]) {
          const ts = Math.floor(Date.now() / 1000)
          const r = await fetch(ep.url, { method: 'POST', signal: AbortSignal.timeout(10_000), headers: { 'Content-Type': 'application/json', 'x-cergema-event': row.event_type, 'x-cergema-signature': await signWebhook(ep.secret, ts, body) }, body })
          if (!r.ok) { ok = false; err = `${ep.url} -> ${r.status}` }
        }
      } else {
        const msg = composeNotification(row.event_type, row.payload, baseUrl())
        if (msg) {
          const to = toE164(row.payload.mobile)
          const results = await Promise.all([twilio('whatsapp', to, msg.text), twilio('sms', to, msg.text), email(row.payload.email, msg.subject, msg.html, msg.text)])
          // fail (and retry with backoff) only if a configured channel failed; unconfigured channels are skipped
          if (results.some(r => r === false)) { ok = false; err = 'a notification channel failed' }
        }
      }
      await svc.rpc('mark_outbox', { p_id: row.id, p_ok: ok, p_error: err })
      ok ? sent++ : failed++
    } catch (e) { await svc.rpc('mark_outbox', { p_id: row.id, p_ok: false, p_error: String((e as Error).message ?? e) }); failed++ }
  }
  return json({ sent, failed })
})
