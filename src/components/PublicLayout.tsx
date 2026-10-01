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
    <button className="flex items-center gap-1 rounded border border-white/40 px-2 py-0.5 text-xs" aria-label="Change language"
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
  return (
    <header className="sticky top-0 z-40 bg-primary text-primary-foreground">
      <div className="container flex items-center gap-4 py-3">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold"><img src={b.logo} alt="" className="h-8 w-8 rounded bg-white/10 object-contain" />{b.appName}</Link>
        {anchors && <nav className="ml-6 hidden items-center gap-5 text-sm md:flex" aria-label="Sections">
          <Link className="hover:text-accent" to={{ pathname: '/', hash: '#how' }}>{t('nav.how')}</Link>
          <Link className="hover:text-accent" to={{ pathname: '/', hash: '#plans' }}>{t('nav.plans')}</Link>
          <Link className="hover:text-accent" to={{ pathname: '/', hash: '#faq' }}>{t('nav.faq')}</Link></nav>}
        <nav className="ml-auto flex items-center gap-3 text-sm sm:gap-4">
          <Link className="hidden hover:text-accent sm:inline" to="/claim">{t('nav.claim')}</Link>
          {me ? <>
            {!admin && <Link className="hover:text-accent" to={home}>{t('nav.console')}</Link>}
            <button className="hover:text-accent" onClick={() => signOut()}>{t('nav.logout')}</button>
          </> : <>
            <Link className="hover:text-accent" to="/login">{t('nav.login')}</Link>
            {!b.tenantName && <Link className="rounded-md bg-accent px-3 py-1.5 font-semibold text-accent-foreground hover:bg-accent/90" to="/signup">{t('nav.start')}</Link>}
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
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <Header />
      <main className="container flex-1 py-6"><Outlet /></main>
      <footer className="py-6 text-center text-xs text-muted-foreground">
        © {b.tenantName ?? 'CerGeMA'} {!b.hideBranding && <>· <Link className="underline" to="/claim">Get my certificate</Link></>}
      </footer>
    </div>)
}

