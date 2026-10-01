import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Award, BadgeCheck, Briefcase, Building2, CalendarCheck, Check, ChevronDown, ClipboardList, FileSpreadsheet, GraduationCap,
  Landmark, Languages, Printer, QrCode, ScanLine, Search, Share2, ShieldCheck, Smartphone, Sparkles, Video, Webhook } from 'lucide-react'
import { useRpc } from '@/lib/hooks'
import { useAuth } from '@/lib/auth'
import { useBranding } from '@/lib/branding'
import type { Plan, PublicSettings } from '@/lib/types'
import { DEFAULT_PLANS, DEFAULT_SETTINGS } from '@/lib/defaults'
import { fmtDate, inr } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Seo } from '@/components/Seo'
import { SampleCertificate } from '@/components/landing/SampleCertificate'
import { PlanFinder } from '@/components/landing/PlanFinder'

const STEPS = [
  { icon: Building2, t: 'Create your workspace', d: 'Sign up free with your organisation’s name and logo. Running several campuses? Add them as branches.' },
  { icon: CalendarCheck, t: 'Set up your event', d: 'Add a title, date and venue (or an online link). Pick a certificate design, upload your own, or describe one and let AI draw the border. Drag the name, date and signature exactly where you want them.' },
  { icon: ClipboardList, t: 'Collect your people', d: 'Share your event’s registration link, or upload a CSV / Excel list. Participants type their name in English and हिंदी and confirm it before submitting, so spellings are right the first time.' },
  { icon: ScanLine, t: 'Check in, approve, issue', d: 'Volunteers scan each person’s QR pass with a phone at the gate. Approve who qualifies, press Issue, and every participant gets a certificate. We can notify them by WhatsApp, SMS or email.' },
]
const PROBLEMS = [
  ['Spelling mistakes found after printing', 'Participants confirm their own name before registering, and you can fix any cell in a spreadsheet-style grid; issued certificates update automatically.', Check],
  ['₹15–40 per printed certificate, plus sorting and delivery', 'Certificates are digital. Participants download a print-ready PDF themselves, so there is nothing to print, sort or post.', Printer],
  ['No way to tell a real certificate from a fake one', 'Every certificate carries a QR code. Scanning it shows who it was issued to, for what, and by whom, or says “not found”.', ShieldCheck],
  ['Registration, meetings, attendance and certificates in four different tools', 'One flow: registration page → ID pass → QR check-in → approval → certificate.', Sparkles],
] as const
const FEATURES = [
  [CalendarCheck, 'Registration pages', 'A public page for each event with a map, bilingual form and a “check your details” confirmation.'],
  [QrCode, 'Digital ID pass', 'Each person gets a pass with a QR code the moment they register.'],
  [ScanLine, 'QR gate check-in', 'Scan passes with any phone camera in about a second. Works for volunteers too.'],
  [Languages, 'English + हिंदी', 'Names print correctly in both scripts, with no clipped or broken Devanagari.'],
  [Award, 'Your design', 'Landscape or portrait A4, templates, your own artwork, or an AI-generated border.'],
  [Video, 'Online & hybrid', 'Zoom, Meet or YouTube links shown only to people who registered.'],
  [Share2, 'One-tap sharing', 'Participants share to WhatsApp, LinkedIn or Facebook with a ready-made badge.'],
  [Building2, 'Branches & co-hosts', 'Parent organisation, campuses, joint events with equal-size logos, and sponsor strips.'],
  [FileSpreadsheet, 'Bulk upload', 'Drop a CSV or Excel sheet; bad rows are flagged instead of silently lost.'],
  [Webhook, 'Connects to your school software', 'API and signed webhooks to sync with an ERP / student information system.'],
  [Smartphone, 'Works like an app', 'Installs on a phone from the browser. No app store needed.'],
  [BadgeCheck, 'Your brand', 'On the top plan, your name, colours and web address replace ours.'],
] as const
const USES = [
  [GraduationCap, 'Schools & colleges', 'Annual days, olympiads, sports meets, seminars, NCC / NSS camps, alumni events.'],
  [Landmark, 'Trusts & NGOs', 'Awareness drives, volunteer recognition, campaigns run jointly with partners and sponsors.'],
  [Briefcase, 'Companies & trainers', 'Workshops, training batches, hackathons, internal recognition programmes.'],
  [Video, 'Webinars & hybrid events', 'Gated joining links, attendance-based certificates, one page for the whole lifecycle.'],
] as const
const FAQ = [
  ['Do participants need to create an account?', 'No. They find their certificate with the mobile number they registered with (or the certificate ID), answer two quick feedback questions, then download. No password, no app.'],
  ['Is it really free?', 'Yes. The Free plan lets you issue up to 100 certificates a month with your own logo and design, forever. Registration pages, QR check-in and higher volumes are on paid plans, and the “find your plan” tool above shows exactly which one fits.'],
  ['How does someone know a certificate is genuine?', 'Each certificate has a unique ID and a QR code. Scanning it opens a verification page on this site that shows the holder, event and issuer, or says it does not exist. Organisers can revoke a certificate at any time.'],
  ['I already have the names in a spreadsheet. Can I skip the registration part?', 'Yes. Upload the CSV or Excel file, approve everyone, and press Issue. You never need registration pages or QR check-in if you do not want them.'],
  ['Can I use my own certificate design?', 'Yes: choose a template, upload your own background (A4 landscape or portrait), or describe a border and let AI generate it. Then drag the name, date, signature and QR code into place.'],
  ['Will Hindi and other Devanagari names look right?', 'Yes. Names are captured in English and Devanagari and drawn with proper letter shaping, so conjuncts and matras are not broken.'],
  ['Can several campuses or partner organisations share one event?', 'Yes. A parent organisation can have branches, and a joint event can show a co-host’s logo at the same size as yours, with sponsors in the footer.'],
  ['Where is our data kept, and who can see it?', 'Each organisation’s data is isolated at the database level: other organisations cannot read it. Participants can only see their own certificates. Passwords are never stored in readable form.'],
] as const

function Section({ id, title, sub, children }: { id?: string; title: string; sub?: string; children: React.ReactNode }) {
  return <section id={id} className="scroll-mt-20"><h2 className="text-2xl font-bold md:text-3xl">{title}</h2>{sub && <p className="mt-2 max-w-3xl text-muted-foreground">{sub}</p>}<div className="mt-6">{children}</div></section>
}

/** On a tenant's own domain the page is about *their* events, not about CerGeMA. */
function TenantHome({ name }: { name: string }) {
  const { t } = useTranslation(); const nav = useNavigate(); const [q, setQ] = useState('')
  return (
    <div className="mx-auto max-w-xl space-y-6 py-10 text-center">
      <Seo title={name} /><h1 className="text-3xl font-bold">{name}</h1>
      <p className="text-muted-foreground">{t('lookup_hint')}</p>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); nav(`/claim?q=${encodeURIComponent(q)}`) }} className="flex gap-2">
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder={t('lookup_hint')} required /><Button>{t('find')}</Button></form>
      <p className="text-sm"><Link className="underline" to="/login">Organiser login</Link></p>
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
  const liveSettings = useRpc<PublicSettings>('get_public_settings')
  const plans = { data: livePlans.data ?? DEFAULT_PLANS }          // render at once; live values replace these when ready
  const settings = { data: liveSettings.data ?? DEFAULT_SETTINGS }
  if (b.tenantName) return <TenantHome name={b.tenantName} />
  const console_ = me ? (me.profile.role === 'volunteer' ? '/admin/scan' : me.profile.role === 'affiliate' ? '/admin/partner' : '/admin') : '/signup'

  return (
    <div className="space-y-20">
      <Seo title="CerGeMA: event registration, QR attendance and verified certificates" description={t('landing.hero_sub')} />

      {/* ---------- hero ---------- */}
      <section className="grid items-center gap-8 pt-2 lg:grid-cols-2">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full bg-accent/20 px-3 py-1 text-xs font-medium"><Sparkles className="h-3.5 w-3.5" /> Free for up to 100 certificates a month</div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">{t('landing.hero_title')}</h1>
          <p className="text-lg text-muted-foreground">{t('landing.hero_sub')}</p>
          <div className="flex flex-wrap gap-3">
            <Link to={console_} className={buttonVariants({ size: 'lg' })}>{me ? t('landing.cta_console') : t('landing.cta_org')} <ArrowRight className="h-4 w-4" /></Link>
            <Link to="/claim" className={buttonVariants({ size: 'lg', variant: 'outline' })}>{t('landing.cta_person')}</Link>
          </div>
          <p className="text-xs text-muted-foreground">No card needed · Takes about a minute · Works on any phone or computer</p>
        </div>
        <SampleCertificate />
      </section>

      {/* ---------- who are you ---------- */}
      <section aria-labelledby="who">
        <h2 id="who" className="text-center text-2xl font-bold md:text-3xl">{t('landing.who_title')}</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Card className="flex flex-col"><CardHeader><Building2 className="h-7 w-7 text-primary" /><CardTitle className="pt-2">{t('landing.who_org_t')}</CardTitle></CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-4 text-sm text-muted-foreground"><p>{t('landing.who_org_d')}</p>
              <Link to="/signup" className={buttonVariants() + ' w-full'}>{t('landing.who_org_cta')} <ArrowRight className="h-4 w-4" /></Link></CardContent></Card>
          <Card className="flex flex-col"><CardHeader><Award className="h-7 w-7 text-primary" /><CardTitle className="pt-2">{t('landing.who_person_t')}</CardTitle></CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-4 text-sm text-muted-foreground"><p>{t('landing.who_person_d')}</p>
              <form className="flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); nav(`/claim?q=${encodeURIComponent(mobile)}`) }}>
                <Input value={mobile} onChange={e => setMobile(e.target.value)} placeholder="Mobile number" inputMode="tel" aria-label="Mobile number" required /><Button aria-label={t('landing.who_person_cta')}><Search className="h-4 w-4" /></Button></form></CardContent></Card>
          <Card className="flex flex-col"><CardHeader><ShieldCheck className="h-7 w-7 text-primary" /><CardTitle className="pt-2">{t('landing.who_verify_t')}</CardTitle></CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-4 text-sm text-muted-foreground"><p>{t('landing.who_verify_d')}</p>
              <form className="flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); nav(`/verify/${encodeURIComponent(certId.trim())}`) }}>
                <Input value={certId} onChange={e => setCertId(e.target.value)} placeholder="CGM-XXXXXXXXXX" aria-label="Certificate ID" required className="font-mono uppercase" /><Button variant="secondary">{t('landing.who_verify_cta')}</Button></form></CardContent></Card>
        </div>
      </section>

      {/* ---------- what it is ---------- */}
      <Section title="What is CerGeMA?" sub="CerGeMA is a website for anyone who runs events and needs to give people proof they took part. It covers everything from the first registration to the certificate in a participant’s hands.">
        <div className="grid gap-4 md:grid-cols-2">
          {PROBLEMS.map(([problem, fix, Icon]) => (
            <Card key={problem}><CardContent className="flex gap-4 pt-5"><Icon className="mt-1 h-6 w-6 shrink-0 text-primary" />
              <div><div className="font-semibold">{problem}</div><p className="mt-1 text-sm text-muted-foreground">{fix}</p></div></CardContent></Card>))}
        </div>
      </Section>

      {/* ---------- how it works ---------- */}
      <Section id="how" title="How it works" sub="For organisers, four steps. For participants, there is nothing to sign up for.">
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.t}><Card className="h-full"><CardContent className="pt-5">
              <div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span><s.icon className="h-5 w-5 text-primary" /></div>
              <div className="mt-3 font-semibold">{s.t}</div><p className="mt-1 text-sm text-muted-foreground">{s.d}</p></CardContent></Card></li>))}
        </ol>
        <Card className="mt-4 border-primary/40 bg-primary/5"><CardContent className="grid gap-4 pt-5 md:grid-cols-3">
          <div className="md:col-span-3 font-semibold">And for the participant:</div>
          {[['Enter your mobile number', 'On the “Get my certificate” page. No account, no password.'], ['Answer two quick questions', 'A star rating and optional feedback, which the organiser sees.'], ['Download and share', 'A print-ready PDF or image, plus one-tap sharing. Anyone can verify it from its QR code.']].map(([t1, d1], i) => (
            <div key={t1} className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-accent-foreground">{i + 1}</span><div><div className="font-medium">{t1}</div><p className="text-sm text-muted-foreground">{d1}</p></div></div>))}
        </CardContent></Card>
      </Section>

      {/* ---------- features ---------- */}
      <Section title="Everything in one place" sub="Use the whole flow, or just the part you need.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([Icon, title, d]) => <div key={title} className="flex gap-3 rounded-xl border bg-card p-4"><Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><div className="font-medium">{title}</div><p className="text-sm text-muted-foreground">{d}</p></div></div>)}
        </div>
      </Section>

      {/* ---------- use cases ---------- */}
      <Section title="Who uses it">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {USES.map(([Icon, title, d]) => <Card key={title}><CardContent className="pt-5"><Icon className="h-7 w-7 text-primary" /><div className="mt-2 font-semibold">{title}</div><p className="mt-1 text-sm text-muted-foreground">{d}</p></CardContent></Card>)}
        </div>
      </Section>

      {/* ---------- live events ---------- */}
      {!!events.data?.length && (
        <Section title="Events open for registration right now">
          <div className="grid gap-4 md:grid-cols-3">
            {events.data.map(e => (
              <Link key={e.slug} to={`/events/${e.slug}`}><Card className="h-full transition hover:shadow-md"><CardHeader><CardTitle>{e.title}</CardTitle>{e.title_hi && <p className="text-sm text-muted-foreground">{e.title_hi}</p>}</CardHeader>
                <CardContent className="text-xs capitalize text-muted-foreground">{e.mode}{e.starts_at && ` · ${fmtDate(e.starts_at)}`}</CardContent></Card></Link>))}
          </div>
        </Section>)}

      {/* ---------- plan finder + pricing ---------- */}
      <Section id="plans" title="Find the plan that fits" sub="Tell us what you need and we will show the cheapest plan that covers it, and what the cheaper ones would be missing.">
        <PlanFinder plans={plans.data} />
        <h3 className="mb-3 mt-10 font-semibold">All plans</h3>
        <div className="grid gap-4 md:grid-cols-4">
          {plans.data?.map(p => (
            <Card key={p.key} className={p.key === 'pro' ? 'ring-2 ring-primary' : ''}>
              <CardHeader><CardTitle>{p.name}</CardTitle><div className="text-2xl font-bold">{inr(p.price_inr)}<span className="text-xs font-normal text-muted-foreground"> / {p.price_inr === 0 ? 'forever' : p.period}</span></div></CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                {[p.quota ? `${p.quota.toLocaleString('en-IN')} certificates / ${p.period}` : 'Unlimited certificates', `${p.branches ?? 'Unlimited'} branch(es)`, p.watermark ? '“Powered by CerGeMA” on certificates' : 'No watermark',
                  p.ai_enabled ? (p.ai_free === null ? 'Unlimited AI backgrounds' : p.ai_free ? `${p.ai_free} free AI backgrounds / month` : 'AI backgrounds (pay per use)') : null,
                  p.modules.map(m => m.replace('idpass', 'ID pass').replace('cobrand', 'co-hosts & sponsors').replace('whitelabel', 'own brand & domain')).join(' · ')].filter(Boolean).map(x => <div key={x as string} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />{x}</div>)}
              </CardContent></Card>))}
        </div>
        {settings.data && <p className="mt-2 text-xs text-muted-foreground">Going over your certificate limit? Extra certificates are ₹{settings.data.overage_inr} each. AI backgrounds cost {settings.data.ai_credits_per_run} credits per generation (1 credit = ₹1).</p>}
      </Section>

      {/* ---------- FAQ ---------- */}
      <Section id="faq" title="Questions, answered">
        <div className="mx-auto max-w-3xl divide-y rounded-xl border bg-card">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group p-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">{q}<ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" /></summary>
              <p className="mt-2 text-sm text-muted-foreground">{a}</p></details>))}
        </div>
      </Section>

      {/* ---------- final CTA ---------- */}
      <section className="rounded-2xl bg-primary p-8 text-center text-primary-foreground md:p-12">
        <h2 className="text-2xl font-bold md:text-3xl">Your next event, certified in minutes</h2>
        <p className="mx-auto mt-2 max-w-xl text-primary-foreground/80">Create a free workspace, try it with your own participant list, and upgrade only if you need more.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to={console_} className={buttonVariants({ variant: 'accent', size: 'lg' })}>{me ? t('landing.cta_console') : t('landing.cta_org')}</Link>
          <Link to="/claim" className={buttonVariants({ variant: 'outline', size: 'lg' }) + ' bg-transparent text-white hover:bg-white/10'}>{t('landing.cta_person')}</Link>
        </div>
      </section>
    </div>)
}
