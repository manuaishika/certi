import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/backend'
import { useAuth } from '@/lib/auth'
import { useAction, useRpc } from '@/lib/hooks'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/Field'
import { EventForm, type OrgOption } from './EventForm'
import type { Module } from '@/lib/types'

export default function EventNew() {
  const nav = useNavigate()
  const { me } = useAuth()
  const orgs = useRpc<OrgOption[]>('list_org_options')
  const { busy, run } = useAction()
  const modules: Module[] = me?.tenant?.modules ?? (me?.profile.role === 'super' ? ['lifecycle', 'attendance'] : [])
  if (!orgs.data) return <p className="text-muted-foreground">Loading…</p>
  return (
    <div><PageHeader title="Create event" />
      <Card><CardContent className="pt-5">
        <EventForm orgs={orgs.data} modules={modules} busy={busy} submitLabel="Create event"
          onSubmit={async p => { const id = await run(() => api.rpc<string>('create_event', { p }), 'Event created. Now design the certificate.'); if (id) nav(`/admin/events/${id}`) }} />
      </CardContent></Card></div>)
}
