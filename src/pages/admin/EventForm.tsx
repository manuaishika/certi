import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { ToggleField } from '@/components/ui/toggle-field'
import { Field } from '@/components/Field'
import { toLocalInput } from '@/lib/utils'
import type { EventRow, Module } from '@/lib/types'

export interface OrgOption { id: string; name: string; is_branch: boolean }

/** Shared by "create event" and "event settings". Fields the plan doesn't allow are disabled with an explanation. */
export function EventForm({ initial, orgs, modules, busy, submitLabel, onSubmit }: {
  initial?: Partial<EventRow>; orgs?: OrgOption[]; modules: Module[]; busy: boolean; submitLabel: string; onSubmit: (p: Record<string, any>) => void
}) {
  const [f, setF] = useState({
    org_id: initial?.org_id ?? orgs?.[0]?.id ?? '', title: initial?.title ?? '', title_hi: initial?.title_hi ?? '', description: initial?.description ?? '',
    mode: initial?.mode ?? 'offline', starts_at: toLocalInput(initial?.starts_at), venue: initial?.venue ?? '', arrival_info: initial?.arrival_info ?? '',
    lat: initial?.lat?.toString() ?? '', lng: initial?.lng?.toString() ?? '', meeting_url: initial?.meeting_url ?? '',
    cert_title: initial?.cert_title ?? 'Certificate of Participation', cert_body: initial?.cert_body ?? 'for actively participating in {event} held on {date}.',
    orientation: initial?.orientation ?? 'landscape', signatory: initial?.signatory ?? '', signatory_role: initial?.signatory_role ?? '',
    sponsor_label: initial?.sponsor_label ?? 'Supported By',
    reg_open: initial?.reg_open ?? true, approval_required: initial?.approval_required ?? true, feedback_gate: initial?.feedback_gate ?? true, gate_attendance: initial?.gate_attendance ?? false,
  })
  const s = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }))
  const life = modules.includes('lifecycle'), att = modules.includes('attendance')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const { org_id, ...rest } = f
    onSubmit({ ...(orgs ? { org_id } : {}), ...rest, starts_at: f.starts_at ? new Date(f.starts_at).toISOString() : '' })
  }
  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
      <Field label="Title*"><Input value={f.title} onChange={s('title')} required minLength={2} /></Field>
      <Field label="Title (हिंदी)"><Input lang="hi" value={f.title_hi} onChange={s('title_hi')} /></Field>
      {orgs && <Field label="Hosting organisation / branch*"><Select value={f.org_id} onChange={s('org_id')}>{orgs.map(o => <option key={o.id} value={o.id}>{o.is_branch ? '↳ ' : ''}{o.name}</option>)}</Select></Field>}
      <Field label="Mode" hint={life ? undefined : 'Online and hybrid events need the Event Lifecycle module (Pro and above).'}>
        <Select value={f.mode} onChange={s('mode')} disabled={!life}><option value="offline">Offline (in person)</option><option value="online">Online</option><option value="hybrid">Hybrid</option></Select></Field>
      <Field label="Description" className="md:col-span-2"><Textarea rows={3} value={f.description} onChange={s('description')} /></Field>
      <Field label="Starts at"><Input type="datetime-local" value={f.starts_at} onChange={s('starts_at')} /></Field>
      <Field label="Venue"><Input value={f.venue} onChange={s('venue')} /></Field>
      <Field label="Latitude"><Input value={f.lat} onChange={s('lat')} inputMode="decimal" /></Field>
      <Field label="Longitude"><Input value={f.lng} onChange={s('lng')} inputMode="decimal" /></Field>
      <Field label="Arrival instructions" className="md:col-span-2"><Input value={f.arrival_info} onChange={s('arrival_info')} /></Field>
      <Field label="Online meeting link (Zoom / Meet / YouTube Live)" hint="Shown only to registered online attendees on their ID pass." className="md:col-span-2">
        <Input type="url" value={f.meeting_url} onChange={s('meeting_url')} disabled={!life} /></Field>
      <Field label="Certificate title"><Input value={f.cert_title} onChange={s('cert_title')} /></Field>
      <Field label="Orientation"><Select value={f.orientation} onChange={s('orientation')}><option value="landscape">Landscape A4 (297×210 mm)</option><option value="portrait">Portrait A4 (210×297 mm)</option></Select></Field>
      <Field label="Certificate body" hint="Placeholders: {event} {date} {name} {grade}" className="md:col-span-2"><Input value={f.cert_body} onChange={s('cert_body')} /></Field>
      <Field label="Signatory name"><Input value={f.signatory} onChange={s('signatory')} /></Field>
      <Field label="Signatory role"><Input value={f.signatory_role} onChange={s('signatory_role')} /></Field>
      {!orgs && <Field label="Sponsor label"><Input value={f.sponsor_label} onChange={s('sponsor_label')} /></Field>}
      <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
        <ToggleField label="Registration open" checked={f.reg_open} onChange={v => setF(p => ({ ...p, reg_open: v }))} />
        <ToggleField label="Require approval before a certificate is issued" checked={f.approval_required} onChange={v => setF(p => ({ ...p, approval_required: v }))} />
        <ToggleField label="Feedback gate before download" checked={f.feedback_gate} onChange={v => setF(p => ({ ...p, feedback_gate: v }))} />
        <ToggleField label='Only "Present" attendees get certificates' checked={f.gate_attendance && att} disabled={!att} hint={att ? undefined : 'Needs the QR Attendance module (Enterprise).'} onChange={v => setF(p => ({ ...p, gate_attendance: v }))} />
      </div>
      <Button className="md:col-span-2" size="lg" disabled={busy}>{submitLabel}</Button>
    </form>)
}
