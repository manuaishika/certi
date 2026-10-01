import { useState } from 'react'
import { api } from '@/lib/backend'
import { useAction, useRpc } from '@/lib/hooks'
import { inr } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/Field'

export default function Affiliates() {
  const { data, reload } = useRpc<any[]>('list_coupons')
  const { busy, run } = useAction()
  const [c, setC] = useState({ code: '', percent: 10, affiliate: '', commission: 20 })
  const [login, setLogin] = useState({ code: '', email: '', password: '' })
  return (
    <div className="space-y-6">
      <PageHeader title="Affiliate coupons & commissions" sub="Partners earn a recurring commission on every paid order from tenants they referred." />
      <Card><CardContent className="grid gap-3 pt-5 md:grid-cols-5">
        <Input placeholder="CODE" value={c.code} onChange={e => setC({ ...c, code: e.target.value.toUpperCase() })} />
        <Input type="number" aria-label="Discount %" value={c.percent} min={0} max={90} onChange={e => setC({ ...c, percent: Number(e.target.value) })} />
        <Input placeholder="Partner / consultant" value={c.affiliate} onChange={e => setC({ ...c, affiliate: e.target.value })} />
        <Input type="number" aria-label="Commission %" value={c.commission} min={0} max={50} onChange={e => setC({ ...c, commission: Number(e.target.value) })} />
        <Button disabled={busy || !c.code} onClick={() => run(async () => { await api.rpc('create_coupon', { p_code: c.code, p_percent: c.percent, p_affiliate: c.affiliate, p_commission: c.commission }); setC({ ...c, code: '' }); reload() }, 'Coupon created.')}>Create</Button>
      </CardContent></Card>
      <Card className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr>{['Code', 'Partner', 'Discount', 'Commission', 'Uses', 'Accrued', 'Payout requested', 'Paid', ''].map(h => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{data?.map(x => (
          <tr key={x.code} className="border-t"><td className="p-2 font-mono">{x.code}</td><td>{x.affiliate_name}</td><td>{x.percent_off}%</td><td>{x.commission_percent}%</td><td>{x.uses}</td>
            <td>{inr(x.accrued)}</td><td>{Number(x.requested) > 0 ? <Badge variant="warning">{inr(x.requested)}</Badge> : '—'}</td><td>{inr(x.paid)}</td>
            <td className="space-x-2 whitespace-nowrap"><button className="text-xs underline" onClick={() => run(async () => { await api.rpc('toggle_coupon', { p_code: x.code }); reload() })}>{x.active ? 'Disable' : 'Enable'}</button>
              {(Number(x.accrued) > 0 || Number(x.requested) > 0) && <button className="text-xs underline" onClick={() => run(async () => { await api.rpc('mark_commissions_paid', { p_code: x.code }); reload() }, 'Marked as paid.')}>Mark paid</button>}</td></tr>))}
          {!data?.length && <tr><td className="p-4 text-muted-foreground">No coupons.</td></tr>}</tbody></table></Card>
      <Card><CardHeader><CardTitle>Give a partner a login</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-4">
        <Input placeholder="Coupon code" value={login.code} onChange={e => setLogin({ ...login, code: e.target.value.toUpperCase() })} />
        <Input type="email" placeholder="Partner email" value={login.email} onChange={e => setLogin({ ...login, email: e.target.value })} />
        <Input placeholder="Initial password (8+)" value={login.password} onChange={e => setLogin({ ...login, password: e.target.value })} />
        <Button variant="outline" disabled={busy || !login.code || !login.email || login.password.length < 8} onClick={() => run(async () => { await api.invoke('invite-user', { email: login.email, password: login.password, role: 'affiliate', coupon_code: login.code }); setLogin({ code: '', email: '', password: '' }) }, 'Partner login created.')}>Create login</Button>
      </CardContent></Card>
    </div>)
}
