import { FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { useAuth, savePending } from '@/lib/auth'
import { errMessage } from '@/lib/backend'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Seo } from '@/components/Seo'

export default function SignupPage() {
  const { me, user, signUp, createWorkspace } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const ref = (params.get('ref') ?? '').toUpperCase()
  const [f, setF] = useState({ org: '', name: '', email: '', password: '' })
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false)
  if (me) return <Navigate to="/admin" replace />
  if (user) return <Navigate to="/onboarding" replace />
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      savePending({ org: f.org, name: f.name, ref })
      const r = await signUp(f.email, f.password)
      if (r.signedIn) { await createWorkspace(f.org, f.name, ref); nav('/admin') } else setConfirm(true)
    } catch (x) { setErr(errMessage(x)) } finally { setBusy(false) }
  }

  if (confirm) return (
    <div className="mx-auto mt-10 max-w-md text-center"><Seo title="Check your email | CerGeMA" />
      <MailCheck className="mx-auto h-12 w-12 text-primary" /><h1 className="mt-3 text-2xl font-bold">Check your email</h1>
      <p className="mt-2 text-muted-foreground">We sent a confirmation link to <b>{f.email}</b>. Click it, then <Link className="underline" to="/login">log in</Link> and your workspace for <b>{f.org}</b> will be ready in one click.</p></div>)

  return (
    <div className="mx-auto mt-4 grid max-w-4xl gap-8 md:grid-cols-2">
      <Seo title="Start free | CerGeMA" description="Create your organisation's workspace in a minute. Free forever for up to 100 certificates a month." />
      <div className="space-y-4 pt-4">
        <h1 className="text-3xl font-bold">Start free</h1>
        <p className="text-muted-foreground">Create a workspace for your school, college, trust or company. No card needed.</p>
        <ul className="space-y-2 text-sm">
          {['Free forever: 100 certificates a month, your own logo and design', 'Upload your participant list (CSV / Excel) and issue certificates in one click', 'Every certificate gets a QR code anyone can scan to verify it', 'Upgrade only when you need registration pages, QR check-in or more volume'].map(x => <li key={x} className="flex gap-2"><span className="text-emerald-600">✓</span>{x}</li>)}
        </ul>
        {ref && <p className="rounded-lg bg-accent/20 p-3 text-sm">Referral code <b className="font-mono">{ref}</b> applied. Your partner's discount is used when you choose a paid plan.</p>}
      </div>
      <Card><CardContent className="pt-5">
        <form onSubmit={submit} className="space-y-4">
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          <div className="space-y-1"><Label htmlFor="org">Organisation name</Label><Input id="org" value={f.org} onChange={set('org')} placeholder="e.g. Greenfield Public School" required minLength={2} autoComplete="organization" /></div>
          <div className="space-y-1"><Label htmlFor="name">Your name</Label><Input id="name" value={f.name} onChange={set('name')} autoComplete="name" /></div>
          <div className="space-y-1"><Label htmlFor="email">Work email</Label><Input id="email" type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></div>
          <div className="space-y-1"><Label htmlFor="password">Password</Label><Input id="password" type="password" value={f.password} onChange={set('password')} required minLength={8} autoComplete="new-password" /><p className="text-xs text-muted-foreground">At least 8 characters.</p></div>
          <Button className="w-full" size="lg" disabled={busy}>Create my workspace</Button>
          <p className="text-center text-xs text-muted-foreground">Already have one? <Link className="underline max-md:inline-flex max-md:min-h-11 max-md:items-center" to="/login">Log in</Link></p>
        </form>
      </CardContent></Card>
    </div>)
}
