import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { BarChart3, Building2, CalendarDays, CreditCard, Gift, Handshake, Layers, ScanLine, Settings } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { DemoBanner, Header } from './PublicLayout'

const LINKS = [
  { to: '/admin', label: 'Dashboard', icon: BarChart3, roles: ['super', 'org_admin'], end: true },
  { to: '/admin/events', label: 'Events', icon: CalendarDays, roles: ['super', 'org_admin'] },
  { to: '/admin/orgs', label: 'Organisations', icon: Building2, roles: ['super', 'org_admin'] },
  { to: '/admin/scan', label: 'Scan', icon: ScanLine, roles: ['super', 'org_admin', 'volunteer'] },
  { to: '/admin/billing', label: 'Billing & Wallet', icon: CreditCard, roles: ['super', 'org_admin'] },
  { to: '/admin/plans', label: 'Plans', icon: Layers, roles: ['super'] },
  { to: '/admin/affiliates', label: 'Affiliates', icon: Gift, roles: ['super'] },
  { to: '/admin/settings', label: 'Settings', icon: Settings, roles: ['super'] },
  { to: '/admin/partner', label: 'Partner portal', icon: Handshake, roles: ['affiliate'] },
]

export function AdminLayout() {
  const { me, loading, needsOnboarding } = useAuth()
  if (loading) return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>
  if (needsOnboarding) return <Navigate to="/onboarding" replace />
  if (!me) return <Navigate to="/login" replace />
  const links = LINKS.filter(l => l.roles.includes(me.profile.role))
  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <Header admin />
      <div className="border-b bg-card">
        <div className="container flex gap-1 overflow-x-auto text-sm">
          {links.map(l => (
            <NavLink key={l.to} to={l.to} end={l.end}
              className={({ isActive }) => cn('flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3', isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground hover:text-primary')}>
              <l.icon className="h-4 w-4" />{l.label}
            </NavLink>))}
        </div>
      </div>
      <main className="container flex-1 py-6"><Outlet /></main>
    </div>)
}

export function RoleGate({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { me } = useAuth()
  if (!me) return null
  if (!roles.includes(me.profile.role)) return <Navigate to={me.profile.role === 'volunteer' ? '/admin/scan' : me.profile.role === 'affiliate' ? '/admin/partner' : '/admin'} replace />
  return <>{children}</>
}
