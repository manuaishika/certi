// verify_jwt = false (called by Stripe). Authenticity = Stripe-Signature HMAC with a 5-minute replay window.
import { admin } from '../_shared/supabase.ts'
import { verifyStripeSignature } from '../_shared/crypto.ts'

Deno.serve(async (req) => {
  const raw = await req.text()
  if (!(await verifyStripeSignature(raw, req.headers.get('stripe-signature'), Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''))) return new Response('bad signature', { status: 400 })
  const evt = JSON.parse(raw)
  if (evt.type !== 'checkout.session.completed' && evt.type !== 'checkout.session.async_payment_succeeded') return new Response('ignored')
  const s = evt.data.object
  if (s.payment_status !== 'paid') return new Response('not paid')
  const svc = admin()
  const { data: txn } = await svc.from('transactions').select('*').eq('provider', 'stripe').eq('provider_ref', s.id).maybeSingle()
  if (!txn) return new Response('unknown session')
  if (Math.round(Number(txn.amount) * 100) !== Number(s.amount_total) || String(s.currency).toLowerCase() !== 'usd') return new Response('amount mismatch', { status: 400 })
  const { error } = await svc.rpc('fulfill_transaction', { p_txn: txn.id, p_ref: s.payment_intent ?? s.id })
  return error ? new Response(error.message, { status: 500 }) : new Response('ok')
})
