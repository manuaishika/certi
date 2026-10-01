import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Languages, Menu, X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useBranding } from '@/lib/branding'
import { LANGUAGES } from '@/i18n'
import { cn } from '@/lib/utils'
import { isDemo, backend } from '@/lib/backend'

export function DemoBanner() {
  if (!isDemo) return null
  return (
    <div className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
      <span className="hidden sm:inline">Demo mode: a full Postgres runs inside your browser; nothing is sent to a server.</span>
      <span className="sm:hidden">Demo mode: runs entirely in your browser.</span>
      <button className="ml-2 inline-flex min-h-8 items-center px-1 underline md:min-h-0 md:px-0" onClick={async () => { await (await backend()).reset?.() }}>Reset demo data</button>
    </div>)
}

export function LanguageSwitch({ className }: { className?: string }) {
  const { i18n } = useTranslation()
  const cur = i18n.resolvedLanguage ?? 'en'
  return (
    <button className={cn('flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground', className)} aria-label="Change language"
      onClick={() => { const i = LANGUAGES.findIndex(l => l.code === cur); i18n.changeLanguage(LANGUAGES[(i + 1) % LANGUAGES.length].code) }}>
      <Languages className="h-3 w-3" /> {LANGUAGES.find(l => l.code !== cur)?.label}
    </button>)
}

export function Header({ admin }: { admin?: boolean }) {
  const { t } = useTranslation()
  const { me, signOut } = useAuth()
  const b = useBranding()
  const { pathname, hash } = useLocation()
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [pathname, hash])
  const home = me ? (me.profile.role === 'volunteer' ? '/admin/scan' : me.profile.role === 'affiliate' ? '/admin/partner' : '/admin') : '/signup'
  const anchors = !admin && !b.tenantName
  const link = 'text-sm text-muted-foreground transition hover:text-foreground'
  const mlink = 'flex min-h-12 items-center border-b border-border/60 text-base text-foreground'
  const cta = !me && !b.tenantName
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="container flex items-center gap-3 py-3 md:gap-4">
        <Link to="/" className="flex min-h-11 items-center gap-2.5 md:min-h-0">
          {b.tenantName ? <img src={b.logo} alt="" className="h-8 w-8 rounded object-contain" />
            : <span className="grid h-8 w-8 place-items-center rounded-md bg-primary font-display text-xl leading-none text-primary-foreground">C</span>}
          <span className="font-display text-2xl leading-none">{b.appName}</span>
        </Link>

        {/* desktop (unchanged) */}
        {anchors && <nav className="mx-auto hidden items-center gap-10 md:flex" aria-label="Sections">
          <Link className={link} to={{ pathname: '/', hash: '#organise' }}>{t('nav.organise')}</Link>
          <Link className={link} to={{ pathname: '/', hash: '#attend' }}>{t('nav.attend')}</Link>
          <Link className={link} to={{ pathname: '/', hash: '#verify' }}>{t('nav.verify')}</Link></nav>}
        <nav className="ml-auto hidden items-center gap-5 md:flex">
          {anchors && <Link className={link + ' hidden lg:inline'} to={{ pathname: '/', hash: '#verify' }}>{t('nav.verify_cert')}</Link>}
          {admin && <Link className={link} to="/claim">{t('nav.claim')}</Link>}
          {me ? <>
            {!admin && <Link className={link} to={home}>{t('nav.console')}</Link>}
            <button className={link} onClick={() => signOut()}>{t('nav.logout')}</button>
          </> : <>
            <Link className={link} to="/login">{t('nav.login')}</Link>
            {cta && <Link className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90" to="/signup">{t('nav.organise_cta')}</Link>}
          </>}
          <LanguageSwitch />
        </nav>

        {/* phone: one primary action + a menu */}
        <div className="ml-auto flex items-center gap-2 md:hidden">
          {cta && <Link className="hidden h-11 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground min-[420px]:inline-flex" to="/signup">{t('nav.organise_cta')}</Link>}
          <button type="button" aria-label="Menu" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen(o => !o)}
            className="grid h-11 w-11 place-items-center rounded-md border border-border bg-card">{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
        </div>
      </div>
      {open && (
        <div id="mobile-menu" className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t bg-background md:hidden">
          <nav className="container flex flex-col pb-4" aria-label="Menu">
            {anchors && <>
              <Link className={mlink} to={{ pathname: '/', hash: '#organise' }}>{t('nav.organise')}</Link>
              <Link className={mlink} to={{ pathname: '/', hash: '#attend' }}>{t('nav.attend')}</Link>
              <Link className={mlink} to={{ pathname: '/', hash: '#verify' }}>{t('nav.verify_cert')}</Link>
              <Link className={mlink} to={{ pathname: '/', hash: '#plans' }}>{t('nav.plans')}</Link></>}
            <Link className={mlink} to="/claim">{t('nav.claim')}</Link>
            {me ? <>
              {!admin && <Link className={mlink} to={home}>{t('nav.console')}</Link>}
              <button className={mlink + ' w-full text-left'} onClick={() => signOut()}>{t('nav.logout')}</button>
            </> : <Link className={mlink} to="/login">{t('nav.login')}</Link>}
            {cta && <Link className="mt-3 inline-flex h-12 items-center justify-center rounded-md bg-primary text-base font-semibold text-primary-foreground" to="/signup">{t('nav.organise_cta')}</Link>}
            <LanguageSwitch className="mt-3 h-11 w-fit px-3 text-sm" />
          </nav>
        </div>)}
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
        © {b.tenantName ?? 'CerGeMA'} {!b.hideBranding && <>· <Link className="underline max-md:inline-flex max-md:min-h-11 max-md:items-center" to="/claim">Get my certificate</Link></>}
      </footer>
    </div>)
}

