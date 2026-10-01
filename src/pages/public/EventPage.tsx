import { FormEvent, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MapPin } from 'lucide-react'
import { api } from '@/lib/backend'
import { useAction, useRpc } from '@/lib/hooks'
import { fmtDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Seo } from '@/components/Seo'
import { origin } from '@/lib/utils'

const EMPTY = { name_en: '', name_hi: '', institution: '', grade: '', mobile: '', email: '', parent_name: '', attend_mode: 'offline' }
const MODE_SCHEMA = { offline: 'OfflineEventAttendanceMode', online: 'OnlineEventAttendanceMode', hybrid: 'MixedEventAttendanceMode' } as const

export default function EventPage() {
  const { slug } = useParams()
  const { t } = useTranslation()
  const nav = useNavigate()
  const { data, loading } = useRpc<any>('get_public_event', { p_slug: slug }, [slug])
  const [form, setForm] = useState({ ...EMPTY })
  const [errors, setErrors] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const { busy, run } = useAction()
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }))

  if (loading) return <p className="text-muted-foreground">Loading…</p>
  if (!data) return <p className="py-20 text-center text-muted-foreground">Event not found.</p>
  const { event: ev, org, branch, registration_enabled, lifecycle } = data

  const review = async (e: FormEvent) => {
    e.preventDefault()
    const errs = await run(() => api.rpc<string[]>('validate_registration', { p_data: form }))
    if (errs) { setErrors(errs); setOpen(true) }
  }
  const confirm = async () => {
    const r = await run(() => api.rpc<{ token: string }>('register_participant', { p_slug: slug, p_data: form }))
    if (r) nav(`/pass/${r.token}`)
  }

  return (
    <div className="grid gap-6 md:grid-cols-5">
      <Seo title={`${ev.title} — Register`} description={ev.description.slice(0, 160)} url={`${origin()}/events/${ev.slug}`}
        jsonLd={{ '@context': 'https://schema.org', '@type': 'Event', name: ev.title, description: ev.description, startDate: ev.starts_at ?? undefined,
          eventAttendanceMode: `https://schema.org/${MODE_SCHEMA[ev.mode as keyof typeof MODE_SCHEMA]}`,
          eventStatus: 'https://schema.org/EventScheduled', location: ev.venue ? { '@type': 'Place', name: ev.venue } : undefined,
          organizer: { '@type': 'Organization', name: org.name } }} />
      <section className="md:col-span-2">
        <Card><CardContent className="space-y-3 pt-5">
          <div className="text-xs text-muted-foreground">{org.name}{branch && ` · ${branch}`}</div>
          <h1 className="text-2xl font-bold">{ev.title}</h1>
          {ev.title_hi && <div className="text-lg text-muted-foreground">{ev.title_hi}</div>}
          <div className="flex flex-wrap gap-2"><Badge variant="secondary" className="capitalize">{ev.mode}</Badge>{ev.starts_at && <Badge variant="outline">{fmtDate(ev.starts_at, true)}</Badge>}</div>
          <p className="whitespace-pre-line text-sm">{ev.description}</p>
          {ev.mode !== 'online' && ev.venue && (
            <div className="space-y-1 text-sm"><div className="flex items-start gap-1"><MapPin className="mt-0.5 h-4 w-4" /><span><b>{t('reg.venue')}:</b> {ev.venue}</span></div>
              {ev.lat != null && ev.lng != null && <a className="text-primary underline max-md:inline-flex max-md:min-h-11 max-md:items-center" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps?q=${ev.lat},${ev.lng}`}>{t('reg.open_maps')}</a>}
              {ev.arrival_info && <p className="text-muted-foreground">{ev.arrival_info}</p>}</div>)}
          {ev.mode !== 'offline' && <p className="text-xs text-muted-foreground">{t('reg.join_note')}</p>}
        </CardContent></Card>
      </section>
      <section className="md:col-span-3">
        {!registration_enabled ? <Card><CardContent className="pt-5 text-amber-800">{t('reg.disabled')}</CardContent></Card>
          : !ev.reg_open ? <Card><CardContent className="pt-5 text-amber-800">{t('reg.closed')}</CardContent></Card>
          : (
          <Card><CardContent className="pt-5">
            <form onSubmit={review} className="grid gap-4 sm:grid-cols-2" autoComplete="on">
              <div className="space-y-1"><Label htmlFor="name_en">{t('reg.name_en')}*</Label><Input id="name_en" value={form.name_en} onChange={set('name_en')} required minLength={2} autoComplete="name" /></div>
              <div className="space-y-1"><Label htmlFor="name_hi">{t('reg.name_hi')}</Label><Input id="name_hi" lang="hi" value={form.name_hi} onChange={set('name_hi')} placeholder="देवनागरी में नाम" /></div>
              <div className="space-y-1"><Label htmlFor="institution">{t('reg.institution')}</Label><Input id="institution" value={form.institution} onChange={set('institution')} /></div>
              <div className="space-y-1"><Label htmlFor="grade">{t('reg.grade')}</Label><Input id="grade" value={form.grade} onChange={set('grade')} /></div>
              <div className="space-y-1"><Label htmlFor="mobile">{t('reg.mobile')}*</Label><Input id="mobile" type="tel" inputMode="numeric" value={form.mobile} onChange={set('mobile')} required pattern="[0-9+ \-]{10,15}" autoComplete="tel" /></div>
              <div className="space-y-1"><Label htmlFor="email">{t('reg.email')}</Label><Input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" /></div>
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="parent">{t('reg.parent')}</Label><Input id="parent" value={form.parent_name} onChange={set('parent_name')} /></div>
              {ev.mode === 'hybrid' && lifecycle && (
                <fieldset className="text-sm sm:col-span-2"><legend className="mb-1 font-medium">{t('reg.mode')}</legend>
                  {(['offline', 'online'] as const).map(m => <label key={m} className="mr-5 max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:gap-2"><input type="radio" className="mr-1 max-md:mr-0 max-md:h-5 max-md:w-5" name="mode" checked={form.attend_mode === m} onChange={() => setForm(f => ({ ...f, attend_mode: m }))} />{m === 'offline' ? t('reg.in_person') : t('reg.online')}</label>)}</fieldset>)}
              <Button className="sm:col-span-2" size="lg" disabled={busy}>{t('reg.register')}</Button>
            </form>
          </CardContent></Card>)}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{t('reg.confirm')}</DialogTitle>
          {errors.length ? <>
            <ul className="list-disc pl-5 text-sm text-destructive">{errors.map(e => <li key={e}>{e}</li>)}</ul>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('reg.edit')}</Button></> : <>
            <DialogDescription>{t('reg.confirm_hint')}</DialogDescription>
            <dl className="divide-y text-sm">
              <div className="py-2"><dt className="text-xs text-muted-foreground">{t('reg.name_en')}</dt><dd className="text-lg font-semibold">{form.name_en}</dd></div>
              {form.name_hi && <div className="py-2"><dt className="text-xs text-muted-foreground">{t('reg.name_hi')}</dt><dd className="text-lg font-semibold">{form.name_hi}</dd></div>}
              <div className="py-2"><dt className="text-xs text-muted-foreground">{t('reg.institution')} / {t('reg.grade')}</dt><dd>{form.institution || '—'} / {form.grade || '—'}</dd></div>
              <div className="py-2"><dt className="text-xs text-muted-foreground">{t('reg.mobile')}</dt><dd>{form.mobile}</dd></div>
            </dl>
            <div className="flex gap-2"><Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>{t('reg.edit')}</Button>
              <Button className="flex-1" onClick={confirm} disabled={busy}>{t('reg.submit')}</Button></div></>}
        </DialogContent>
      </Dialog>
    </div>)
}
