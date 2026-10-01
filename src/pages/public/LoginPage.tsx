import { FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { isDemo, errMessage } from '@/lib/backend'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Seo } from '@/components/Seo'

const HOME = { super: '/admin', org_admin: '/admin', volunteer: '/admin/scan', affiliate: '/admin/partner' } as const
const DEMO_USERS = [
  ['admin@cergema.local', 'admin123', 'Super Admin'], ['demo@cergema.local', 'demo123', 'Pro school'], ['enterprise@cergema.local', 'demo123', 'Enterprise'],
  ['volunteer@cergema.local', 'demo123', 'Gate volunteer'], ['free@cergema.local', 'demo123', 'Free trust'], ['partner@cergema.local', 'demo123', 'Affiliate'],
]

export default function LoginPage() {
  const { me, user, signIn } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  if (me) return <Navigate to={HOME[me.profile.role]} replace />
  if (user) return <Navigate to="/onboarding" replace />
  const submit = async (e: FormEvent, em = email, pw = password) => {
    e.preventDefault(); setBusy(true); setErr('')
    try { const m = await signIn(em, pw); nav(m ? HOME[m.profile.role] : '/onboarding') } catch (x) { setErr(errMessage(x)) } finally { setBusy(false) }
  }
  return (
    <div className="mx-auto mt-6 max-w-sm">
      <Seo title="Login | CerGeMA" />
      <Card><CardContent className="pt-5">
        <form onSubmit={submit} className="space-y-4">
          <h1 className="text-xl font-bold">Log in</h1>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          <div className="space-y-1"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" /></div>
          <div className="space-y-1"><Label htmlFor="password">Password</Label><Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></div>
          <Button className="w-full" disabled={busy}>Log in</Button>
          <p className="text-center text-xs text-muted-foreground">New here? <Link className="underline max-md:inline-flex max-md:min-h-11 max-md:items-center" to="/signup">Start free</Link></p>
        </form>
        {isDemo && <div className="mt-5 border-t pt-4"><p className="mb-2 text-xs text-muted-foreground">Demo accounts (one click):</p>
          <div className="flex flex-wrap gap-2">{DEMO_USERS.map(([em, pw, label]) => <Button key={em} type="button" variant="outline" size="sm" onClick={e => submit(e as any, em, pw)}>{label}</Button>)}</div></div>}
      </CardContent></Card>
    </div>)
}
