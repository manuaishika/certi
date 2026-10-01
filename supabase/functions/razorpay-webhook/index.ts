// verify_jwt = false (called by Razorpay). Authenticity = HMAC signature of the raw body.
import { admin } from '../_shared/supabase.ts'
import { verifyRazorpaySignature } from '../_shared/crypto.ts'

Deno.serve(async (req) => {
  const raw = await req.text()
  if (!(await verifyRazorpaySignature(raw, req.headers.get('x-razorpay-signature'), Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? ''))) return new Response('bad signature', { status: 400 })
  const evt = JSON.parse(raw)
  if (!['payment.captured', 'order.paid'].includes(evt.event)) return new Response('ignored')
  const pay = evt.payload?.payment?.entity, ord = evt.payload?.order?.entity
  const orderId = pay?.order_id ?? ord?.id
  const paid = pay?.amount ?? ord?.amount_paid
  const svc = admin()
  const { data: txn } = await svc.from('transactions').select('*').eq('provider', 'razorpay').eq('provider_ref', orderId).maybeSingle()
  if (!txn) return new Response('unknown order')
  // never trust the event alone: the amount paid must equal what we asked for
  if (Math.round(Number(txn.amount) * 100) !== Number(paid) || txn.currency !== 'INR') return new Response('amount mismatch', { status: 400 })
  const { error } = await svc.rpc('fulfill_transaction', { p_txn: txn.id, p_ref: pay?.id ?? orderId })
  return error ? new Response(error.message, { status: 500 }) : new Response('ok')
})
