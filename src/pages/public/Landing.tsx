import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { useRpc } from '@/lib/hooks'
import type { Plan, PublicSettings } from '@/lib/types'
import { inr, fmtDate } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Seo } from '@/components/Seo'
import { useBranding } from '@/lib/branding'

export default function Landing() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const b = useBranding()
  const [q, setQ] = useState('')
  const events = useRpc<{ slug: string; title: string; title_hi: string; mode: string; starts_at: string | null }[]>('list_open_events')
  const plans = useRpc<Plan[]>('list_plans')
  const settings = useRpc<PublicSettings>('get_public_settings')
  const go = (e: FormEvent) => { e.preventDefault(); nav(`/claim?q=${encodeURIComponent(q)}`) }
  return (
    <div className="space-y-10">
      <Seo title={`${b.appName} — ${t('tagline')}`} description={t('hero')} />
      <section className="rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-8 text-center text-primary-foreground md:p-14">
        <h1 className="text-3xl font-bold md:text-5xl">{t('tagline')}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-primary-foreground/80">{t('hero')}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/claim" className={buttonVariants({ variant: 'accent', size: 'lg' })}>{t('nav.claim')}</Link>
          <Link to="/login" className={buttonVariants({ variant: 'outline', size: 'lg' }) + ' bg-transparent text-white hover:bg-white/10'}>{t('nav.login')}</Link>
        </div>
        <form onSubmit={go} className="mx-auto mt-8 flex max-w-md gap-2">
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder={t('lookup_hint')} className="text-foreground" required />
          <Button type="submit" variant="secondary">{t('find')}</Button>
        </form>
      </section>

      {!!events.data?.length && (
        <section>
          <h2 className="mb-3 text-xl font-semibold">{t('open_events')}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {events.data.map(e => (
              <Link key={e.slug} to={`/events/${e.slug}`}>
                <Card className="h-full transition hover:shadow-md"><CardHeader><CardTitle>{e.title}</CardTitle>{e.title_hi && <p className="text-sm text-muted-foreground">{e.title_hi}</p>}</CardHeader>
                  <CardContent className="text-xs capitalize text-muted-foreground">{e.mode}{e.starts_at && ` · ${fmtDate(e.starts_at)}`}</CardContent></Card>
              </Link>))}
          </div>
        </section>)}

      <section>
        <h2 className="mb-3 text-xl font-semibold">{t('plans')}</h2>
        <div className="grid gap-4 md:grid-cols-4">
          {plans.data?.map(p => (
            <Card key={p.key} className={p.key === 'pro' ? 'ring-2 ring-primary' : ''}>
              <CardHeader><CardTitle>{p.name}</CardTitle>
                <div className="text-2xl font-bold">{inr(p.price_inr)}<span className="text-xs font-normal text-muted-foreground"> / {p.price_inr === 0 ? 'forever' : p.period}</span></div></CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                {[p.quota ? `${p.quota.toLocaleString('en-IN')} certificates / ${p.period}` : 'Unlimited certificates',
                  `${p.branches ?? 'Unlimited'} branch(es)`, p.watermark ? '“Powered by CerGeMA” watermark' : 'No watermark',
                  p.ai_enabled ? (p.ai_free === null ? 'Unlimited AI backgrounds' : p.ai_free ? `${p.ai_free} free AI backgrounds / month` : 'AI backgrounds (credits)') : null,
                  p.modules.join(' · ')].filter(Boolean).map(x => <div key={x as string} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />{x}</div>)}
              </CardContent>
            </Card>))}
        </div>
        {settings.data && <p className="mt-2 text-xs text-muted-foreground">Overage ₹{settings.data.overage_inr} / certificate · AI backgrounds {settings.data.ai_credits_per_run} credits (1 credit = ₹1).</p>}
      </section>
    </div>)
}
