import { api } from '@/lib/backend'
import { useAction, useRpc } from '@/lib/hooks'
import { fmtDate, inr, origin } from '@/lib/utils'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader, Stat } from '@/components/Field'

export default function Partner() {
  const { data, reload } = useRpc<any>('my_affiliate')
  const { busy, run } = useAction()
  if (!data) return null
  return (
    <div><PageHeader title="Partner portal" sub={<>Your coupon code <b className="font-mono">{data.coupon.code}</b> gives institutions {data.coupon.percent_off}% off a plan; you earn {data.coupon.commission_percent}% of every paid order they place, for as long as they stay.</>}>
      <Button disabled={busy || Number(data.accrued) <= 0} onClick={() => run(async () => { await api.rpc('request_payout'); reload() }, 'Payout requested.')}>Request payout ({inr(data.accrued)})</Button></PageHeader>
      <Card className="mb-4"><CardContent className="flex flex-wrap items-center gap-3 pt-5 text-sm">
        <div className="flex-1"><div className="font-medium">Your referral link</div><div className="break-all font-mono text-xs text-muted-foreground">{origin()}/signup?ref={data.coupon.code}</div></div>
        <Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(`${origin()}/signup?ref=${data.coupon.code}`).then(() => toast.success('Link copied'))}>Copy link</Button></CardContent></Card>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Referred institutions" value={data.referred_tenants} /><Stat label="Accrued" value={inr(data.accrued)} /><Stat label="Payout requested" value={inr(data.requested)} /><Stat label="Paid" value={inr(data.paid)} /></div>
      <h2 className="mb-2 mt-6 font-semibold">Recent commissions</h2>
      <Card><div className="divide-y text-sm">{data.recent.map((r: any, i: number) => <div key={i} className="flex items-center justify-between p-3"><span>{fmtDate(r.created_at)}</span><span>{inr(r.amount_inr)}</span><Badge variant={r.status === 'paid' ? 'success' : 'secondary'}>{r.status}</Badge></div>)}
        {!data.recent.length && <CardContent className="pt-5 text-muted-foreground">No commissions yet. Share your code!</CardContent>}</div></Card></div>)
}
