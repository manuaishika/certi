import { Link } from 'react-router-dom'
import { CheckCircle2, Circle } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useRpc } from '@/lib/hooks'
import { inr } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader, Stat } from '@/components/Field'

function GettingStarted({ t, d }: { t: NonNullable<ReturnType<typeof useAuth>['me']>['tenant'] & {}; d: any }) {
  const hasReg = t.modules.includes('registration')
  const steps = [
    { done: !!t.logo_url, label: 'Add your organisation’s logo', hint: 'It appears on every certificate and registration page.', to: '/admin/orgs', cta: 'Upload logo' },
    { done: d.events > 0, label: 'Create your first event', hint: 'A title and date is enough to start. You can refine it later.', to: '/admin/events/new', cta: 'Create event' },
    { done: d.registrations > 0, label: 'Add your participants',
      hint: hasReg ? 'Share your event’s registration link, or upload a CSV / Excel list from the event page.' : 'Upload a CSV / Excel list from the event page. (Public registration pages come with Pay-Per-Event and higher plans.)', to: '/admin/events', cta: 'Open events' },
    { done: d.certificates > 0, label: 'Design the certificate and issue it', hint: 'Open the event, use “Certificate designer” to position the fields, then press “Issue certificates”.', to: '/admin/events', cta: 'Open events' },
  ]
  const done = steps.filter(s => s.done).length
  if (done === steps.length) return null
  const next = steps.find(s => !s.done)!
  return (
    <Card className="border-primary/40 bg-primary/5"><CardContent className="pt-5">
      <div className="flex items-center justify-between"><h2 className="font-semibold">Getting started</h2><span className="text-xs text-muted-foreground">{done} of {steps.length} done</span></div>
      <ol className="mt-3 space-y-3">
        {steps.map(s => (
          <li key={s.label} className="flex items-start gap-3">
            {s.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /> : <Circle className="mt-0.5 h-5 w-5 text-muted-foreground" />}
            <div className="flex-1"><div className={s.done ? 'text-muted-foreground line-through' : 'font-medium'}>{s.label}</div>{!s.done && <p className="text-sm text-muted-foreground">{s.hint}</p>}</div>
            {s === next && <Link to={s.to} className={buttonVariants({ size: 'sm' })}>{s.cta}</Link>}
          </li>))}
      </ol>
      {t.plan === 'free' && <p className="mt-4 rounded-lg bg-card p-3 text-xs text-muted-foreground">You’re on the <b>Free</b> plan: 100 certificates a month. Need registration pages, QR check-in or co-hosted events? <Link to="/admin/billing" className="underline">See plans</Link>.</p>}
    </CardContent></Card>)
}

export default function Dashboard() {
  const { me } = useAuth()
  const { data } = useRpc<any>('dashboard')
  const t = me?.tenant
  const pct = t?.quota ? Math.min(100, Math.round(t.used * 100 / t.quota)) : 0
  return (
    <div>
      <PageHeader title={data?.scope === 'platform' ? 'Platform overview' : t?.name ?? 'Dashboard'} sub={t && `${t.plan_name} plan`}>
        <Link to="/admin/events/new" className={buttonVariants()}>+ New event</Link>
        <Link to="/admin/scan" className={buttonVariants({ variant: 'outline' })}>Open scanner</Link>
      </PageHeader>
      {t && data?.scope === 'tenant' && <GettingStarted t={t} d={data} />}
      {data && <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4 [&>:last-child:nth-child(odd)]:col-span-2 md:[&>:last-child:nth-child(odd)]:col-span-1">
        {data.scope === 'platform' && <Stat label="Tenants" value={data.tenants} />}
        <Stat label="Events" value={data.events} /><Stat label="Registrations" value={data.registrations} /><Stat label="Certificates" value={data.certificates} />
        {data.scope === 'platform' && <Stat label="Revenue (INR, paid)" value={inr(data.revenue_inr)} />}
      </div>}
      {t && <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card><CardContent className="pt-5">
          <div className="flex justify-between text-sm"><span className="font-semibold">Certificate usage</span><Link className="text-primary underline max-md:inline-flex max-md:min-h-11 max-md:items-center" to="/admin/billing">Upgrade</Link></div>
          {t.quota ? <><div className="mt-2 text-xs text-muted-foreground">{t.used.toLocaleString('en-IN')} / {t.quota.toLocaleString('en-IN')}</div>
            <div className="mt-1 h-2 rounded bg-secondary"><div className={`h-2 rounded ${pct >= 90 ? 'bg-red-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} /></div></>
            : <div className="mt-2 text-xs text-muted-foreground">Unlimited ({t.used} issued)</div>}
        </CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-sm font-semibold">Wallet</div><div className="text-3xl font-bold">{inr(t.wallet)}</div>
          <div className="text-xs text-muted-foreground">credits for AI backgrounds and overage (1 credit = ₹1)</div></CardContent></Card>
      </div>}
      {data?.tenant_list && <><h2 className="mb-2 mt-8 font-semibold">Tenants</h2>
        <Card><div className="divide-y text-sm">{data.tenant_list.map((x: any) => <div key={x.id} className="flex justify-between p-3"><span>{x.name}</span><span className="text-muted-foreground">{x.plan} · wallet {inr(x.wallet)}</span></div>)}</div></Card></>}
    </div>)
}
