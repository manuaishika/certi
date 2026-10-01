import { Link } from 'react-router-dom'
import { useRpc } from '@/lib/hooks'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/Field'

export default function Events() {
  const { data, loading } = useRpc<any[]>('list_events')
  return (
    <div>
      <PageHeader title="Events"><Link to="/admin/events/new" className={buttonVariants()}>+ New event</Link></PageHeader>
      <Card className="divide-y">
        {data?.map(e => (
          <Link key={e.id} to={`/admin/events/${e.id}`} className="flex items-center p-4 hover:bg-secondary/50">
            <div><div className="font-semibold">{e.title}</div><div className="text-xs text-muted-foreground">/events/{e.slug} · {e.mode}</div></div>
            <div className="ml-auto text-sm text-muted-foreground">{e.regs} registered · {e.certs} certificates</div></Link>))}
        {!loading && !data?.length && <div className="p-6 text-muted-foreground">No events yet.</div>}
      </Card>
    </div>)
}
