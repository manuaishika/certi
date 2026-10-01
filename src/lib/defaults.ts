import type { Plan, PublicSettings } from './types'

/**
 * Shown instantly on the public landing page while the live values load (the first boot of demo mode takes several seconds).
 * Must mirror the seed data in supabase/migrations/0001_schema.sql; tests/defaults.test.ts fails if they drift.
 */
export const DEFAULT_PLANS: Plan[] = [
  { key: 'free', name: 'Free Community', price_inr: 0, period: 'month', quota: 100, branches: 1, watermark: true, modules: ['certificates'], ai_enabled: false, ai_free: 0, priority: 0 },
  { key: 'event', name: 'Pay-Per-Event', price_inr: 1199, period: 'event', quota: 1000, branches: 1, watermark: false, modules: ['certificates', 'registration'], ai_enabled: true, ai_free: 0, priority: 1 },
  { key: 'pro', name: 'Institutional Pro', price_inr: 9999, period: 'year', quota: 15000, branches: 3, watermark: false, modules: ['certificates', 'registration', 'lifecycle', 'cobrand'], ai_enabled: true, ai_free: 5, priority: 2 },
  { key: 'enterprise', name: 'Enterprise Custom', price_inr: 24999, period: 'year', quota: null, branches: null, watermark: false, modules: ['certificates', 'registration', 'lifecycle', 'idpass', 'attendance', 'ai', 'cobrand', 'whitelabel'], ai_enabled: true, ai_free: null, priority: 10 },
]
export const DEFAULT_SETTINGS: PublicSettings = { overage_inr: 0.75, ai_credits_per_run: 12, max_cohosts: 1, max_sponsors: 2, gateway_mode: 'mock', usd_per_inr: 0.012 }

const inr = (n: number) => '₹' + n.toLocaleString('en-IN')
/** Price wording exactly as the SRS states it: Pay-Per-Event is a range, Enterprise is "from, custom". */
export function priceLabel(p: Plan): { amount: string; per: string } {
  if (p.price_inr === 0) return { amount: '₹0', per: 'forever free' }
  if (p.key === 'event') return { amount: '₹799 to ₹1,499', per: 'per event' }
  if (p.key === 'enterprise') return { amount: `${inr(p.price_inr)}+`, per: 'per year · custom' }
  return { amount: inr(p.price_inr), per: `per ${p.period}` }
}
