import { assertEquals } from 'jsr:@std/assert@1'
import { reset, state } from './fake_supabase.ts'

Deno.env.set('SUPABASE_URL', 'http://x'); Deno.env.set('SUPABASE_ANON_KEY', 'a'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 's')
Deno.env.set('RAZORPAY_WEBHOOK_SECRET', 'rzp_secret'); Deno.env.set('STRIPE_WEBHOOK_SECRET', 'stripe_secret'); Deno.env.set('CRON_SECRET', 'cron')

/** Loads a function module and captures the handler it registers with Deno.serve. */
async function load(name: string): Promise<(r: Request) => Promise<Response>> {
  let h: any
  const orig = Deno.serve; (Deno as any).serve = (fn: any) => { h = fn; return {} }
  await import(`../../supabase/functions/${name}/index.ts#${crypto.randomUUID()}`)
  ;(Deno as any).serve = orig
  return h
}
const hex = async (secret: string, data: string) => {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)))].map(b => b.toString(16).padStart(2, '0')).join('')
}
const fulfilled = () => state.calls.filter(c => c.fn === 'fulfill_transaction')

Deno.test('razorpay webhook: rejects bad signature, wrong amount; fulfils exactly the verified payment', async () => {
  const h = await load('razorpay-webhook')
  reset(); state.rows.transactions = [{ id: 't1', provider: 'razorpay', provider_ref: 'order_1', amount: 500, currency: 'INR' }]
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 50000 } } } })
  const post = (b: string, sig: string | null) => h(new Request('http://x', { method: 'POST', body: b, headers: sig ? { 'x-razorpay-signature': sig } : {} }))

  assertEquals((await post(body, null)).status, 400)
  assertEquals((await post(body, 'deadbeef')).status, 400)
  assertEquals(fulfilled().length, 0)

  const tampered = body.replace('50000', '100')                     // even a correctly signed under-payment must be refused
  assertEquals((await post(tampered, await hex('rzp_secret', tampered))).status, 400)
  assertEquals(fulfilled().length, 0)

  assertEquals((await post(body, await hex('rzp_secret', body))).status, 200)
  assertEquals(fulfilled().map(c => c.args), [{ p_txn: 't1', p_ref: 'pay_1' }])

  const other = body.replace('order_1', 'order_zzz')
  assertEquals(await (await post(other, await hex('rzp_secret', other))).text(), 'unknown order')
  assertEquals(fulfilled().length, 1)
  const ignored = JSON.stringify({ event: 'payment.failed' })
  assertEquals(await (await post(ignored, await hex('rzp_secret', ignored))).text(), 'ignored')
})

Deno.test('stripe webhook: signature + replay window + amount/currency must match', async () => {
  const h = await load('stripe-webhook')
  reset(); state.rows.transactions = [{ id: 't2', provider: 'stripe', provider_ref: 'cs_1', amount: 108, currency: 'USD' }]
  const evt = (over = {}) => JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 10800, currency: 'usd', payment_intent: 'pi_1', ...over } } })
  const post = async (b: string, ts = Math.floor(Date.now() / 1000), secret = 'stripe_secret') =>
    h(new Request('http://x', { method: 'POST', body: b, headers: { 'stripe-signature': `t=${ts},v1=${await hex(secret, `${ts}.${b}`)}` } }))

  assertEquals((await post(evt(), undefined, 'wrong')).status, 400)
  assertEquals((await post(evt(), Math.floor(Date.now() / 1000) - 3600)).status, 400)     // replay
  assertEquals((await post(evt({ amount_total: 100 }))).status, 400)                        // under-payment
  assertEquals((await post(evt({ currency: 'eur' }))).status, 400)
  assertEquals(await (await post(evt({ payment_status: 'unpaid' }))).text(), 'not paid')
  assertEquals(fulfilled().length, 0)
  assertEquals((await post(evt())).status, 200)
  assertEquals(fulfilled().map(c => c.args), [{ p_txn: 't2', p_ref: 'pi_1' }])
})

Deno.test('erp-api: key required, tenant-scoped, bulk limit', async () => {
  const h = await load('erp-api')
  reset(); state.rpc.verify_api_key = (a) => (a.p_key === 'good' ? 'tenant-1' : null)
  state.rpc.erp_registrations = (a) => [{ tenant: a.p_tenant, slug: a.p_slug }]
  state.rpc.erp_import = () => ({ created: 1, errors: [] })
  const req = (path: string, init: RequestInit = {}, key?: string) => h(new Request('http://x' + path, { ...init, headers: { ...(key ? { 'x-api-key': key } : {}), 'content-type': 'application/json' } }))
  assertEquals((await req('/erp-api/events/a/registrations')).status, 401)
  assertEquals((await req('/erp-api/events/a/registrations', {}, 'bad')).status, 401)
  const ok = await req('/erp-api/events/a/registrations', {}, 'good')
  assertEquals(await ok.json(), [{ tenant: 'tenant-1', slug: 'a' }])
  assertEquals((await req('/erp-api/nope', {}, 'good')).status, 404)
  assertEquals((await req('/erp-api/events/a/registrations', { method: 'POST', body: JSON.stringify(Array(1001).fill({})) }, 'good')).status, 413)
  assertEquals((await req('/erp-api/events/a/registrations', { method: 'POST', body: JSON.stringify({ name_en: 'X', mobile: '9' }) }, 'good')).status, 200)
  assertEquals(state.calls.filter(c => c.fn === 'erp_import')[0].args.p_rows.length, 1)   // single object wrapped into an array
})

Deno.test('dispatch-outbox and ai-worker refuse anonymous callers but accept the cron secret', async () => {
  for (const name of ['dispatch-outbox', 'ai-worker']) {
    const h = await load(name)
    reset(); state.rpc.claim_outbox = () => []; state.rpc.claim_ai_jobs = () => []
    assertEquals((await h(new Request('http://x', { method: 'POST', body: '{}' }))).status, 401)
    assertEquals((await h(new Request('http://x', { method: 'POST', body: '{}', headers: { 'x-cron-secret': 'wrong' } }))).status, 401)
    assertEquals((await h(new Request('http://x', { method: 'POST', body: '{}', headers: { 'x-cron-secret': 'cron' } }))).status, 200)
    state.user = { id: 'u1' }
    assertEquals((await h(new Request('http://x', { method: 'POST', body: '{}' }))).status, 200)
  }
})

Deno.test('dispatch-outbox signs webhooks, retries on failure, and tolerates unconfigured channels', async () => {
  const h = await load('dispatch-outbox')
  reset(); state.user = { id: 'u1' }
  state.rpc.claim_outbox = () => [
    { id: 1, kind: 'webhook', tenant_id: 't', event_type: 'certificate.issued', payload: { a: 1 }, created_at: 'now' },
    { id: 2, kind: 'notify', tenant_id: 't', event_type: 'registration.confirmation', payload: { name: 'A', event_title: 'E', token: 'P1', mobile: '9876543210', email: '' } },
  ]
  state.rpc.outbox_endpoints = () => [{ url: 'https://erp.example/hook', secret: 'whsec' }]
  const seen: { url: string; headers: Record<string, string> }[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (u: string, init: any) => { seen.push({ url: String(u), headers: init.headers }); return new Response('boom', { status: 500 }) }) as any
  try { await h(new Request('http://x', { method: 'POST', body: '{}' })) } finally { globalThis.fetch = realFetch }
  assertEquals(seen.length, 1)
  assertEquals(seen[0].headers['x-cergema-event'], 'certificate.issued')
  assertEquals(/^t=\d+,v1=[0-9a-f]{64}$/.test(seen[0].headers['x-cergema-signature']), true)
  const marks = state.calls.filter(c => c.fn === 'mark_outbox').map(c => [c.args.p_id, c.args.p_ok])
  assertEquals(marks, [[1, false], [2, true]])      // webhook 500 -> retry; notify with no channel configured -> done, not stuck
})
