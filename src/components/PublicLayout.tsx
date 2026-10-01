import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useBranding } from '@/lib/branding'
import { LANGUAGES } from '@/i18n'
import { isDemo, backend } from '@/lib/backend'

export function DemoBanner() {
  if (!isDemo) return null
  return (
    <div className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
      Demo mode: a full Postgres runs inside your browser; nothing is sent to a server.
      <button className="ml-2 underline" onClick={async () => { await (await backend()).reset?.() }}>Reset demo data</button>
    </div>)
}

export function LanguageSwitch() {
  const { i18n } = useTranslation()
  const cur = i18n.resolvedLanguage ?? 'en'
  return (
    <button className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground" aria-label="Change language"
      onClick={() => { const i = LANGUAGES.findIndex(l => l.code === cur); i18n.changeLanguage(LANGUAGES[(i + 1) % LANGUAGES.length].code) }}>
      <Languages className="h-3 w-3" /> {LANGUAGES.find(l => l.code !== cur)?.label}
    </button>)
}

export function Header({ admin }: { admin?: boolean }) {
  const { t } = useTranslation()
  const { me, signOut } = useAuth()
  const b = useBranding()
  const home = me ? (me.profile.role === 'volunteer' ? '/admin/scan' : me.profile.role === 'affiliate' ? '/admin/partner' : '/admin') : '/signup'
  const anchors = !admin && !b.tenantName
  const link = 'text-sm text-muted-foreground transition hover:text-foreground'
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="container flex items-center gap-4 py-3">
        <Link to="/" className="flex items-center gap-2.5">
          {b.tenantName ? <img src={b.logo} alt="" className="h-8 w-8 rounded object-contain" />
            : <span className="grid h-8 w-8 place-items-center rounded-md bg-primary font-display text-xl leading-none text-primary-foreground">C</span>}
          <span className="font-display text-2xl leading-none">{b.appName}</span>
        </Link>
        {anchors && <nav className="mx-auto hidden items-center gap-10 md:flex" aria-label="Sections">
          <Link className={link} to={{ pathname: '/', hash: '#organise' }}>{t('nav.organise')}</Link>
          <Link className={link} to={{ pathname: '/', hash: '#attend' }}>{t('nav.attend')}</Link>
          <Link className={link} to={{ pathname: '/', hash: '#verify' }}>{t('nav.verify')}</Link></nav>}
        <nav className="ml-auto flex items-center gap-3 sm:gap-5">
          {anchors && <Link className={link + ' hidden lg:inline'} to={{ pathname: '/', hash: '#verify' }}>{t('nav.verify_cert')}</Link>}
          {admin && <Link className={link} to="/claim">{t('nav.claim')}</Link>}
          {me ? <>
            {!admin && <Link className={link} to={home}>{t('nav.console')}</Link>}
            <button className={link} onClick={() => signOut()}>{t('nav.logout')}</button>
          </> : <>
            <Link className={link} to="/login">{t('nav.login')}</Link>
            {!b.tenantName && <Link className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90" to="/signup">{t('nav.organise_cta')}</Link>}
          </>}
          <LanguageSwitch />
        </nav>
      </div>
    </header>)
}

export function PublicLayout() {
  const b = useBranding()
  const { hash, pathname } = useLocation()
  useEffect(() => { if (hash) setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 50); else window.scrollTo(0, 0) }, [hash, pathname])
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <DemoBanner />
      <Header />
      <main className="container flex-1 py-6"><Outlet /></main>
      <footer className="py-6 text-center text-xs text-muted-foreground">
        © {b.tenantName ?? 'CerGeMA'} {!b.hideBranding && <>· <Link className="underline" to="/claim">Get my certificate</Link></>}
      </footer>
    </div>)
}

