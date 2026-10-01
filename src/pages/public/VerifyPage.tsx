import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ShieldAlert, XCircle } from 'lucide-react'
import { useRpc } from '@/lib/hooks'
import { fmtDate } from '@/lib/utils'
import { Seo } from '@/components/Seo'

export default function VerifyPage() {
  const { id } = useParams()
  const { t } = useTranslation()
  const { data, loading } = useRpc<any>('verify_certificate', { p_cert_id: id }, [id])
  if (loading) return <p className="text-muted-foreground">Loading…</p>
  const s = data?.status
  return (
    <div className="mx-auto max-w-lg text-center">
      <Seo title={`Verify ${id} | CerGeMA`} />
      {s === 'valid' ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8"><CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
          <h1 className="mt-2 text-xl font-bold text-emerald-800">{t('verify.valid')}</h1>
          <dl className="mt-5 grid grid-cols-1 gap-y-1 text-left text-sm sm:grid-cols-3 sm:gap-y-2">
            <dt className="text-muted-foreground">{t('verify.awarded')}</dt><dd className="mb-2 sm:mb-0 sm:col-span-2 font-semibold">{data.name}{data.name_hi && ` (${data.name_hi})`}</dd>
            <dt className="text-muted-foreground">{t('verify.event')}</dt><dd className="mb-2 sm:mb-0 sm:col-span-2">{data.event_title}</dd>
            <dt className="text-muted-foreground">{t('verify.issued_by')}</dt><dd className="mb-2 sm:mb-0 sm:col-span-2">{data.org}{data.branch && ` — ${data.branch}`}</dd>
            <dt className="text-muted-foreground">{t('verify.issued_on')}</dt><dd className="mb-2 sm:mb-0 sm:col-span-2">{fmtDate(data.issued_at)}</dd>
            <dt className="text-muted-foreground">{t('verify.id')}</dt><dd className="mb-2 sm:mb-0 sm:col-span-2 font-mono">{data.cert_id}</dd></dl></div>)
      : s === 'revoked' ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-8"><ShieldAlert className="mx-auto h-14 w-14 text-amber-600" />
          <h1 className="mt-2 text-xl font-bold text-amber-800">{t('verify.revoked')}</h1><p className="mt-1 text-sm text-amber-800">This certificate was issued but has since been revoked by the organiser.</p></div>)
      : (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8"><XCircle className="mx-auto h-14 w-14 text-red-600" />
          <h1 className="mt-2 text-xl font-bold text-red-800">{t('verify.not_found')}</h1>
          <p className="mt-1 text-sm text-red-700">No certificate with ID <span className="font-mono">{id}</span> exists. It may be forged or mistyped.</p></div>)}
      <Link to="/claim" className="mt-6 inline-block text-sm underline">Look up another</Link>
    </div>)
}
