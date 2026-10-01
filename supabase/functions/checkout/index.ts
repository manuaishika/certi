// Creates the provider-side order for a `created` transaction: Razorpay (INR) or Stripe Checkout (USD).
// Fulfilment never happens here: it happens only in the signature-verified webhooks.
import { admin, asUser, baseUrl } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  try {
    const { txn_id } = await req.json()
    // RLS: the caller can only see transactions of their own tenant
    const { data: txn } = await asUser(req).from('transactions').select('*').eq('id', txn_id).maybeSingle()
    if (!txn) return json({ error: 'Transaction not found' }, 404)
    if (txn.status !== 'created') return json({ error: 'Already processed' }, 409)
    const svc = admin()

    if (txn.provider === 'razorpay') {
      const key = Deno.env.get('RAZORPAY_KEY_ID')!, secret = Deno.env.get('RAZORPAY_KEY_SECRET')!
      const amount = Math.round(Number(txn.amount) * 100)
      const r = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST', headers: { Authorization: 'Basic ' + btoa(`${key}:${secret}`), 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, currency: 'INR', receipt: String(txn.id).slice(0, 40), notes: { txn_id: txn.id } }),
      })
      if (!r.ok) return json({ error: 'Razorpay rejected the order' }, 502)
      const order = await r.json()
      await svc.from('transactions').update({ provider_ref: order.id }).eq('id', txn.id)
      return json({ provider: 'razorpay', order_id: order.id, key_id: key, amount })
    }
    if (txn.provider === 'stripe') {
      const form = new URLSearchParams({
        mode: 'payment', client_reference_id: txn.id,
        success_url: `${baseUrl()}/admin/billing?paid=1`, cancel_url: `${baseUrl()}/admin/billing`,
        'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(Math.round(Number(txn.amount) * 100)),
        'line_items[0][price_data][product_data][name]': `CerGeMA ${txn.kind} ${txn.plan}`.trim(),
      })
      const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
      })
      if (!r.ok) return json({ error: 'Stripe rejected the session' }, 502)
      const s = await r.json()
      await svc.from('transactions').update({ provider_ref: s.id }).eq('id', txn.id)
      return json({ provider: 'stripe', url: s.url })
    }
    return json({ error: 'This transaction does not use a live gateway' }, 400)
  } catch (e) { return json({ error: String((e as Error).message ?? e) }, 500) }
})
