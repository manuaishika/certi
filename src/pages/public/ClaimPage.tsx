import { FormEvent, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, errMessage } from '@/lib/backend'
import { fmtDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Seo } from '@/components/Seo'

interface Hit { cert_id: string; name: string; event_title: string; issued_at: string }
export default function ClaimPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [rows, setRows] = useState<Hit[] | null>(null)
  const [err, setErr] = useState('')
  const search = async (query: string) => { try { setErr(''); setRows(await api.rpc<Hit[]>('claim_lookup', { p_q: query })) } catch (e) { setErr(errMessage(e)) } }
  useEffect(() => { const initial = params.get('q'); if (initial) search(initial) /* eslint-disable-next-line */ }, [])
  const submit = (e: FormEvent) => { e.preventDefault(); setParams({ q }); search(q) }
  return (
    <div className="mx-auto max-w-lg">
      <Seo title={`${t('claim.title')} | CerGeMA`} />
      <h1 className="text-2xl font-bold">{t('claim.title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('lookup_hint')}. No password needed.</p>
      <form onSubmit={submit} className="mt-4 flex gap-2">
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="98765 43210 / CGM-XXXXXXXXXX" required autoFocus inputMode="text" />
        <Button>{t('find')}</Button>
      </form>
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
      {rows && (rows.length === 0
        ? <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">{t('claim.none')}</div>
        : <div className="mt-6 space-y-3">{rows.map(r => (
          <Link key={r.cert_id} to={`/certificate/${r.cert_id}`}><Card className="p-4 transition hover:shadow-md">
            <div className="font-semibold">{r.name}</div><div className="text-sm text-muted-foreground">{r.event_title}</div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">{r.cert_id} · {fmtDate(r.issued_at)}</div></Card></Link>))}</div>)}
    </div>)
}
