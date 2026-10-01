import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Globe, KeyRound, Webhook } from 'lucide-react'
import { api } from '@/lib/backend'
import { useAuth } from '@/lib/auth'
import { useAction, useRpc } from '@/lib/hooks'
import { MODULES, MODULE_LABELS, type Module } from '@/lib/types'
import { prepareImage } from '@/lib/files'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ToggleField } from '@/components/ui/toggle-field'
import { Field, PageHeader } from '@/components/Field'

const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast.success('Copied'))

function Tenant({ d, isSuper, reload }: { d: any; isSuper: boolean; reload: () => void }) {
  const r = d.root
  const { busy, run } = useAction()
  const logo = useRef<HTMLInputElement>(null)
  const [branch, setBranch] = useState('')
  const [user, setUser] = useState({ email: '', password: '', role: 'volunteer' })
  const [hook, setHook] = useState('')
  const [secret, setSecret] = useState('')
  const [newKey, setNewKey] = useState('')
  const [domain, setDomain] = useState('')
  const [brand, setBrand] = useState({ app_name: r.brand?.app_name ?? '', color: r.brand?.color ?? '', hide_branding: !!r.brand?.hide_branding })
  const [s, setS] = useState({ plan: r.plan, quota: r.quota_override?.toString() ?? '', price: r.price_override_inr?.toString() ?? '', wallet: '0', active: r.active,
    useModules: r.modules_override !== null, modules: (r.modules_override ?? d.modules) as Module[] })
  const whitelabel = d.modules.includes('whitelabel')
  const plans = useRpc<any[]>(isSuper ? 'list_plans' : null)
  const done = (msg: string) => () => { toast.success(msg); reload() }

  return (
    <Card><CardContent className="space-y-5 pt-5">
      <div className="flex flex-wrap items-center gap-3">
        {r.logo_url && <img src={r.logo_url} className="h-12 w-12 object-contain" alt="" />}
        <div><h2 className="text-lg font-semibold">{r.name}</h2>
          <div className="text-xs text-muted-foreground">{d.plan_name} · {d.used}{d.quota ? ` / ${d.quota}` : ''} certs · wallet ₹{Number(r.wallet).toFixed(0)} · modules: {d.modules.join(', ')}</div></div>
        <div className="ml-auto"><input ref={logo} type="file" accept="image/*" className="hidden" aria-label="Upload logo" onChange={e => { const f = e.target.files?.[0]; if (f) run(async () => { await api.rpc('set_org_logo', { p_org: r.id, p_url: await api.upload(await prepareImage(f, 800, true), 'logos') }); reload() }, 'Logo updated.'); e.target.value = '' }} />
          <Button variant="outline" size="sm" onClick={() => logo.current?.click()}>Upload logo</Button></div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section><h3 className="text-sm font-semibold">Branches / campuses ({d.branches.length}{d.allowance != null ? ` of ${d.allowance}` : ''})</h3>
          <ul className="mt-1 divide-y text-sm">{d.branches.map((b: any) => <li key={b.id} className="py-1">{b.name}</li>)}{!d.branches.length && <li className="py-1 text-muted-foreground">None yet</li>}</ul>
          <form className="mt-2 flex gap-2" onSubmit={e => { e.preventDefault(); run(async () => { await api.rpc('add_branch', { p_parent: r.id, p_name: branch }); setBranch(''); reload() }, 'Branch added.') }}>
            <Input value={branch} onChange={e => setBranch(e.target.value)} placeholder="New branch name" required /><Button variant="outline" disabled={busy}>Add</Button></form></section>

        <section><h3 className="text-sm font-semibold">Team</h3>
          <ul className="mt-1 text-sm">{d.users.map((u: any) => <li key={u.id}>{u.email} <span className="text-xs text-muted-foreground">({u.role})</span></li>)}</ul>
          <form className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4" onSubmit={e => { e.preventDefault(); run(async () => { await api.invoke('invite-user', { ...user, org_id: r.id }); setUser({ email: '', password: '', role: 'volunteer' }); reload() }, 'User added.') }}>
            <Input type="email" placeholder="email" required value={user.email} onChange={e => setUser({ ...user, email: e.target.value })} />
            <Input placeholder="password (8+)" minLength={8} required value={user.password} onChange={e => setUser({ ...user, password: e.target.value })} />
            <Select value={user.role} onChange={e => setUser({ ...user, role: e.target.value })}><option value="volunteer">Volunteer (scanner)</option><option value="org_admin">Admin</option></Select>
            <Button variant="outline" disabled={busy}>Add user</Button></form></section>

        <section><h3 className="flex items-center gap-1 text-sm font-semibold"><KeyRound className="h-4 w-4" />ERP / SIS API key</h3>
          <p className="mt-1 break-all font-mono text-xs">{newKey || (r.api_key_prefix ? `${r.api_key_prefix}…  (hidden, stored hashed)` : '(none)')}</p>
          {newKey && <p className="text-xs text-amber-700">Copy it now: it will not be shown again. <button className="underline" onClick={() => copy(newKey)}><Copy className="inline h-3 w-3" /> copy</button></p>}
          <Button variant="outline" size="sm" className="mt-1" disabled={busy} onClick={() => run(async () => { setNewKey(await api.rpc<string>('rotate_api_key', { p_org: r.id })); reload() })}>Generate new key</Button>
          <p className="mt-1 text-xs text-muted-foreground">POST <code>/functions/v1/erp-api/events/&lt;slug&gt;/registrations</code> with header <code>x-api-key</code>.</p></section>

        <section><h3 className="flex items-center gap-1 text-sm font-semibold"><Webhook className="h-4 w-4" />Outbound webhooks</h3>
          <ul className="mt-1 text-sm">{d.webhooks.map((w: any) => <li key={w.id} className="flex items-center gap-2"><span className="truncate">{w.url}</span>
            <button className="ml-auto text-xs text-destructive" onClick={() => run(async () => { await api.rpc('remove_webhook', { p_id: w.id }); reload() })}>remove</button></li>)}{!d.webhooks.length && <li className="text-muted-foreground">None</li>}</ul>
          <form className="mt-2 flex gap-2" onSubmit={e => { e.preventDefault(); run(async () => { const w = await api.rpc<any>('add_webhook', { p_org: r.id, p_url: hook, p_events: null }); setSecret(w.secret); setHook(''); reload() }, 'Webhook added.') }}>
            <Input type="url" placeholder="https://erp.school.edu/cergema-hook" value={hook} onChange={e => setHook(e.target.value)} required /><Button variant="outline" disabled={busy}>Add</Button></form>
          {secret && <p className="mt-1 break-all text-xs text-amber-700">Signing secret (shown once): <code>{secret}</code></p>}
          <p className="mt-1 text-xs text-muted-foreground">Events: registration.created, certificate.issued, attendance.checked_in. Signed with HMAC-SHA256 in <code>x-cergema-signature</code>.</p></section>
      </div>

      <section className="rounded-lg border p-4"><h3 className="flex items-center gap-1 text-sm font-semibold"><Globe className="h-4 w-4" />White-label &amp; custom domain</h3>
        {!whitelabel ? <p className="mt-1 text-sm text-muted-foreground">Available on the Enterprise plan.</p> : <>
          <div className="mt-2 grid gap-3 md:grid-cols-3">
            <Field label="App name"><Input value={brand.app_name} onChange={e => setBrand({ ...brand, app_name: e.target.value })} /></Field>
            <Field label="Brand colour"><input type="color" value={brand.color || '#0b2a5b'} onChange={e => setBrand({ ...brand, color: e.target.value })} className="h-10 w-full" /></Field>
            <div className="flex items-end"><ToggleField label="Hide CerGeMA branding" checked={brand.hide_branding} onChange={v => setBrand({ ...brand, hide_branding: v })} /></div>
            <Button variant="outline" className="md:col-span-3" disabled={busy} onClick={() => run(async () => { await api.rpc('update_brand', { p_org: r.id, p_brand: brand }); reload() }, 'Branding saved.')}>Save branding</Button></div>
          <ul className="mt-3 text-sm">{d.domains.map((x: any) => <li key={x.host} className="flex items-center gap-2"><span className="font-mono">{x.host}</span><Badge variant={x.verified ? 'success' : 'warning'}>{x.verified ? 'verified' : 'pending DNS verification'}</Badge>
            {isSuper && <button className="text-xs underline" onClick={() => run(async () => { await api.rpc('set_domain_verified', { p_host: x.host, p_verified: !x.verified }); reload() })}>{x.verified ? 'unverify' : 'verify'}</button>}
            <button className="ml-auto text-xs text-destructive" onClick={() => run(async () => { await api.rpc('remove_domain', { p_host: x.host }); reload() })}>remove</button></li>)}</ul>
          <form className="mt-2 flex gap-2" onSubmit={e => { e.preventDefault(); run(async () => { await api.rpc('add_domain', { p_org: r.id, p_host: domain }); setDomain(''); reload() }, 'Domain added.') }}>
            <Input placeholder="certs.yourschool.edu" value={domain} onChange={e => setDomain(e.target.value)} required /><Button variant="outline" disabled={busy}>Add domain</Button></form>
          <p className="mt-1 text-xs text-muted-foreground">Point a CNAME to your CerGeMA host; the Super Admin verifies the domain before it goes live.</p></>}
      </section>

      {isSuper && <details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-semibold">Super Admin controls</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Field label="Plan"><Select value={s.plan} onChange={e => setS({ ...s, plan: e.target.value })}>{plans.data?.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></Field>
          <Field label="Quota override"><Input type="number" value={s.quota} placeholder="plan default" onChange={e => setS({ ...s, quota: e.target.value })} /></Field>
          <Field label="Price override (₹)"><Input type="number" value={s.price} placeholder="plan default" onChange={e => setS({ ...s, price: e.target.value })} /></Field>
          <Field label="Wallet adjustment (credits)"><Input type="number" value={s.wallet} onChange={e => setS({ ...s, wallet: e.target.value })} /></Field>
          <div className="flex items-end"><ToggleField label="Active" checked={s.active} onChange={v => setS({ ...s, active: v })} /></div>
          <div className="md:col-span-3"><ToggleField label="Override plan modules" checked={s.useModules} onChange={v => setS({ ...s, useModules: v })} />
            <div className="mt-2 flex flex-wrap gap-4 text-sm">{MODULES.map(m => <label key={m}><input type="checkbox" disabled={!s.useModules} checked={s.modules.includes(m)} onChange={e => setS({ ...s, modules: e.target.checked ? [...s.modules, m] : s.modules.filter(x => x !== m) })} /> {MODULE_LABELS[m]}</label>)}</div></div>
          <Button className="md:col-span-3" disabled={busy} onClick={() => run(async () => {
            await api.rpc('update_tenant_settings', { p_org: r.id, p: { plan: s.plan, quota_override: s.quota === '' ? null : Number(s.quota), price_override_inr: s.price === '' ? null : Number(s.price),
              modules_override: s.useModules ? s.modules : null, active: s.active, wallet_adjust: Number(s.wallet) || 0 } }); setS({ ...s, wallet: '0' }); done('Tenant settings saved.')() })}>Save tenant settings</Button>
        </div></details>}
    </CardContent></Card>)
}

export default function Orgs() {
  const { me } = useAuth()
  const isSuper = me?.profile.role === 'super'
  const { data, reload } = useRpc<any[]>('list_orgs')
  const { busy, run } = useAction()
  const [n, setN] = useState({ name: '', plan: 'free', email: '', password: '' })
  const plans = useRpc<any[]>(isSuper ? 'list_plans' : null)
  return (
    <div className="space-y-6">
      <PageHeader title="Organisations & branches" />
      {isSuper && <Card><CardContent className="grid gap-3 pt-5 md:grid-cols-5">
        <Input placeholder="Parent organisation name" value={n.name} onChange={e => setN({ ...n, name: e.target.value })} />
        <Select value={n.plan} onChange={e => setN({ ...n, plan: e.target.value })}>{plans.data?.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</Select>
        <Input type="email" placeholder="Admin email" value={n.email} onChange={e => setN({ ...n, email: e.target.value })} />
        <Input placeholder="Initial password (8+)" value={n.password} onChange={e => setN({ ...n, password: e.target.value })} />
        <Button disabled={busy || !n.name || !n.email || n.password.length < 8} onClick={() => run(async () => {
          const id = await api.rpc<string>('create_tenant', { p_name: n.name, p_plan: n.plan })
          await api.invoke('invite-user', { email: n.email, password: n.password, role: 'org_admin', org_id: id }); setN({ name: '', plan: 'free', email: '', password: '' }); reload() }, 'Tenant created.')}>Create tenant</Button>
      </CardContent></Card>}
      {data?.map(d => <Tenant key={d.root.id + JSON.stringify(d.root.brand) + d.root.plan} d={d} isSuper={!!isSuper} reload={reload} />)}
    </div>)
}
