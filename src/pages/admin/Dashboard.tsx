import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { useRpc } from '@/lib/hooks'
import { inr } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader, Stat } from '@/components/Field'

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
      {data && <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {data.scope === 'platform' && <Stat label="Tenants" value={data.tenants} />}
        <Stat label="Events" value={data.events} /><Stat label="Registrations" value={data.registrations} /><Stat label="Certificates" value={data.certificates} />
        {data.scope === 'platform' && <Stat label="Revenue (INR, paid)" value={inr(data.revenue_inr)} />}
      </div>}
      {t && <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card><CardContent className="pt-5">
          <div className="flex justify-between text-sm"><span className="font-semibold">Certificate usage</span><Link className="text-primary underline" to="/admin/billing">Upgrade</Link></div>
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
