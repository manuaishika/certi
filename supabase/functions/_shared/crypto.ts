// Runtime-neutral (Deno + Node + browsers): Web Crypto only. Unit-tested in tests/edge.test.ts.
const enc = new TextEncoder()
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}

/** Constant-time string comparison (length is not secret). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyRazorpaySignature(rawBody: string, signature: string | null, webhookSecret: string): Promise<boolean> {
  if (!webhookSecret || !signature) return false
  return timingSafeEqual(await hmacHex(webhookSecret, rawBody), signature)
}

/** Stripe-Signature: t=timestamp,v1=hmac(secret, `${t}.${payload}`) with a replay window. */
export async function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): Promise<boolean> {
  if (!secret || !header) return false
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]))
  const t = Number(parts.t)
  if (!t || Math.abs(nowSec - t) > toleranceSec) return false
  const expected = await hmacHex(secret, `${t}.${rawBody}`)
  return header.split(',').filter(p => p.startsWith('v1=')).some(p => timingSafeEqual(expected, p.slice(3)))
}

/** Signature header sent to customers' webhook endpoints. */
export async function signWebhook(secret: string, timestamp: number, body: string): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${body}`)}`
}
