import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { PublicLayout } from './components/PublicLayout'
import { AdminLayout, RoleGate } from './components/AdminLayout'
import Landing from './pages/public/Landing'
import EventPage from './pages/public/EventPage'
import PassPage from './pages/public/PassPage'
import ClaimPage from './pages/public/ClaimPage'
import CertificatePage from './pages/public/CertificatePage'
import VerifyPage from './pages/public/VerifyPage'
import LoginPage from './pages/public/LoginPage'
import Dashboard from './pages/admin/Dashboard'
import Events from './pages/admin/Events'
import EventNew from './pages/admin/EventNew'
import EventDetail from './pages/admin/EventDetail'
import Orgs from './pages/admin/Orgs'
import Billing from './pages/admin/Billing'
import Plans from './pages/admin/Plans'
import Affiliates from './pages/admin/Affiliates'
import Partner from './pages/admin/Partner'
import Settings from './pages/admin/Settings'

// heavier admin screens are code-split
const Designer = lazy(() => import('./pages/admin/Designer'))
const Scanner = lazy(() => import('./pages/admin/Scanner'))

const staff = ['super', 'org_admin']
const wrap = (roles: string[], el: JSX.Element) => <RoleGate roles={roles}>{el}</RoleGate>

export default function App() {
  return (
    <>
      <Suspense fallback={<div className="grid min-h-[40vh] place-items-center text-muted-foreground">Loading…</div>}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<Landing />} />
            <Route path="events/:slug" element={<EventPage />} />
            <Route path="pass/:token" element={<PassPage />} />
            <Route path="claim" element={<ClaimPage />} />
            <Route path="certificate/:id" element={<CertificatePage />} />
            <Route path="verify/:id" element={<VerifyPage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="*" element={<p className="py-20 text-center text-muted-foreground">Page not found.</p>} />
          </Route>
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={wrap(staff, <Dashboard />)} />
            <Route path="events" element={wrap(staff, <Events />)} />
            <Route path="events/new" element={wrap(staff, <EventNew />)} />
            <Route path="events/:id" element={wrap(staff, <EventDetail />)} />
            <Route path="events/:id/design" element={wrap(staff, <Designer />)} />
            <Route path="orgs" element={wrap(staff, <Orgs />)} />
            <Route path="scan" element={wrap([...staff, 'volunteer'], <Scanner />)} />
            <Route path="billing" element={wrap(staff, <Billing />)} />
            <Route path="plans" element={wrap(['super'], <Plans />)} />
            <Route path="affiliates" element={wrap(['super'], <Affiliates />)} />
            <Route path="settings" element={wrap(['super'], <Settings />)} />
            <Route path="partner" element={wrap(['affiliate'], <Partner />)} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster richColors position="top-right" />
    </>)
}
