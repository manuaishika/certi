import { FormEvent, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth, readPending } from '@/lib/auth'
import { errMessage } from '@/lib/backend'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

/** Shown to a signed-in person who has no organisation yet (e.g. right after confirming their email). */
export default function Onboarding() {
  const { me, user, loading, createWorkspace, signOut } = useAuth()
  const nav = useNavigate()
  const pending = readPending()
  const [org, setOrg] = useState(pending?.org ?? ''); const [name, setName] = useState(pending?.name ?? '')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  if (loading) return null
  if (me) return <Navigate to="/admin" replace />
  if (!user) return <Navigate to="/login" replace />
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    try { await createWorkspace(org, name, pending?.ref ?? ''); nav('/admin') } catch (x) { setErr(errMessage(x)) } finally { setBusy(false) }
  }
  return (
    <div className="mx-auto mt-8 max-w-md"><Card><CardContent className="pt-5">
      <form onSubmit={submit} className="space-y-4">
        <h1 className="text-xl font-bold">One last step</h1>
        <p className="text-sm text-muted-foreground">Signed in as <b>{user.email}</b>. What is your organisation called?</p>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <div className="space-y-1"><Label htmlFor="org">Organisation name</Label><Input id="org" value={org} onChange={e => setOrg(e.target.value)} required minLength={2} /></div>
        <div className="space-y-1"><Label htmlFor="name">Your name</Label><Input id="name" value={name} onChange={e => setName(e.target.value)} /></div>
        <Button className="w-full" disabled={busy}>Create my workspace</Button>
        <button type="button" className="w-full text-center text-xs text-muted-foreground underline" onClick={() => signOut()}>Use a different account</button>
      </form></CardContent></Card></div>)
}
