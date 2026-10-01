import { FormEvent, useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { useAuth } from '@/lib/auth'
import { api, errMessage } from '@/lib/backend'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface Result { ok: boolean; already?: boolean; name?: string; event?: string; approved?: boolean; mode?: string; message: string }

export default function Scanner() {
  const { me } = useAuth()
  const enabled = me?.profile.role === 'super' || me?.tenant?.modules.includes('attendance')
  const [result, setResult] = useState<Result | null>(null)
  const [manual, setManual] = useState('')
  const [camera, setCamera] = useState<'starting' | 'on' | 'off'>('starting')
  const busy = useRef(false); const last = useRef('')

  const checkin = async (token: string) => {
    token = token.trim().toUpperCase()
    if (!token || busy.current || token === last.current) return
    busy.current = true; last.current = token
    try {
      const r = await api.rpc<Result>('checkin', { p_token: token })
      setResult(r); if (r.ok) navigator.vibrate?.(r.already ? [80, 60, 80] : 60)
    } catch (e) { setResult({ ok: false, message: errMessage(e) }) }
    setTimeout(() => { busy.current = false; last.current = '' }, 1800)
  }

  useEffect(() => {
    if (!enabled) return
    const sc = new Html5Qrcode('reader'); let started = false
    sc.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.72); return { width: s, height: s } }, aspectRatio: 1 }, t => checkin(t), () => {})
      .then(() => { started = true; setCamera('on') }).catch(() => setCamera('off'))
    return () => { if (started) sc.stop().then(() => sc.clear()).catch(() => {}) }
  }, [enabled]) // eslint-disable-line

  if (me && !enabled) return <div className="mx-auto max-w-md rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">QR attendance is not enabled for your organisation (the Enterprise plan, or the Super Admin, can enable the Attendance module).</div>
  const submit = (e: FormEvent) => { e.preventDefault(); checkin(manual); setManual('') }
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-xl font-bold">Gate check-in</h1>
      <div role="status" aria-live="polite" className={cn('mt-3 min-h-24 rounded-xl p-4 text-center text-xl leading-snug', !result ? 'border border-dashed text-base text-muted-foreground' : !result.ok ? 'bg-red-100' : result.already ? 'bg-amber-100' : 'bg-emerald-100')}>
        {!result ? 'Point the camera at a pass. The result appears here.' : result.ok ? <><b className="text-2xl">{result.name}</b><br />{result.message}{!result.approved && <><br /><small>⚠ not yet approved</small></>}<br /><small>{result.event} · {result.mode}</small></> : result.message}
      </div>
      <div id="reader" className="mx-auto mt-3 aspect-square w-full max-w-[26rem] overflow-hidden rounded-xl border bg-black" />
      {camera === 'off' && <p className="mt-2 text-sm text-amber-700">Camera unavailable: use manual entry below.</p>}
      <form onSubmit={submit} className="mt-3 flex gap-2"><Input value={manual} onChange={e => setManual(e.target.value)} placeholder="Or type the pass code" className="uppercase placeholder:normal-case" autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false} aria-label="Pass code" /><Button className="shrink-0">Check in</Button></form>
    </div>)
}
