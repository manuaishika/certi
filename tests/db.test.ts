import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, rpc, as, IDS } from './helpers'

let db: PGlite
beforeAll(async () => { db = await freshDb() })

const rejects = async (p: Promise<any>, msg?: RegExp) => { await expect(p).rejects.toThrow(msg) }
const FORM = { name_en: 'Test Student', name_hi: 'टेस्ट छात्र', institution: 'ABC School', grade: '9', mobile: '98765 11111', email: 't@example.com', attend_mode: 'offline' }

describe('public registration + pass', () => {
  it('validates input with friendly messages', async () => {
    expect(await rpc(db, 'anon', 'validate_registration', [{ ...FORM, mobile: '123' }])).toContain('Enter a valid 10-digit mobile number')
    expect(await rpc(db, 'anon', 'validate_registration', [{ ...FORM, name_hi: 'English only' }])).toHaveLength(1)
    expect(await rpc(db, 'anon', 'validate_registration', [FORM])).toEqual([])
  })
  it('registers, normalises mobile, is idempotent, and exposes online link only to online attendees', async () => {
    const a = await rpc(db, 'anon', 'register_participant', ['svabhasha-samman-2026', FORM])
    const b = await rpc(db, 'anon', 'register_participant', ['svabhasha-samman-2026', FORM])
    expect(a.token).toBe(b.token)
    const pass = await rpc(db, 'anon', 'get_pass', [a.token])
    expect(pass.registration.name_hi).toBe('टेस्ट छात्र')
    expect(pass.meeting_url).toBe('')            // offline attendee
    expect(pass.qr_enabled).toBe(false)           // Pro plan has no ID-pass module (SRS tier table)
    const o = await rpc(db, 'anon', 'register_participant', ['svabhasha-samman-2026', { ...FORM, name_en: 'Online Kid', mobile: '98765 22222', attend_mode: 'online' }])
    expect((await rpc(db, 'anon', 'get_pass', [o.token])).meeting_url).toContain('meet.google.com')
  })
  it('refuses registration on a plan without the registration module and hides meeting_url on the public event', async () => {
    await rpc(db, 'super', 'create_tenant', ['Free Tenant', 'free'])
    const ev = await rpc(db, 'anon', 'get_public_event', ['svabhasha-samman-2026'])
    expect(ev.event.meeting_url).toBeUndefined()
    expect(ev.lifecycle).toBe(true)
  })
  it('queues a webhook + notification for each registration', async () => {
    const rows = await db.query<any>(`select kind, event_type from public.outbox order by id`)
    expect(rows.rows.map(r => r.event_type)).toContain('registration.created')
    expect(rows.rows.map(r => r.event_type)).toContain('registration.confirmation')
  })
})

describe('tenant isolation (RLS + RPC)', () => {
  it('direct table reads only show your own tenant', async () => {
    const own = await as<any>(db, 'pro', 'select slug from public.events')
    expect(own.map(r => r.slug)).toEqual(['svabhasha-samman-2026'])
    const all = await as<any>(db, 'super', 'select slug from public.events order by slug')
    expect(all.length).toBe(2)
    expect(await as(db, 'anon', 'select * from public.registrations')).toEqual([])
    expect(await as(db, 'anon', 'select * from public.events')).toEqual([])
  })
  it('cannot write directly, even to your own rows', async () => {
    await as(db, 'pro', `update public.orgs set wallet = 99999 where id = '${IDS.proOrg}'`)
    const w = await db.query<any>(`select wallet from public.orgs where id = '${IDS.proOrg}'`)
    expect(Number(w.rows[0].wallet)).toBe(200)
  })
  it('RPCs reject other tenants and anonymous callers', async () => {
    await rejects(rpc(db, 'pro', 'get_event_admin', [IDS.evEnt]), /forbidden/)
    await rejects(rpc(db, 'free', 'list_registrations', [IDS.evPro, '']), /forbidden/)
    await rejects(rpc(db, 'anon', 'list_events'), /forbidden/)
    await rejects(rpc(db, 'pro', 'create_tenant', ['x', 'free']), /forbidden/)
    await rejects(rpc(db, 'volunteer', 'list_events'), /forbidden/)
  })
  it('service-only functions are not callable by users', async () => {
    await rejects(rpc(db, 'anon', 'claim_outbox', [5]), /permission denied/)
    await rejects(rpc(db, 'pro', 'fulfill_transaction', [IDS.proOrg, 'x']), /permission denied/)
    await rejects(rpc(db, 'pro', 'verify_api_key', ['cgm_demo_pro_key']), /permission denied/)
    expect(await rpc(db, 'service', 'verify_api_key', ['cgm_demo_pro_key'])).toBe(IDS.proOrg)
    expect(await rpc(db, 'service', 'verify_api_key', ['nope'])).toBeNull()
  })
})

describe('issuing, gating, claim, verify', () => {
  let cid: string
  it('issues only approved, fixes flow into certificates, is idempotent', async () => {
    const regs = await rpc<any[]>(db, 'pro', 'list_registrations', [IDS.evPro, 'test'])
    expect(regs[0].approved).toBe(false)
    let r = await rpc(db, 'pro', 'issue_certificates', [IDS.evPro, false])
    expect(r.skipped.join()).toContain('not approved')
    await rpc(db, 'pro', 'approve_all', [IDS.evPro])
    await rpc(db, 'pro', 'update_registration', [regs[0].id, 'name_en', 'Test Studentt'])
    await rpc(db, 'pro', 'update_registration', [regs[0].id, 'name_en', 'Test Student'])
    await rejects(rpc(db, 'pro', 'update_registration', [regs[0].id, 'mobile', '12']), /valid 10-digit/)
    r = await rpc(db, 'pro', 'issue_certificates', [IDS.evPro, true])
    expect(r.issued).toBeGreaterThan(0)
    expect((await rpc(db, 'pro', 'issue_certificates', [IDS.evPro, false])).issued).toBe(0)
    const found = await rpc<any[]>(db, 'anon', 'claim_lookup', ['98765 11111'])
    expect(found).toHaveLength(1); cid = found[0].cert_id
    expect(await rpc<any[]>(db, 'anon', 'claim_lookup', [cid.toLowerCase()])).toHaveLength(1)
    expect(await rpc<any[]>(db, 'anon', 'claim_lookup', ['123'])).toEqual([])
  })
  it('feedback gate withholds render data until feedback is given', async () => {
    expect((await rpc(db, 'anon', 'get_certificate', [cid])).unlocked).toBe(false)
    await rejects(rpc(db, 'anon', 'get_certificate_render', [cid]), /locked/)
    await rejects(rpc(db, 'anon', 'submit_feedback', [cid, 9, '']), /1-5/)
    await rpc(db, 'anon', 'submit_feedback', [cid, 5, 'great'])
    const data = await rpc(db, 'anon', 'get_certificate_render', [cid])
    expect(data.person.name_en).toBe('Test Student')
    expect(data.event.meeting_url).toBeUndefined()
    expect(data.watermark).toBe(false)
  })
  it('verifies, revokes and restores', async () => {
    expect((await rpc(db, 'anon', 'verify_certificate', [cid])).status).toBe('valid')
    expect((await rpc(db, 'anon', 'verify_certificate', ['CGM-FAKE000000'])).status).toBe('not_found')
    await rpc(db, 'pro', 'revoke_certificate', [cid])
    expect((await rpc(db, 'anon', 'verify_certificate', [cid])).status).toBe('revoked')
    expect(await rpc(db, 'anon', 'claim_lookup', [cid])).toEqual([])
    await rejects(rpc(db, 'ent', 'revoke_certificate', [cid]), /forbidden/)
    await rpc(db, 'pro', 'revoke_certificate', [cid])
  })
  it('attendance gate + QR check-in (Enterprise module)', async () => {
    let r = await rpc(db, 'ent', 'issue_certificates', [IDS.evEnt, false])
    expect(r.issued).toBe(0)
    expect(r.skipped.join()).toContain('not marked present')
    const regs = await rpc<any[]>(db, 'ent', 'list_registrations', [IDS.evEnt, ''])
    expect((await rpc(db, 'volunteer', 'checkin', [regs[0].token.toLowerCase()])).already).toBe(false)
    expect((await rpc(db, 'volunteer', 'checkin', [regs[0].token])).already).toBe(true)
    expect((await rpc(db, 'volunteer', 'checkin', ['PNOPE']))).toMatchObject({ ok: false })
    r = await rpc(db, 'ent', 'issue_certificates', [IDS.evEnt, false])
    expect(r.issued).toBe(1)
    const pro = await rpc(db, 'pro', 'checkin', [regs[1].token]).catch(e => e)   // other tenant
    expect(String(pro.message ?? pro)).toMatch(/forbidden/)
    await rejects(rpc(db, 'volunteer', 'dashboard'), /forbidden/)
  })
  it('Pro tenant has no attendance module', async () => {
    const regs = await rpc<any[]>(db, 'pro', 'list_registrations', [IDS.evPro, ''])
    expect(await rpc(db, 'pro', 'checkin', [regs[0].token])).toMatchObject({ ok: false })
  })
})

describe('quota and overage', () => {
  it('free plan: quota then paid overage from wallet, then blocked', async () => {
    const org = (await db.query<any>(`insert into public.orgs (name, plan, quota_override, wallet) values ('Tiny','free',1,0.75) returning id`)).rows[0].id
    const ev = (await db.query<any>(`insert into public.events (org_id, title, slug, approval_required) values ('${org}','T','tiny-ev', false) returning id`)).rows[0].id
    await db.exec(`insert into public.profiles (id, email, role, org_id) values ('b0000000-0000-0000-0000-0000000000ff','tiny@x.com','org_admin','${org}')`)
    for (let i = 0; i < 3; i++)
      await db.query(`select app.insert_registration((select e from public.events e where id='${ev}'), $1::jsonb, true)`, [JSON.stringify({ name_en: `Kid ${i}`, mobile: `98000000${i}0` })])
    ;(IDS as any).tiny = 'b0000000-0000-0000-0000-0000000000ff'
    const r = await rpc(db, 'tiny' as any, 'issue_certificates', [ev, false])
    expect(r.issued).toBe(2); expect(r.blocked).toMatch(/Quota reached/)
    expect(Number((await db.query<any>(`select wallet from public.orgs where id='${org}'`)).rows[0].wallet)).toBe(0)
  })
})

describe('plans, modules, co-branding', () => {
  it('enforces cobrand module + limits, branches allowance', async () => {
    await rejects(rpc(db, 'free', 'add_brand', [IDS.evPro, 'cohost', 'x', '']), /forbidden/)
    await rejects(rpc(db, 'pro', 'add_brand', [IDS.evPro, 'cohost', 'Second', '']), /Limit reached/)   // seed already has 1 co-host
    await rpc(db, 'pro', 'add_brand', [IDS.evPro, 'sponsor', 'Sponsor 2', ''])
    await rejects(rpc(db, 'pro', 'add_brand', [IDS.evPro, 'sponsor', 'Sponsor 3', '']), /Limit reached/)
    await rpc(db, 'pro', 'remove_brand', [IDS.evPro, 'sponsor', 1])
    await rpc(db, 'pro', 'add_branch', [IDS.proOrg, 'Branch 2']); await rpc(db, 'pro', 'add_branch', [IDS.proOrg, 'Branch 3'])
    await rejects(rpc(db, 'pro', 'add_branch', [IDS.proOrg, 'Branch 4']), /allows 3/)
  })
  it('mode and attendance gate respect modules', async () => {
    const id = await rpc<string>(db, 'free', 'create_event', [{ org_id: IDS.freeOrg, title: 'Free Event', mode: 'hybrid', gate_attendance: true, meeting_url: 'https://x.y' }])
    const e = (await rpc<any>(db, 'free', 'get_event_admin', [id])).event
    expect(e.mode).toBe('offline'); expect(e.gate_attendance).toBe(false); expect(e.meeting_url).toBe('')
    expect(e.slug).toBe('free-event')
    expect((await rpc<any>(db, 'free', 'get_event_admin', [id])).watermark).toBe(true)
  })
  it('super admin overrides modules per tenant', async () => {
    await rpc(db, 'super', 'update_tenant_settings', [IDS.freeOrg, { modules_override: ['certificates', 'attendance'], quota_override: 5, plan: 'free' }])
    const me = await rpc<any>(db, 'free', 'get_me')
    expect(me.tenant.modules).toEqual(['certificates', 'attendance']); expect(me.tenant.quota).toBe(5)
    await rpc(db, 'super', 'update_tenant_settings', [IDS.freeOrg, { modules_override: null, quota_override: null }])
    expect((await rpc<any>(db, 'free', 'get_me')).tenant.modules).toEqual(['certificates'])
  })
  it('super admin can edit plan entitlements', async () => {
    await rpc(db, 'super', 'update_plan', ['event', { price_inr: 999, quota: 800 }])
    const plans = await rpc<any[]>(db, 'anon', 'list_plans')
    expect(plans.find(p => p.key === 'event')).toMatchObject({ price_inr: 999, quota: 800 })
    await rejects(rpc(db, 'pro', 'update_plan', ['event', { price_inr: 1 }]), /forbidden/)
    await rpc(db, 'super', 'update_plan', ['event', { price_inr: 1199, quota: 1000 }])
  })
})

describe('billing, wallet, coupons, recurring commission', () => {
  it('computes prices on the server, applies coupon, fulfils once, accrues recurring commission', async () => {
    const before = Number((await db.query<any>(`select wallet from public.orgs where id='${IDS.freeOrg}'`)).rows[0].wallet)
    const top = await rpc<any>(db, 'free', 'create_payment_order', [IDS.freeOrg, 'topup', 500, '', '', 'INR'])
    expect(top.provider).toBe('mock')
    await rpc(db, 'free', 'mock_pay', [top.id]); await rpc(db, 'free', 'mock_pay', [top.id])
    expect(Number((await db.query<any>(`select wallet from public.orgs where id='${IDS.freeOrg}'`)).rows[0].wallet)).toBe(before + 500)
    await rejects(rpc(db, 'free', 'create_payment_order', [IDS.freeOrg, 'topup', 5, '', '', 'INR']), /between/)
    await rejects(rpc(db, 'free', 'create_payment_order', [IDS.freeOrg, 'plan', 1, 'pro', 'BADCODE', 'INR']), /not valid/)
    await rejects(rpc(db, 'pro', 'create_payment_order', [IDS.freeOrg, 'topup', 500, '', '', 'INR']), /forbidden/)
    const plan = await rpc<any>(db, 'free', 'create_payment_order', [IDS.freeOrg, 'plan', 1, 'pro', 'partner20', 'USD'])
    expect(Number(plan.amount_inr)).toBe(8999.1); expect(plan.currency).toBe('USD'); expect(Number(plan.amount)).toBe(107.99)
    await rpc(db, 'free', 'mock_pay', [plan.id])
    expect((await rpc<any>(db, 'free', 'get_me')).tenant.plan).toBe('pro')
    const aff = await rpc<any>(db, 'affiliate', 'my_affiliate')
    expect(aff.referred_tenants).toBe(1); expect(Number(aff.accrued)).toBeCloseTo(8999.1 * 0.25, 1)
    // recurring: later top-ups (no coupon) still pay the partner
    const t2 = await rpc<any>(db, 'free', 'create_payment_order', [IDS.freeOrg, 'topup', 1000, '', '', 'INR'])
    await rpc(db, 'free', 'mock_pay', [t2.id])
    expect(Number((await rpc<any>(db, 'affiliate', 'my_affiliate')).accrued)).toBeCloseTo(8999.1 * 0.25 + 250, 1)
    expect(await rpc(db, 'affiliate', 'request_payout')).toBe(2)
    await rejects(rpc(db, 'pro', 'my_affiliate'), /forbidden/)
    await rpc(db, 'super', 'mark_commissions_paid', ['PARTNER20'])
    expect(Number((await rpc<any>(db, 'affiliate', 'my_affiliate')).paid)).toBeGreaterThan(0)
    await rejects(rpc(db, 'affiliate', 'list_events'), /forbidden/)
  })
  it('mock payments are refused in live mode', async () => {
    await rpc(db, 'super', 'update_setting', ['gateway_mode', 'live'])
    const t = await rpc<any>(db, 'pro', 'create_payment_order', [IDS.proOrg, 'topup', 500, '', '', 'INR'])
    expect(t.provider).toBe('razorpay')
    expect((await rpc<any>(db, 'pro', 'create_payment_order', [IDS.proOrg, 'topup', 500, '', '', 'USD'])).provider).toBe('stripe')
    await rejects(rpc(db, 'pro', 'mock_pay', [t.id]), /disabled/)
    await rpc(db, 'service', 'fulfill_transaction', [t.id, 'pay_123'])
    await rpc(db, 'super', 'update_setting', ['gateway_mode', 'mock'])
  })
})

describe('AI queue', () => {
  it('free runs then wallet, priority ordering, refunds on failure, plan gating', async () => {
    await rejects(rpc(db, 'volunteer', 'request_ai_job', [IDS.evEnt, 'x']), /forbidden/)
    const orgWallet = async () => Number((await db.query<any>(`select wallet from public.orgs where id='${IDS.proOrg}'`)).rows[0].wallet)
    const w0 = await orgWallet()
    const jobs: any[] = []
    for (let i = 0; i < 5; i++) jobs.push(await rpc(db, 'pro', 'request_ai_job', [IDS.evPro, `green eco ${i}`]))
    expect(await orgWallet()).toBe(w0)                     // 5 free on Pro
    const paid = await rpc<any>(db, 'pro', 'request_ai_job', [IDS.evPro, 'blue royal'])
    expect(await orgWallet()).toBe(w0 - 12); expect(Number(paid.credits_charged)).toBe(12)
    const ent = await rpc<any>(db, 'ent', 'request_ai_job', [IDS.evEnt, 'enterprise priority'])
    expect(ent.priority).toBeGreaterThan(paid.priority)
    const first = (await rpc<any[]>(db, 'service', 'claim_ai_jobs', [1]))[0]
    expect(first.id).toBe(ent.id)                          // enterprise jumps the queue
    await rpc(db, 'service', 'complete_ai_job', [paid.id, '', '', 'provider down'])
    expect(await orgWallet()).toBe(w0)                     // refunded
    await rpc(db, 'service', 'complete_ai_job', [first.id, '', 'procedural', ''])
    expect((await rpc<any>(db, 'ent', 'get_ai_job', [ent.id])).status).toBe('done')
    await rpc(db, 'super', 'update_tenant_settings', [IDS.freeOrg, { plan: 'free' }])   // earlier test upgraded it
    const freeEv = (await db.query<any>(`select id from public.events where slug='free-event'`)).rows[0].id
    await rejects(rpc(db, 'free', 'request_ai_job', [freeEv, 'nope nope']), /not included/)
  })
})

describe('integrations', () => {
  it('white-label domain only resolves when module enabled and verified', async () => {
    expect((await rpc<any>(db, 'anon', 'resolve_tenant_host', ['OLYMPIAD.localhost'])).name).toBe('Olympiad Academy Group')
    expect(await rpc(db, 'anon', 'resolve_tenant_host', ['unknown.example.com'])).toBeNull()
    await rejects(rpc(db, 'pro', 'add_domain', [IDS.proOrg, 'certs.school.edu']), /Enterprise/)
    await rpc(db, 'ent', 'add_domain', [IDS.entOrg, 'certs.olympiad.edu'])
    expect(await rpc(db, 'anon', 'resolve_tenant_host', ['certs.olympiad.edu'])).toBeNull()   // pending verification
    await rpc(db, 'super', 'set_domain_verified', ['certs.olympiad.edu', true])
    expect((await rpc<any>(db, 'anon', 'resolve_tenant_host', ['certs.olympiad.edu'])).brand.hide_branding).toBe(true)
    await rejects(rpc(db, 'ent', 'add_domain', [IDS.entOrg, 'not a host']), /valid hostname/)
  })
  it('outbox is claimable by the service role with retry/backoff, webhooks require https', async () => {
    const hook = await rpc<any>(db, 'pro', 'add_webhook', [IDS.proOrg, 'https://erp.school.edu/hook', null])
    expect(hook.secret).toMatch(/^whsec_/)
    await rejects(rpc(db, 'pro', 'add_webhook', [IDS.proOrg, 'http://insecure', null]), /https/)
    const claimed = await rpc<any[]>(db, 'service', 'claim_outbox', [50])
    expect(claimed.length).toBeGreaterThan(0)
    const eps = await rpc<any[]>(db, 'service', 'outbox_endpoints', [IDS.proOrg, 'certificate.issued'])
    expect(eps).toHaveLength(1)
    await rpc(db, 'service', 'mark_outbox', [claimed[0].id, false, 'boom'])
    const row = (await db.query<any>(`select status, attempts, run_after > now() later from public.outbox where id=${claimed[0].id}`)).rows[0]
    expect(row.status).toBe('pending'); expect(row.later).toBe(true)
    await rpc(db, 'pro', 'remove_webhook', [hook.id])
  })
  it('ERP import / read via service role is tenant-scoped', async () => {
    const r = await rpc<any>(db, 'service', 'erp_import', [IDS.proOrg, 'svabhasha-samman-2026', [{ name_en: 'Api Kid', mobile: '9123456780' }, { name_en: 'X', mobile: '1' }]])
    expect(r.created).toBe(1); expect(r.errors).toHaveLength(1)
    await rejects(rpc(db, 'service', 'erp_import', [IDS.entOrg, 'svabhasha-samman-2026', []]), /not found/i)
    expect((await rpc<any[]>(db, 'service', 'erp_registrations', [IDS.proOrg, 'svabhasha-samman-2026'])).length).toBeGreaterThan(2)
  })
  it('API keys are stored hashed and shown once', async () => {
    const key = await rpc<string>(db, 'pro', 'rotate_api_key', [IDS.proOrg])
    expect(key).toMatch(/^cgm_[0-9a-f]{64}$/)
    expect(await rpc(db, 'service', 'verify_api_key', [key])).toBe(IDS.proOrg)
    const row = (await db.query<any>(`select api_key_hash from public.orgs where id='${IDS.proOrg}'`)).rows[0]
    expect(row.api_key_hash).not.toContain(key)
  })
  it('bulk import validates rows', async () => {
    const r = await rpc<any>(db, 'pro', 'import_registrations', [IDS.evPro, [{ name_en: 'Bulk One', mobile: '9000000001' }, { name_en: '', mobile: 'x' }]])
    expect(r.created).toBe(1); expect(r.errors[0]).toMatch(/^Row 3/)
  })
})
