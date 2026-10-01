// Creates a login (Supabase Auth) + profile. Super Admin: any tenant/role. Org admin: volunteers/admins in their own tenant.
import { admin, asUser } from '../_shared/supabase.ts'
import { corsHeaders, json, preflight } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  try {
    const caller = await asUser(req).rpc('get_me')
    const me = caller.data as { profile: { role: string }; tenant: { id: string } | null } | null
    if (!me || !['super', 'org_admin'].includes(me.profile.role)) return json({ error: 'forbidden' }, 403)

    const b = await req.json() as { email: string; password: string; role: string; org_id?: string; name?: string; coupon_code?: string }
    const email = String(b.email ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Enter a valid email' }, 422)
    if (String(b.password ?? '').length < 8) return json({ error: 'Password must be at least 8 characters' }, 422)
    if (!['org_admin', 'volunteer', 'affiliate'].includes(b.role)) return json({ error: 'Bad role' }, 422)
    if (me.profile.role !== 'super' && !['org_admin', 'volunteer'].includes(b.role)) return json({ error: 'forbidden' }, 403)
    const orgId = me.profile.role === 'super' ? (b.org_id ?? null) : me.tenant!.id
    if (b.role !== 'affiliate' && !orgId) return json({ error: 'org_id is required' }, 422)

    const svc = admin()
    const { data, error } = await svc.auth.admin.createUser({ email, password: b.password, email_confirm: true })
    if (error || !data.user) return json({ error: error?.message ?? 'Could not create user' }, 409)
    const { error: pe } = await svc.from('profiles').insert({ id: data.user.id, email, name: b.name ?? '', role: b.role, org_id: orgId, coupon_code: b.role === 'affiliate' ? (b.coupon_code ?? null) : null })
    if (pe) { await svc.auth.admin.deleteUser(data.user.id); return json({ error: pe.message }, 409) }
    return json({ id: data.user.id })
  } catch (e) { return json({ error: String((e as Error).message ?? e) }, 500) }
})
export { corsHeaders }
