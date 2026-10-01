import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { useIsDesktop, useRpc } from '@/lib/hooks'
import { useAuth } from '@/lib/auth'
import { useBranding } from '@/lib/branding'
import type { Plan } from '@/lib/types'
import { DEFAULT_PLANS, priceLabel } from '@/lib/defaults'
import { fmtDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Seo } from '@/components/Seo'
import { SampleCertificate } from '@/components/landing/SampleCertificate'
import { PlanFinder } from '@/components/landing/PlanFinder'

/* Everything below is taken from the product SRS: no statistics, claims or features that the SRS does not state. */

const OLD_WAY = 'Spelling mistakes are found after printing. Certificates cost ₹15 to ₹40 each in paper and printing, sorting and delivery is slow, and a paper or flat PDF certificate has no way to prove it is genuine.'
const NEW_WAY = 'Participants confirm their details before submitting, admins correct entries in a spreadsheet-style editor, and every certificate carries a QR code that opens a real-time verification record.'

const COMPARE: [string, string, string][] = [
  ['Data intake', 'Unstructured Google Forms, paper rosters, messy sheets', 'Self-service bilingual form with participant preview confirmation'],
  ['Spelling corrections', 'Discovered post-print; costly reprints and manual editing', 'Pre-submission validation + admin inline spreadsheet-style quick edit'],
  ['Verification', 'Non-existent; paper certificates are easily forged', 'Tamper-proof real-time verification via unique dynamic QR code'],
  ['Distribution', 'Manual one-by-one emailing or hand distribution', 'Instant self-service retrieval via mobile number lookup'],
  ['Full lifecycle', 'Fragmented tools (separate forms, meetings, and designers)', 'Unified flow: Landing Page → ID Pass → Attendance → Certificate'],
]

const STEPS: [string, string][] = [
  ['Create your workspace', 'Add your organisation’s name, logo and branches.'],
  ['Set up the event', 'Choose the details and place each certificate field.'],
  ['Collect your people', 'Share a registration link or upload your existing list.'],
  ['Check in & issue', 'Scan QR passes, approve attendees and issue certificates.'],
]

const PARTICIPANT: [string, string][] = [
  ['Enter your number', 'Your registered mobile number or certificate ID.'],
  ['Share quick feedback', 'A rating and a short note before the download unlocks.'],
  ['Download & share', 'A 300 DPI print-ready PDF or image, shared in one tap to WhatsApp Status, LinkedIn or Facebook.'],
]

const MODULES: [string, string, string][] = [
  ['A', 'Certificate & credentialing', 'Landscape and Portrait A4. Academic templates or your own background with drag-and-drop mapping of name, grade, QR and signatures. A dynamic verification QR and a configurable feedback gate.'],
  ['B', 'Event lifecycle', 'Offline with venue mapping and arrival instructions, online with links gated to registered attendees (Zoom, Google Meet, YouTube Live), or hybrid where each person picks. A public, search-friendly registration page with bilingual intake in English and Devanagari.'],
  ['C', 'Digital ID pass & QR attendance', 'A digital badge with a scannable QR token the moment someone registers. A mobile camera scanner for coordinators and volunteers at the gate, and an optional rule that only attendees marked “Present” receive certificates.'],
  ['D', 'Branches, co-hosts & sponsors', 'A parent organisation with its branches, joint events with both crests shown in equal proportion, and a “Supported By” / “Powered By” strip for sponsors.'],
  ['E', 'AI design engine', 'Describe a border or background in words and get generated artwork, gated by credits from your prepaid wallet.'],
  ['F', 'Integrations & your brand', 'Connect a school ERP or student information system through a REST API and webhooks. On the top plan, use full white-label with your own subdomain.'],
]

const AUDIENCE: [string, string][] = [
  ['Educational institutions', 'Inter-school olympiads, national symposiums and collegiate events.'],
  ['Civic trusts', 'Civic awareness programs and native-language recognition drives.'],
  ['Corporate organisers', 'Webinars and hybrid seminars, from registration to certificate.'],
  ['Campaigns', 'Environmental campaigns and other mass-impact initiatives run jointly with partners.'],
]

const TIERS = [
  { row: 'Certificate quota', cells: ['100 certs / month', '1,000 certs / event', '15,000 certs / year', 'Unlimited / custom bulk quota'] },
  { row: 'Branches', cells: ['1 branch unit', '1 branch unit', 'Up to 3 branches', 'Unlimited branches + HQ master console'] },
  { row: 'Branding & watermark', cells: ['“Powered by CerGeMA”', 'Zero watermark (100% your own)', 'Own logo + co-hosts + sponsors', 'Full white-label + custom subdomain'] },
  { row: 'Active modules', cells: ['Certificate engine only', 'Certificates + registration', 'Certificates + event lifecycle hub', 'Certificates + events + ID pass / attendance'] },
  { row: 'AI design credits', cells: ['None', 'Wallet top-up basis', '5 free AI generations / month', 'Unlimited / priority processing queue'] },
]

const FAQ: [string, string][] = [
  ['Do recipients need a password?', 'No. Recipients, parents and students claim their verified credential at any time with the mobile number they registered with, or the certificate ID.'],
  ['How can anyone check that a certificate is genuine?', 'Each certificate carries a QR code that links to its verification page for real-time authenticity validation.'],
  ['Can I start from a list I already have?', 'Yes. Upload a CSV or Excel participant list and correct entries inline, or share a registration link instead.'],
  ['Are Hindi names supported?', 'Yes. Names are captured in English and Devanagari, and certificates use a bilingual typography engine that prevents clipped or distorted text.'],
  ['Can I run online or hybrid events?', 'Yes. Links for Zoom, Google Meet or YouTube Live are shown only to registered attendees, and in hybrid events each participant selects how they will attend.'],
  ['Is there a free plan?', 'Yes. The Free Community plan costs ₹0, issues 100 certificates a month and adds a “Powered by CerGeMA” watermark.'],
  ['What if I go over my certificate limit?', 'Extra certificates are billed at ₹0.50 to ₹1.00 per approved certificate. AI backgrounds use 10 to 15 credits per run, where 1 credit = ₹1.'],
  ['How do I pay?', 'In India: UPI, net banking and corporate cards. Internationally: card payments in US dollars with corporate invoices.'],
  ['Is my organisation’s data kept separate?', 'Yes. The platform is multi-tenant with data isolation and role-based access.'],
]

const cell = 'border-border p-6 md:p-7'

/** On a tenant's own domain the page is about *their* events, not about CerGeMA. */
function TenantHome({ name }: { name: string }) {
  const { t } = useTranslation(); const nav = useNavigate(); const [q, setQ] = useState('')
  return (
    <div className="mx-auto max-w-xl space-y-6 py-12 text-center">
      <Seo title={name} /><h1 className="font-display text-5xl">{name}</h1>
      <p className="text-muted-foreground">{t('lookup_hint')}</p>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); nav(`/claim?q=${encodeURIComponent(q)}`) }} className="flex gap-2">
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder={t('lookup_hint')} required /><Button>{t('find')}</Button></form>
    </div>)
}

export default function Landing() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { me } = useAuth()
  const b = useBranding()
  const [mobile, setMobile] = useState(''); const [certId, setCertId] = useState('')
  const events = useRpc<{ slug: string; title: string; title_hi: string; mode: string; starts_at: string | null }[]>('list_open_events')
  const livePlans = useRpc<Plan[]>('list_plans')
  const desktop = useIsDesktop()
  const plans = livePlans.data ?? DEFAULT_PLANS              // render at once; live values replace these when ready
  if (b.tenantName) return <TenantHome name={b.tenantName} />
  const start = me ? (me.profile.role === 'volunteer' ? '/admin/scan' : me.profile.role === 'affiliate' ? '/admin/partner' : '/admin') : '/signup'
  const primary = 'inline-flex h-12 md:h-11 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90'
  const outline = 'inline-flex h-12 md:h-11 items-center justify-center rounded-md border border-input bg-card px-6 text-sm font-medium hover:bg-secondary'

  return (
    <div className="space-y-16 pb-10 md:space-y-28">
      <Seo title="CerGeMA | Smart Events, Instant Certificates" description={t('landing.sub')} />

      {/* ---------------- hero ---------------- */}
      <section className="grid items-center gap-8 pt-2 md:gap-12 md:pt-8 lg:grid-cols-2">
        <div>
          <div className="eyebrow">{t('landing.eyebrow')}</div>
          <h1 className="font-display mt-5 text-[2.75rem] leading-[0.98] sm:text-6xl md:mt-6 md:text-7xl">{t('landing.t_pre')}<em className="text-accent">{t('landing.t_em')}</em>{' '}<br />{t('landing.t_post')}</h1>
          <p className="mt-5 max-w-md text-base text-muted-foreground md:mt-7 md:text-lg">{t('landing.sub')}</p>
          <p className="mt-2 font-display text-2xl italic text-muted-foreground" lang="hi">{t('landing.tagline_hi')}</p>
          <div className="mt-7 grid gap-3 sm:flex sm:flex-wrap md:mt-8">
            <Link to={start} className={primary}>{me ? t('landing.cta_console') : t('landing.cta_org')}</Link>
            <Link to={{ pathname: '/', hash: '#verify' }} className={outline}>{t('landing.cta_lookup')}</Link>
          </div>
        </div>
        <SampleCertificate />
      </section>

      {/* ---------------- who ---------------- */}
      <section aria-labelledby="who">
        <h2 id="who" className="font-display text-4xl md:text-5xl">{t('landing.who_title')}</h2>
        <div className="mt-6 grid overflow-hidden rounded-xl border bg-card md:mt-8 md:grid-cols-3 md:divide-x">
          <div id="organise" className={cell + ' scroll-mt-24'}>
            <div className="eyebrow">{t('landing.o_kicker')}</div><h3 className="font-display mt-6 text-3xl">{t('landing.o_t')}</h3>
            <p className="mt-3 text-muted-foreground">{t('landing.o_d')}</p>
            <Link to={start} className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-semibold hover:text-accent md:mt-6 md:min-h-0">{t('landing.o_cta')} <ArrowRight className="h-4 w-4" /></Link>
          </div>
          <div id="attend" className={cell + ' scroll-mt-24 border-t md:border-t-0'}>
            <div className="eyebrow">{t('landing.r_kicker')}</div><h3 className="font-display mt-6 text-3xl">{t('landing.r_t')}</h3>
            <p className="mt-3 text-muted-foreground">{t('landing.r_d')}</p>
            <form className="mt-6 flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); nav(`/claim?q=${encodeURIComponent(mobile)}`) }}>
              <Input value={mobile} onChange={e => setMobile(e.target.value)} placeholder="Mobile number or certificate ID" aria-label="Mobile number or certificate ID" required />
              <Button variant="outline" aria-label={t('landing.r_cta')}><ArrowRight className="h-4 w-4" /></Button></form>
          </div>
          <div id="verify" className={cell + ' scroll-mt-24 border-t md:border-t-0'}>
            <div className="eyebrow">{t('landing.v_kicker')}</div><h3 className="font-display mt-6 text-3xl">{t('landing.v_t')}</h3>
            <p className="mt-3 text-muted-foreground">{t('landing.v_d')}</p>
            <form className="mt-6 flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); nav(`/verify/${encodeURIComponent(certId.trim())}`) }}>
              <Input value={certId} onChange={e => setCertId(e.target.value)} placeholder="CGM-XXXXXXXXXX" aria-label="Certificate ID" required className="font-mono uppercase" />
              <Button variant="outline">{t('landing.v_cta')}</Button></form>
          </div>
        </div>
      </section>

      {/* ---------------- why it matters ---------------- */}
      <section>
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr_1.2fr] lg:gap-10">
          <div><div className="eyebrow">Why it matters</div><h2 className="font-display mt-5 text-4xl leading-none sm:text-5xl">Paper certificates vanish. Trust shouldn’t.</h2></div>
          <div className="border-l-2 border-border pl-6"><div className="eyebrow !text-muted-foreground">The old way</div><p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg md:leading-relaxed">{OLD_WAY}</p></div>
          <div className="border-l-2 border-accent pl-6"><div className="eyebrow">The CerGeMA way</div><p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg md:leading-relaxed">{NEW_WAY}</p></div>
        </div>
        {!desktop ? (
          <div className="mt-8 space-y-3" role="list" aria-label="Traditional methods compared with CerGeMA">
            {COMPARE.map(([k, a, c]) => (
              <div key={k} role="listitem" className="rounded-xl border bg-card p-5">
                <h3 className="font-display text-2xl">{k}</h3>
                <div className="eyebrow mt-3 !text-muted-foreground">Traditional methods</div><p className="mt-1 text-sm text-muted-foreground">{a}</p>
                <div className="eyebrow mt-3">CerGeMA</div><p className="mt-1 text-sm">{c}</p>
              </div>))}
          </div>
        ) : (
        <div className="mt-10 overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">Traditional methods compared with CerGeMA</caption>
            <thead><tr className="border-b text-xs uppercase tracking-[0.15em] text-muted-foreground"><th className="p-4 font-semibold">&nbsp;</th><th className="p-4 font-semibold">Traditional methods (Canva, slides, print)</th><th className="p-4 font-semibold text-accent">CerGeMA</th></tr></thead>
            <tbody>{COMPARE.map(([k, a, c]) => <tr key={k} className="border-b last:border-0 align-top"><th scope="row" className="p-4 font-display text-xl font-normal">{k}</th><td className="p-4 text-muted-foreground">{a}</td><td className="p-4">{c}</td></tr>)}</tbody>
          </table>
        </div>)}
      </section>

      {/* ---------------- how organisers run it ---------------- */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="font-display text-4xl md:text-5xl">How organisers run it</h2><p className="text-sm text-muted-foreground">Four steps, from invite to certificate.</p></div>
        <ol className="mt-8 grid overflow-hidden rounded-xl border bg-card md:grid-cols-2 md:divide-x lg:grid-cols-4">
          {STEPS.map(([title, d], i) => (
            <li key={title} className="border-b p-6 last:border-b-0 md:p-7 lg:border-b-0"><div className="font-display text-5xl text-accent">{String(i + 1).padStart(2, '0')}</div>
              <h3 className="font-display mt-6 text-2xl">{title}</h3><p className="mt-2 text-muted-foreground">{d}</p></li>))}
        </ol>
      </section>

      {/* ---------------- participants (dark band) ---------------- */}
      <section id="participants" className="relative left-1/2 w-screen -translate-x-1/2 bg-primary py-14 text-primary-foreground md:py-20">
        <div className="container grid gap-12 lg:grid-cols-[1fr_2fr]">
          <div><div className="eyebrow !text-emerald-400">For participants</div><h2 className="font-display mt-5 text-4xl leading-none sm:text-5xl">No password. Just your certificate.</h2></div>
          <ol className="grid gap-8 md:grid-cols-3">
            {PARTICIPANT.map(([title, d], i) => <li key={title} className="border-t border-primary-foreground/25 pt-5"><div className="font-display text-4xl text-emerald-400">{i + 1}</div><h3 className="mt-5 font-medium">{title}</h3><p className="mt-1 text-sm text-primary-foreground/70">{d}</p></li>)}
          </ol>
        </div>
      </section>

      {/* ---------------- modules ---------------- */}
      <section>
        <div className="eyebrow">Plug-and-play modules</div>
        <h2 className="font-display mt-4 text-4xl md:text-5xl">Switch on only what you need.</h2>
        <div className="mt-8 grid overflow-hidden rounded-xl border bg-card sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map(([k, title, d]) => (
            <div key={k} className="border-b p-6 sm:border-r md:p-7"><div className="eyebrow">Module {k}</div><h3 className="font-display mt-5 text-2xl">{title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{d}</p></div>))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Works as a responsive site on desktop and installs as a standalone app on a phone.</p>
      </section>

      {/* ---------------- audience ---------------- */}
      <section>
        <h2 className="font-display text-4xl md:text-5xl">Built for mass-impact initiatives</h2>
        <div className="mt-8 grid overflow-hidden rounded-xl border bg-card sm:grid-cols-2 lg:grid-cols-4 lg:divide-x">
          {AUDIENCE.map(([title, d]) => <div key={title} className="border-b p-6 last:border-b-0 md:p-7 lg:border-b-0"><h3 className="font-display text-2xl">{title}</h3><p className="mt-2 text-sm text-muted-foreground">{d}</p></div>)}
        </div>
      </section>

      {!!events.data?.length && (
        <section>
          <h2 className="font-display text-4xl md:text-5xl">Open for registration</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {events.data.map(e => (
              <Link key={e.slug} to={`/events/${e.slug}`} className="rounded-xl border bg-card p-6 transition hover:shadow-md">
                <h3 className="font-display text-2xl">{e.title}</h3>{e.title_hi && <p className="text-sm text-muted-foreground">{e.title_hi}</p>}
                <p className="mt-3 text-xs capitalize text-muted-foreground">{e.mode}{e.starts_at && ` · ${fmtDate(e.starts_at)}`}</p></Link>))}
          </div>
        </section>)}

      {/* ---------------- plans ---------------- */}
      <section id="plans" className="scroll-mt-24">
        <div className="eyebrow">Plans</div>
        <h2 className="font-display mt-4 text-4xl md:text-5xl">Find the plan that fits.</h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">Tick what you need and we will name the lowest plan that includes it, and what the plan below would be missing.</p>
        <div className="mt-8"><PlanFinder plans={plans} /></div>

        {!desktop ? (
          <div className="mt-10 space-y-3" role="list" aria-label="Plan comparison">
            {plans.map((p, pi) => { const pl = priceLabel(p); return (
              <div key={p.key} role="listitem" className={`rounded-xl border bg-card p-5 ${p.key === 'pro' ? 'ring-2 ring-primary' : ''}`}>
                <div className="eyebrow">{p.name}</div>
                <div className="font-display mt-1 text-4xl">{pl.amount}</div><div className="text-xs text-muted-foreground">{pl.per}</div>
                <dl className="mt-4 divide-y text-sm">
                  {TIERS.map(t_ => <div key={t_.row} className="grid grid-cols-[7.5rem_1fr] gap-3 py-2.5"><dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{t_.row}</dt><dd>{t_.cells[pi]}</dd></div>)}
                </dl>
              </div>) })}
          </div>
        ) : (
        <div className="mt-12 overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[820px] text-left text-sm">
            <caption className="sr-only">Plan comparison</caption>
            <thead><tr className="border-b align-bottom">
              <th className="w-44 p-4" />
              {plans.map(p => { const pl = priceLabel(p); return (
                <th key={p.key} className={`p-4 font-normal ${p.key === 'pro' ? 'bg-primary/5' : ''}`}><div className="eyebrow">{p.name}</div>
                  <div className="font-display mt-2 text-3xl">{pl.amount}</div><div className="text-xs text-muted-foreground">{pl.per}</div></th>) })}
            </tr></thead>
            <tbody>{TIERS.map(t_ => (
              <tr key={t_.row} className="border-b last:border-0 align-top"><th scope="row" className="p-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t_.row}</th>
                {t_.cells.map((c, i) => <td key={i} className={`p-4 ${i === 2 ? 'bg-primary/5' : ''}`}>{c}</td>)}</tr>))}</tbody>
          </table>
        </div>)}
        <p className="mt-3 text-xs text-muted-foreground">1 credit = ₹1. AI backgrounds use 10 to 15 credits per run. Certificates beyond a plan’s limit are billed at ₹0.50 to ₹1.00 per approved certificate.</p>
      </section>

      {/* ---------------- faq ---------------- */}
      <section id="faq" className="scroll-mt-24">
        <h2 className="font-display text-4xl md:text-5xl">Questions</h2>
        <div className="mt-8 divide-y rounded-xl border bg-card">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group"><summary className="flex min-h-14 cursor-pointer list-none md:min-h-0 items-center justify-between gap-4 p-5 font-medium">{q}<ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" /></summary>
              <p className="max-w-3xl px-5 pb-5 text-muted-foreground">{a}</p></details>))}
        </div>
      </section>

      {/* ---------------- closing ---------------- */}
      <section className="rounded-2xl bg-primary p-8 text-center text-primary-foreground md:p-16">
        <h2 className="font-display text-4xl sm:text-5xl md:text-6xl">Smart Events, <em className="text-emerald-400">Instant</em> Certificates.</h2>
        <div className="mt-8 grid gap-3 sm:flex sm:flex-wrap sm:justify-center">
          <Link to={start} className="inline-flex h-12 justify-center sm:h-11 items-center rounded-md bg-accent px-6 text-sm font-semibold text-accent-foreground hover:bg-accent/90">{me ? t('landing.cta_console') : t('landing.cta_org')}</Link>
          <Link to="/claim" className="inline-flex h-12 items-center justify-center rounded-md border border-primary-foreground/40 sm:h-11 px-6 text-sm font-medium hover:bg-primary-foreground/10">{t('landing.cta_lookup')}</Link>
        </div>
      </section>
    </div>)
}
