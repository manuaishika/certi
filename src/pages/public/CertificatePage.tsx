import { FormEvent, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Download, FileImage, Image as ImageIcon, MessageCircle, Share2, ThumbsUp } from 'lucide-react'
import { api } from '@/lib/backend'
import { useAction, useRpc } from '@/lib/hooks'
import type { RenderData } from '@/lib/types'
import { origin } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { CertPreview } from '@/components/CertPreview'
import { Seo } from '@/components/Seo'
import { certificatePdf, certificatePng, saveBlob, shareBadge } from '@/lib/cert/export'
import type { CertInput } from '@/lib/cert/render'

const toInput = (d: RenderData): CertInput => ({
  event: d.event, person: d.person, org: d.org, branch: d.branch, cert_id: d.cert_id, issued_at: d.issued_at,
  verify_url: `${origin()}/verify/${d.cert_id}`, watermark: d.watermark,
})

export default function CertificatePage() {
  const { id } = useParams()
  const { t } = useTranslation()
  const meta = useRpc<any>('get_certificate', { p_cert_id: id }, [id])
  const unlocked = meta.data?.unlocked
  const render = useRpc<RenderData>(unlocked ? 'get_certificate_render' : null, { p_cert_id: id }, [id, unlocked])
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const { busy, run } = useAction()

  if (meta.loading) return <p className="text-muted-foreground">Loading…</p>
  if (!meta.data) return <p className="py-20 text-center text-muted-foreground">Certificate not found.</p>
  const m = meta.data
  const url = `${origin()}/verify/${m.cert_id}`
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!rating) return
    if (await run(async () => { await api.rpc('submit_feedback', { p_cert_id: id, p_rating: rating, p_comment: comment }); return true })) meta.reload()
  }
  const input = render.data ? toInput(render.data) : null
  const share = {
    whatsapp: 'https://wa.me/?text=' + encodeURIComponent(`I just earned a certificate for ${m.event_title}! Verify: ${url}`),
    linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url),
    facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url),
  }
  return (
    <div className="mx-auto max-w-3xl">
      <Seo title={`${m.name} — ${m.event_title}`} description={`Verified by CerGeMA · ${m.org}`} url={`${origin()}/certificate/${m.cert_id}`} />
      <h1 className="text-xl font-bold">{m.event_title}</h1>
      <p className="text-sm text-muted-foreground">{m.name} · <span className="font-mono">{m.cert_id}</span></p>
      {input ? <CertPreview input={input} className="mt-4" /> : <div className="mt-4 grid aspect-[297/210] place-items-center rounded border bg-secondary text-sm text-muted-foreground">{unlocked ? 'Preparing…' : 'Preview unlocks after a quick feedback'}</div>}
      {!unlocked ? (
        <Card className="mt-6 p-5">
          <form onSubmit={submit} className="space-y-3">
            <h2 className="font-semibold">{t('cert.unlock')}</h2>
            <div className="text-sm">{t('cert.rating')}
              <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Rating">
                {[1, 2, 3, 4, 5].map(i => <button type="button" key={i} role="radio" aria-checked={rating === i} aria-label={`${i} star`} onClick={() => setRating(i)}
                  className={`text-3xl leading-none ${i <= rating ? 'text-amber-500' : 'text-slate-300'}`}>★</button>)}</div></div>
            <label className="block text-sm">{t('cert.feedback')}<Textarea className="mt-1" maxLength={1000} value={comment} onChange={e => setComment(e.target.value)} rows={3} /></label>
            <Button disabled={!rating || busy}>{t('cert.unlock_btn')}</Button>
          </form>
        </Card>) : input && (
        <>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => run(async () => saveBlob(await certificatePdf(input), `${m.cert_id}.pdf`))}><Download className="h-4 w-4" />{t('cert.pdf')}</Button>
            <Button variant="outline" disabled={busy} onClick={() => run(async () => saveBlob(await certificatePng(input), `${m.cert_id}.png`))}><FileImage className="h-4 w-4" />{t('cert.png')}</Button>
            <a className="inline-flex h-10 items-center gap-2 rounded-md bg-green-600 px-4 text-sm font-medium text-white" target="_blank" rel="noopener noreferrer" href={share.whatsapp}><MessageCircle className="h-4 w-4" />WhatsApp</a>
            <a className="inline-flex h-10 items-center gap-2 rounded-md bg-sky-700 px-4 text-sm font-medium text-white" target="_blank" rel="noopener noreferrer" href={share.linkedin}><Share2 className="h-4 w-4" />LinkedIn</a>
            <a className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white" target="_blank" rel="noopener noreferrer" href={share.facebook}><ThumbsUp className="h-4 w-4" />Facebook</a>
            <Button variant="outline" onClick={() => run(async () => saveBlob(await shareBadge(m.name, m.event_title, m.org, m.cert_id), `badge-${m.cert_id}.png`))}><ImageIcon className="h-4 w-4" />{t('cert.badge')}</Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t('cert.verify_at')} <a className="underline" href={url}>{url}</a></p>
        </>)}
    </div>)
}
