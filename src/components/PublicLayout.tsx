import { Link, Outlet } from 'react-router-dom'
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
  return (
    <header className="bg-primary text-primary-foreground">
      <div className="container flex items-center gap-4 py-3">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold"><img src={b.logo} alt="" className="h-8 w-8 rounded bg-white/10 object-contain" />{b.appName}</Link>
        {!b.hideBranding && <span className="hidden text-xs text-blue-200 md:inline">{t('tagline')}</span>}
        <nav className="ml-auto flex items-center gap-4 text-sm">
          <Link className="hover:text-accent" to="/claim">{t('nav.claim')}</Link>
          {me ? <>
            {!admin && <Link className="hover:text-accent" to={me.profile.role === 'volunteer' ? '/admin/scan' : me.profile.role === 'affiliate' ? '/admin/partner' : '/admin'}>{t('nav.console')}</Link>}
            <button className="hover:text-accent" onClick={() => signOut()}>{t('nav.logout')}</button>
          </> : <Link className="hover:text-accent" to="/login">{t('nav.login')}</Link>}
          <LanguageSwitch />
        </nav>
      </div>
    </header>)
}

export function PublicLayout() {
  const b = useBranding()
  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <Header />
      <main className="container flex-1 py-6"><Outlet /></main>
      <footer className="py-6 text-center text-xs text-muted-foreground">
        © {b.tenantName ?? 'CerGeMA'} {!b.hideBranding && <>· Mangal Hands · <Link className="underline" to="/claim">Get my certificate</Link></>}
      </footer>
    </div>)
}

