import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useRpc } from '@/lib/hooks'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { QrImage } from '@/components/QrImage'
import { passBadge } from '@/lib/cert/export'
import { saveBlob } from '@/lib/cert/export'
import { Seo } from '@/components/Seo'

export default function PassPage() {
  const { token } = useParams()
  const { t } = useTranslation()
  const { data, loading } = useRpc<any>('get_pass', { p_token: token }, [token])
  if (loading) return <p className="text-muted-foreground">Loading…</p>
  if (!data) return <p className="py-20 text-center text-muted-foreground">Pass not found.</p>
  const { registration: r, event: ev, org, branch, qr_enabled, meeting_url, cert_id } = data
  const download = async () => saveBlob(await passBadge({ org: org.name, event: ev.title, name_en: r.name_en, name_hi: r.name_hi, token: r.token, mode: r.attend_mode,
    sub: [r.institution, r.grade && `Grade ${r.grade}`].filter(Boolean).join(' · ') }), `pass-${r.token}.png`)
  return (
    <div className="mx-auto max-w-sm">
      <Seo title={`ID Pass — ${r.name_en}`} />
      <Card className="overflow-hidden text-center">
        <div className="bg-primary p-4 text-primary-foreground"><div className="text-sm">{org.name}{branch && ` · ${branch}`}</div><div className="font-bold">{ev.title}</div>
          <div className="mt-1 text-xs text-primary-foreground/70">{t('pass.title')} · {r.attend_mode.toUpperCase()}</div></div>
        <div className="p-5">
          <div className="text-xl font-bold">{r.name_en}</div>{r.name_hi && <div className="text-lg">{r.name_hi}</div>}
          <div className="text-sm text-muted-foreground">{r.institution}{r.grade && ` · Grade ${r.grade}`}</div>
          {qr_enabled ? <>
            <QrImage value={r.token} className="mx-auto mt-4" /><div className="mt-2 font-mono font-bold tracking-widest">{r.token}</div>
            <Badge className="mt-2" variant={r.status === 'present' ? 'success' : 'secondary'}>{r.status === 'present' ? t('pass.checked_in') : t('pass.not_checked')}</Badge></>
            : <div className="mt-5 rounded-lg bg-emerald-50 p-4 font-medium text-emerald-800">{t('pass.registered')}</div>}
          {ev.approval_required && !r.approved && <div className="mt-2 text-xs text-amber-700">{t('pass.awaiting')}</div>}
        </div>
      </Card>
      <div className="mt-4 grid gap-2">
        {qr_enabled && <Button variant="outline" onClick={download}>{t('pass.download')}</Button>}
        {meeting_url && <a className={buttonVariants()} href={meeting_url} target="_blank" rel="noopener noreferrer">{t('pass.join')}</a>}
        {cert_id && <Link className={buttonVariants({ variant: 'accent' })} to={`/certificate/${cert_id}`}>{t('pass.get_cert')}</Link>}
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">{t('pass.bookmark')}</p>
    </div>)
}
