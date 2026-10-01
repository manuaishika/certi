import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { transformSync } from 'esbuild'
import { hmacHex, signWebhook, timingSafeEqual, verifyRazorpaySignature, verifyStripeSignature } from '../supabase/functions/_shared/crypto'
import { composeNotification, toE164 } from '../supabase/functions/_shared/messages'

describe('crypto helpers used by the payment webhooks', () => {
  it('hmac-sha256 matches the published test vector', async () => {
    expect(await hmacHex('key', 'The quick brown fox jumps over the lazy dog')).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8')
  })
  it('timingSafeEqual', () => { expect(timingSafeEqual('abc', 'abc')).toBe(true); expect(timingSafeEqual('abc', 'abd')).toBe(false); expect(timingSafeEqual('abc', 'ab')).toBe(false) })
  it('verifies Razorpay signatures and rejects tampering / missing secret', async () => {
    const body = '{"event":"payment.captured"}', sig = await hmacHex('whsec', body)
    expect(await verifyRazorpaySignature(body, sig, 'whsec')).toBe(true)
    expect(await verifyRazorpaySignature(body + ' ', sig, 'whsec')).toBe(false)
    expect(await verifyRazorpaySignature(body, null, 'whsec')).toBe(false)
    expect(await verifyRazorpaySignature(body, sig, '')).toBe(false)     // unset secret must never "verify"
  })
  it('verifies Stripe signatures with replay window', async () => {
    const body = '{"type":"checkout.session.completed"}', now = 1_800_000_000
    const good = `t=${now},v1=${await hmacHex('sk', `${now}.${body}`)}`
    expect(await verifyStripeSignature(body, good, 'sk', now)).toBe(true)
    expect(await verifyStripeSignature(body + 'x', good, 'sk', now)).toBe(false)
    expect(await verifyStripeSignature(body, good, 'sk', now + 301)).toBe(false)   // replayed later
    expect(await verifyStripeSignature(body, good, 'other', now)).toBe(false)
    expect(await verifyStripeSignature(body, `t=${now},v1=deadbeef,v1=${good.split('v1=')[1]}`, 'sk', now)).toBe(true)   // multiple v1 allowed
    expect(await verifyStripeSignature(body, null, 'sk', now)).toBe(false)
    expect(await verifyStripeSignature(body, good, '', now)).toBe(false)
  })
  it('signs outbound webhooks so receivers can verify them', async () => {
    const h = await signWebhook('whsec_x', 1700000000, '{"a":1}')
    expect(h).toBe(`t=1700000000,v1=${await hmacHex('whsec_x', '1700000000.{"a":1}')}`)
  })
})

describe('notification templates', () => {
  it('builds links and escapes HTML in emails', () => {
    const n = composeNotification('registration.confirmation', { name: '<b>Evil</b>', event_title: 'A & B', token: 'PXYZ' }, 'https://c.example/')!
    expect(n.text).toContain('https://c.example/pass/PXYZ')
    expect(n.html).not.toContain('<b>Evil</b>'); expect(n.html).toContain('&lt;b&gt;Evil&lt;/b&gt;'); expect(n.html).toContain('A &amp; B')
    expect(composeNotification('certificate.ready', { name: 'A', event_title: 'E', cert_id: 'CGM-1' }, 'https://c.example')!.text).toContain('/certificate/CGM-1')
    expect(composeNotification('unknown', {}, 'x')).toBeNull()
  })
  it('normalises phone numbers', () => { expect(toE164('9876543210')).toBe('+919876543210'); expect(toE164('+14155550123')).toBe('+14155550123'); expect(toE164('98765 43210')).toBe('+919876543210') })
})

describe('edge function sources', () => {
  const root = join(__dirname, '../supabase/functions')
  const files = readdirSync(root).filter(d => statSync(join(root, d)).isDirectory() && d !== '_shared').map(d => join(root, d, 'index.ts'))
  it.each(files)('%s parses', (f) => {
    expect(() => transformSync(readFileSync(f, 'utf8'), { loader: 'ts', target: 'es2022' })).not.toThrow()
  })
  it('never fulfils a payment outside a signature-verified webhook or the mock path', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (src.includes("'fulfill_transaction'")) expect(src).toMatch(/verify(Razorpay|Stripe)Signature/)
    }
  })
  it('every function that needs no JWT declares it in config.toml', () => {
    const toml = readFileSync(join(__dirname, '../supabase/config.toml'), 'utf8')
    for (const fn of ['erp-api', 'razorpay-webhook', 'stripe-webhook', 'share-meta', 'sitemap']) expect(toml).toMatch(new RegExp(`\\[functions\\.${fn}\\]\\s*verify_jwt = false`))
  })
})
