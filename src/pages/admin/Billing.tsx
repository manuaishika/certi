import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/backend'
import { useAuth } from '@/lib/auth'
import { useAction, useIsDesktop, useRpc } from '@/lib/hooks'
import type { Plan, PublicSettings, Transaction } from '@/lib/types'
import { fmtDate, inr } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PageHeader } from '@/components/Field'

const guessCountry = () => (Intl.DateTimeFormat().resolvedOptions().timeZone?.startsWith('Asia/Kolkata') || Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Calcutta') ? 'IN' : 'US'

function loadScript(src: string) {
  return new Promise<void>((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('Could not load payment widget')); document.body.appendChild(s) })
}

export default function Billing() {
  const { me, refresh } = useAuth()
  const isSuper = me?.profile.role === 'super'
  const orgs = useRpc<any[]>(isSuper ? 'list_orgs' : null)
  const [org, setOrg] = useState<string>('')
  useEffect(() => { if (isSuper && orgs.data?.length && !org) setOrg(orgs.data[0].root.id) }, [isSuper, orgs.data, org])
  const ready = !isSuper || !!org
  const bill = useRpc<{ org: any; plans: (Plan & { price: number })[]; transactions: Transaction[]; settings: PublicSettings }>(ready ? 'get_billing' : null, { p_org: isSuper ? org : null }, [org])
  const [country, setCountry] = useState(guessCountry())
  const [amount, setAmount] = useState(500)
  const [coupon, setCoupon] = useState('')
  const [pending, setPending] = useState<Transaction | null>(null)
  const { busy, run } = useAction()
  const cur = country === 'IN' ? 'INR' : 'USD'
  const desktop = useIsDesktop()

  if (!bill.data) return <p className="text-muted-foreground">{bill.error || 'Loading…'}</p>
  const { org: o, plans, transactions, settings } = bill.data

  const settle = async () => { await Promise.all([bill.reload(), refresh()]) }
  const startPayment = async (txn: Transaction) => {
    if (txn.provider === 'mock') { setPending(txn); return }
    const co = await api.invoke<any>('checkout', { txn_id: txn.id })
    if (co.url) { window.location.href = co.url; return }
    await loadScript('https://checkout.razorpay.com/v1/checkout.js')
    const Razorpay = (window as any).Razorpay
    new Razorpay({ key: co.key_id, order_id: co.order_id, amount: co.amount, currency: 'INR', name: 'CerGeMA', description: `${txn.kind} ${txn.plan}`.trim(),
      handler: async () => { toast.success('Payment received. Confirming…'); for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 1200)); await settle() } } }).open()
  }
  const order = (body: Record<string, any>) => run(async () => {
    const txn = await api.rpc<Transaction>('create_payment_order', { p_org: o.id, p_currency: cur, p_plan: '', p_coupon: '', ...body })
    await startPayment(txn)
  })

  return (
    <div>
      <PageHeader title="Billing & wallet" sub={<>{o.name} · {plans.find(p => p.key === o.plan)?.name}</>}>
        {isSuper && <Select className="w-56" value={org} onChange={e => setOrg(e.target.value)}>{orgs.data?.map(t => <option key={t.root.id} value={t.root.id}>{t.root.name}</option>)}</Select>}
        <Select className="w-36" value={country} onChange={e => setCountry(e.target.value)} aria-label="Billing country">{[['IN', 'India (₹)'], ['US', 'USA ($)'], ['GB', 'UK ($)'], ['AE', 'UAE ($)'], ['SG', 'Singapore ($)']].map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select>
      </PageHeader>
      <p className="mb-4 text-xs text-muted-foreground">Gateway: <b>{settings.gateway_mode === 'mock' ? 'mock' : cur === 'INR' ? 'Razorpay (UPI, cards, net banking)' : 'Stripe'}</b>
        {cur === 'USD' && ` · ₹1 ≈ $${settings.usd_per_inr}`}{settings.gateway_mode === 'mock' && <span className="text-amber-700"> · TEST MODE: no real money moves. The Super Admin switches to live in Settings.</span>}</p>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="pt-5"><div className="text-xs text-muted-foreground">Wallet balance</div><div className="text-3xl font-bold">{inr(o.wallet)}</div>
          <div className="mt-1 text-xs text-muted-foreground">1 credit = ₹1 · AI background {settings.ai_credits_per_run} cr · overage ₹{settings.overage_inr}/cert</div></CardContent></Card>
        <Card className="md:col-span-2"><CardContent className="flex flex-wrap items-end gap-2 pt-5">
          <label className="text-sm">Top up (₹)<Input type="number" min={100} max={200000} className="mt-1 w-40" value={amount} onChange={e => setAmount(Number(e.target.value))} /></label>
          {[500, 1000, 2500].map(a => <Button key={a} variant="outline" onClick={() => setAmount(a)}>{a}</Button>)}
          <Button className="ml-auto" disabled={busy} onClick={() => order({ p_kind: 'topup', p_amount_inr: amount })}>Pay with {cur === 'INR' ? 'UPI / Card / NetBanking' : 'card'}</Button>
        </CardContent></Card>
      </div>

      <h2 className="mb-2 mt-8 font-semibold">Plans</h2>
      <div className="grid gap-4 md:grid-cols-4">
        {plans.map(p => (
          <Card key={p.key} className={p.key === o.plan ? 'ring-2 ring-primary' : ''}><CardContent className="flex h-full flex-col pt-5 text-sm">
            <div className="font-semibold">{p.name}</div>
            <div className="text-2xl font-bold">{inr(p.price)}<span className="text-xs font-normal text-muted-foreground"> / {p.period}</span></div>
            <ul className="mt-2 flex-1 space-y-1 text-xs text-muted-foreground"><li>{p.quota ? p.quota.toLocaleString('en-IN') : 'Unlimited'} certificates</li><li>{p.branches ?? 'Unlimited'} branch(es)</li><li>{p.modules.join(', ')}</li></ul>
            {p.key !== 'free' && p.key !== o.plan ? <>
              <Input className="mt-3" placeholder="Coupon (optional)" value={coupon} onChange={e => setCoupon(e.target.value)} />
              <Button className="mt-2" disabled={busy} onClick={() => order({ p_kind: 'plan', p_amount_inr: 0, p_plan: p.key, p_coupon: coupon })}>Choose</Button></>
              : <div className="mt-3 text-xs text-emerald-700">{p.key === o.plan ? 'Current plan' : ''}</div>}
          </CardContent></Card>))}
      </div>

      <h2 className="mb-2 mt-8 font-semibold">Transactions</h2>
      {!desktop ? (
        <div className="space-y-3">
          {transactions.map(x => (
            <Card key={x.id}><CardContent className="space-y-1 pt-4 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="font-medium capitalize">{x.kind}{x.plan && ` · ${x.plan}`}</span><Badge variant={x.status === 'paid' ? 'success' : 'warning'}>{x.status}</Badge></div>
              <div className="flex justify-between text-muted-foreground"><span>{fmtDate(x.created_at, true)}</span><span>{Number(x.amount) ? `${x.amount} ${x.currency}` : `${Number(x.credits) > 0 ? '+' : ''}${Number(x.credits)} credits`}</span></div>
              <div className="text-xs text-muted-foreground">via {x.provider}{x.note ? ` · ${x.note}` : ''}</div>
              {x.status === 'created' && <Button size="sm" variant="outline" className="mt-1" onClick={() => startPayment(x)}>Complete payment</Button>}
            </CardContent></Card>))}
          {!transactions.length && <p className="text-muted-foreground">No transactions yet.</p>}
        </div>
      ) : (
      <Card className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr>{['When', 'Type', 'Amount', 'Credits', 'Via', 'Status', 'Note'].map(h => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{transactions.map(x => (
          <tr key={x.id} className="border-t"><td className="p-2">{fmtDate(x.created_at, true)}</td><td>{x.kind}{x.plan && ` · ${x.plan}`}</td><td>{Number(x.amount) ? `${x.amount} ${x.currency}` : '—'}</td>
            <td>{Number(x.credits) > 0 ? '+' : ''}{Number(x.credits)}</td><td>{x.provider}</td>
            <td><Badge variant={x.status === 'paid' ? 'success' : 'warning'}>{x.status}</Badge>{x.status === 'created' && <button className="ml-2 text-xs underline" onClick={() => startPayment(x)}>pay</button>}</td>
            <td className="text-xs text-muted-foreground">{x.note}</td></tr>))}
          {!transactions.length && <tr><td className="p-4 text-muted-foreground">No transactions yet.</td></tr>}</tbody></table></Card>
      )}

      <Dialog open={!!pending} onOpenChange={v => !v && setPending(null)}>
        <DialogContent>
          <DialogTitle>Complete payment</DialogTitle>
          <div className="text-3xl font-bold">{pending?.amount} {pending?.currency}</div>
          <DialogDescription>{pending?.kind} {pending?.plan} {pending?.coupon && `· coupon ${pending.coupon}`}</DialogDescription>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Test mode: no payment gateway is live. This button simulates a successful payment.</div>
          <Button disabled={busy} onClick={() => run(async () => { await api.rpc('mock_pay', { p_txn: pending!.id }); setPending(null); await settle() }, 'Test payment recorded.')}>Simulate successful payment</Button>
        </DialogContent>
      </Dialog>
    </div>)
}
