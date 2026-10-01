import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, Download, Palette, Trash2, Upload } from 'lucide-react'
import { api } from '@/lib/backend'
import { useAction, useDebounced, useIsDesktop, useRpc } from '@/lib/hooks'
import type { EventRow, Module, Registration } from '@/lib/types'
import { parseRoster, downloadCsv, prepareImage } from '@/lib/files'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ToggleField } from '@/components/ui/toggle-field'
import { PageHeader, Stat } from '@/components/Field'
import { EventForm } from './EventForm'
import { cn } from '@/lib/utils'

function Cell({ reg, field, onSave, boxed }: { reg: Registration; field: keyof Registration; onSave: (field: string, value: string) => Promise<boolean>; boxed?: boolean }) {
  const server = String(reg[field] ?? '')
  const [v, setV] = useState(server)
  const saved = useRef(server)               // last value known to be stored, so edit-back-to-original still saves
  const [state, setState] = useState<'' | 'ok' | 'err'>('')
  useEffect(() => { saved.current = server; setV(server) }, [server])
  return <input value={v} lang={field === 'name_hi' ? 'hi' : 'en'} aria-label={`${field} for ${reg.name_en}`}
    onChange={e => { setV(e.target.value); setState('') }}
    onBlur={async () => {
      if (v === saved.current) return
      const ok = await onSave(field as string, v)
      if (ok) saved.current = v
      setState(ok ? 'ok' : 'err')
    }}
    className={cn('w-full rounded border px-2 focus:border-ring focus:outline-none', boxed ? 'h-11 border-input bg-card text-base' : 'min-w-[7rem] border-transparent bg-transparent py-1 hover:border-input', state === 'ok' && 'bg-emerald-50', state === 'err' && 'bg-red-50')} />
}

export default function EventDetail() {
  const { id } = useParams()
  const info = useRpc<any>('get_event_admin', { p_event: id }, [id])
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const desktop = useIsDesktop()
  const regs = useRpc<Registration[]>('list_registrations', { p_event: id, p_q: dq }, [id, dq])
  const { busy, run } = useAction()
  const file = useRef<HTMLInputElement>(null)
  const [notify, setNotify] = useState(false)
  const [brand, setBrand] = useState({ kind: 'sponsor', name: '' })
  const logo = useRef<HTMLInputElement>(null)
  const [add, setAdd] = useState({ name_en: '', name_hi: '', mobile: '', institution: '', grade: '' })

  if (!info.data) return <p className="text-muted-foreground">{info.error || 'Loading…'}</p>
  const { event: ev, root, branch, remaining, feedback } = info.data as { event: EventRow; root: any; branch: string | null; remaining: number | null; feedback: any; modules: Module[] }
  const modules: Module[] = info.data.modules
  const rows = regs.data ?? []
  const refresh = () => { info.reload(); regs.reload() }
  const stats = { total: rows.length, approved: rows.filter(r => r.approved).length, present: rows.filter(r => r.status === 'present').length, certs: rows.filter(r => r.cert_id && !r.cert_revoked).length }

  const save = (reg: Registration) => async (field: string, value: string) => {
    try { await api.rpc('update_registration', { p_id: reg.id, p_field: field, p_value: value }); return true }
    catch (e: any) { toast.error(e.message?.replace(/^error: /i, '') ?? 'Could not save'); return false }
  }
  const toggle = (r: Registration, what: string) => run(async () => { await api.rpc('toggle_registration', { p_id: r.id, p_what: what }); await regs.reload() })
  const issue = () => run(async () => {
    const r = await api.rpc<any>('issue_certificates', { p_event: id, p_notify: notify })
    let msg = `Issued ${r.issued} certificate(s).`
    if (Number(r.overage) > 0) msg += ` Overage billed: ₹${Number(r.overage).toFixed(2)} from wallet.`
    if (r.skipped.length) msg += ` Skipped ${r.skipped.length} (e.g. ${r.skipped[0]}).`
    if (r.blocked) msg += ' ' + r.blocked
    r.blocked || r.skipped.length ? toast.warning(msg) : toast.success(msg)
    if (notify && r.issued) api.invoke('dispatch-outbox').catch(() => {})
    refresh()
  })
  const doImport = (f: File) => run(async () => {
    const rowsIn = await parseRoster(f)
    const r = await api.rpc<{ created: number; errors: string[] }>('import_registrations', { p_event: id, p_rows: rowsIn })
    toast[r.errors.length ? 'warning' : 'success'](`Imported ${r.created} participant(s).` + (r.errors.length ? ` ${r.errors.length} row(s) skipped: ${r.errors.slice(0, 3).join(' | ')}` : ''))
    refresh()
  })
  const addBrand = () => run(async () => {
    const f = logo.current?.files?.[0]
    const url = f ? await api.upload(await prepareImage(f, 1000, true), 'logos') : ''
    await api.rpc('add_brand', { p_event: id, p_kind: brand.kind, p_name: brand.name, p_logo: url })
    setBrand({ ...brand, name: '' }); if (logo.current) logo.current.value = ''; refresh()
  }, 'Added.')
  const exportCsv = () => downloadCsv(`${ev.slug}-participants.csv`, [['name_en', 'name_hi', 'institution', 'grade', 'mobile', 'email', 'mode', 'approved', 'status', 'certificate_id'],
    ...rows.map(r => [r.name_en, r.name_hi, r.institution, r.grade, r.mobile, r.email, r.attend_mode, r.approved, r.status, r.cert_id ?? ''])])

  return (
    <div className="space-y-6">
      <PageHeader title={ev.title} sub={<>{root.name}{branch && ` · ${branch}`} · public page <Link className="underline" target="_blank" to={`/events/${ev.slug}`}>/events/{ev.slug}</Link></>}>
        <Link to={`/admin/events/${id}/design`} className={buttonVariants({ variant: 'outline' })}><Palette className="h-4 w-4" />Certificate designer</Link>
        <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4" />Export CSV</Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 [&>:last-child:nth-child(odd)]:col-span-2 md:[&>:last-child:nth-child(odd)]:col-span-1">
        <Stat label="Registered" value={stats.total} /><Stat label="Approved" value={stats.approved} /><Stat label="Present" value={stats.present} />
        <Stat label="Certificates" value={stats.certs} /><Stat label="Avg feedback" value={feedback.avg ? `${feedback.avg} ★` : '—'} sub={`${feedback.count} response(s)`} />
      </div>

      <Card><CardContent className="pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-2 font-semibold">Participants</h2>
          <Input className="w-64" placeholder="Search name / mobile / institution" value={q} onChange={e => setQ(e.target.value)} />
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await api.rpc('approve_all', { p_event: id }); refresh() }, 'All participants approved.')}>Approve all</Button>
            <ToggleField label="Notify (WhatsApp / SMS / email)" checked={notify} onChange={setNotify} />
            <Button disabled={busy} onClick={issue}><Check className="h-4 w-4" />Issue certificates</Button>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Edit any cell: it saves when you leave the field and flows into already-issued certificates.
          {ev.gate_attendance && <b> Attendance gate ON: only "Present" attendees are certified.</b>} {remaining !== null && <>Quota remaining: <b>{remaining}</b>.</>}</p>
        {!desktop ? (
          <ul className="mt-3 space-y-3" aria-label="Participants">
            {rows.map(r => (
              <li key={r.id} className="rounded-xl border p-3">
                <div className="grid grid-cols-2 gap-x-2 gap-y-2">
                  <label className="col-span-2 text-xs text-muted-foreground">Name (English)<Cell reg={r} field="name_en" onSave={save(r)} boxed /></label>
                  <label className="col-span-2 text-xs text-muted-foreground">नाम (हिंदी)<Cell reg={r} field="name_hi" onSave={save(r)} boxed /></label>
                  <label className="text-xs text-muted-foreground">Institution<Cell reg={r} field="institution" onSave={save(r)} boxed /></label>
                  <label className="text-xs text-muted-foreground">Grade<Cell reg={r} field="grade" onSave={save(r)} boxed /></label>
                  <label className="col-span-2 text-xs text-muted-foreground">Mobile<Cell reg={r} field="mobile" onSave={save(r)} boxed /></label>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className={cn('h-11 rounded-md border text-sm font-medium', r.approved ? 'border-emerald-200 bg-emerald-100 text-emerald-800' : 'bg-secondary')} onClick={() => toggle(r, 'approved')}>{r.approved ? 'Approved ✓' : 'Approve'}</button>
                  <button className={cn('h-11 rounded-md border text-sm font-medium', r.status === 'present' ? 'border-emerald-200 bg-emerald-100 text-emerald-800' : 'bg-secondary')} onClick={() => toggle(r, 'present')}>{r.status === 'present' ? 'Present ✓' : 'Mark present'}</button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  {r.cert_id ? <span className="flex items-center gap-3"><Link className={cn('inline-flex min-h-9 items-center font-mono underline', r.cert_revoked && 'line-through')} to={`/certificate/${r.cert_id}`} target="_blank">{r.cert_id}</Link>
                    <button className="min-h-9 text-muted-foreground" onClick={() => run(async () => { await api.rpc('revoke_certificate', { p_cert_id: r.cert_id }); regs.reload() })}>{r.cert_revoked ? 'restore' : 'revoke'}</button></span> : <span className="text-muted-foreground">No certificate yet</span>}
                  <Link className="inline-flex min-h-9 items-center underline" to={`/pass/${r.token}`} target="_blank">Pass {r.token} · {r.attend_mode}</Link>
                  {!r.cert_id && <button className="ml-auto inline-flex min-h-9 items-center gap-1 text-destructive" aria-label={`Delete ${r.name_en}`} onClick={() => run(async () => { await api.rpc('delete_registration', { p_id: r.id }); refresh() })}><Trash2 className="h-4 w-4" />Delete</button>}
                </div>
              </li>))}
            {!regs.loading && !rows.length && <li className="rounded-xl border p-6 text-center text-muted-foreground">No participants yet.</li>}
          </ul>
        ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr>{['Name (EN)', 'नाम (हिंदी)', 'Institution', 'Grade', 'Mobile', 'Approval', 'Attendance', 'Certificate', 'Pass'].map(h => <th key={h} className="p-1 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t">
                  {(['name_en', 'name_hi', 'institution', 'grade', 'mobile'] as const).map(f => <td key={f} className="p-0.5"><Cell reg={r} field={f} onSave={save(r)} /></td>)}
                  <td className="p-1"><button onClick={() => toggle(r, 'approved')}><Badge variant={r.approved ? 'success' : 'secondary'}>{r.approved ? 'Approved' : 'Approve'}</Badge></button></td>
                  <td className="p-1"><button onClick={() => toggle(r, 'present')}><Badge variant={r.status === 'present' ? 'success' : 'secondary'}>{r.status === 'present' ? 'Present' : 'Mark present'}</Badge></button></td>
                  <td className="p-1 text-xs">{r.cert_id ? <span className="flex items-center gap-1"><Link className={cn('font-mono underline', r.cert_revoked && 'line-through')} to={`/certificate/${r.cert_id}`} target="_blank">{r.cert_id}</Link>
                    <button className="text-muted-foreground hover:text-destructive" onClick={() => run(async () => { await api.rpc('revoke_certificate', { p_cert_id: r.cert_id }); regs.reload() })}>{r.cert_revoked ? 'restore' : 'revoke'}</button></span> : '—'}</td>
                  <td className="p-1 text-xs"><Link className="underline" to={`/pass/${r.token}`} target="_blank">{r.token}</Link> · {r.attend_mode}
                    {!r.cert_id && <button className="ml-1 text-muted-foreground hover:text-destructive" aria-label={`Delete ${r.name_en}`} onClick={() => run(async () => { await api.rpc('delete_registration', { p_id: r.id }); refresh() })}><Trash2 className="inline h-3 w-3" /></button>}</td>
                </tr>))}
              {!regs.loading && !rows.length && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No participants yet.</td></tr>}
            </tbody>
          </table>
        </div>
        )}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-3 text-sm"><div className="font-semibold">Bulk upload (CSV / Excel)</div>
            <div className="text-xs text-muted-foreground">Columns: name, name_hi, institution, grade, mobile, email</div>
            <input ref={file} type="file" accept=".csv,.xlsx" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = '' }} />
            <Button className="mt-2" variant="outline" size="sm" onClick={() => file.current?.click()}><Upload className="h-4 w-4" />Choose file…</Button></div>
          <form className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm sm:grid-cols-3" onSubmit={async e => { e.preventDefault(); if (await run(async () => { await api.rpc('add_registration', { p_event: id, p_data: add }); return true }, 'Participant added.')) { setAdd({ name_en: '', name_hi: '', mobile: '', institution: '', grade: '' }); refresh() } }}>
            <div className="col-span-2 font-semibold sm:col-span-3">Add participant</div>
            <Input placeholder="Name" required value={add.name_en} onChange={e => setAdd({ ...add, name_en: e.target.value })} /><Input lang="hi" placeholder="नाम" value={add.name_hi} onChange={e => setAdd({ ...add, name_hi: e.target.value })} />
            <Input placeholder="Mobile" required value={add.mobile} onChange={e => setAdd({ ...add, mobile: e.target.value })} />
            <Input placeholder="Institution" value={add.institution} onChange={e => setAdd({ ...add, institution: e.target.value })} /><Input placeholder="Grade" value={add.grade} onChange={e => setAdd({ ...add, grade: e.target.value })} />
            <Button variant="outline" disabled={busy}>Add</Button></form>
        </div>
      </CardContent></Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle>Co-hosts &amp; sponsors</CardTitle></CardHeader><CardContent className="text-sm">
          {!modules.includes('cobrand') ? <p className="text-muted-foreground">Available on Institutional Pro and above.</p> : <>
            {(['cohost', 'sponsor'] as const).map(kind => (kind === 'cohost' ? ev.cohosts : ev.sponsors).map((it, i) => (
              <div key={kind + i} className="mt-2 flex items-center gap-2">{it.logo && <img src={it.logo} className="h-8 object-contain" alt="" />}<span className="capitalize">{kind}: {it.name}</span>
                <button className="ml-auto text-xs text-destructive max-md:inline-flex max-md:min-h-10 max-md:items-center max-md:px-2" onClick={() => run(async () => { await api.rpc('remove_brand', { p_event: id, p_kind: kind, p_idx: i }); refresh() })}>remove</button></div>)))}
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3"><Select value={brand.kind} onChange={e => setBrand({ ...brand, kind: e.target.value })}><option value="cohost">Co-host</option><option value="sponsor">Sponsor</option></Select>
              <Input placeholder="Name" value={brand.name} onChange={e => setBrand({ ...brand, name: e.target.value })} /><Button variant="outline" disabled={busy || !brand.name} onClick={addBrand}>Add</Button>
              <input ref={logo} type="file" accept="image/*" className="text-xs sm:col-span-3" /></div></>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Recent feedback ({feedback.count})</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
          {feedback.recent.map((f: any, i: number) => <div key={i} className="border-t pt-2"><span className="text-amber-500">{'★'.repeat(f.rating)}</span> {f.comment}</div>)}
          {!feedback.recent.length && <p className="text-muted-foreground">None yet.</p>}</CardContent></Card>
      </div>

      <details className="rounded-xl border bg-card p-5">
        <summary className="cursor-pointer font-semibold max-md:py-3.5">Event settings</summary>
        <div className="mt-4"><EventForm initial={ev} modules={modules} busy={busy} submitLabel="Save settings"
          onSubmit={p => run(async () => { await api.rpc('update_event', { p_event: id, p }); refresh() }, 'Event saved.')} /></div>
      </details>
    </div>)
}
