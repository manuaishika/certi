import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'
import { api } from '@/lib/backend'
import { useAction, useRpc } from '@/lib/hooks'
import type { EventRow, FieldPos } from '@/lib/types'
import { FIELDS, FIELD_LABELS, mergedLayout, type FieldKey } from '@/lib/cert/layout'
import { TEMPLATE_LABELS, proceduralBlob } from '@/lib/cert/backgrounds'
import { sampleInput } from '@/lib/cert/render'
import { prepareImage } from '@/lib/files'
import { CertPreview } from '@/components/CertPreview'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export default function Designer() {
  const { id } = useParams()
  const info = useRpc<any>('get_event_admin', { p_event: id }, [id])
  const policy = useRpc<{ state: string; detail: string; cost: number }>('ai_policy', { p_event: id }, [id])
  const { busy, run } = useAction()
  const [layout, setLayout] = useState<Record<FieldKey, FieldPos> | null>(null)
  const [sel, setSel] = useState<FieldKey | null>(null)
  const [handles, setHandles] = useState(true)
  const [accent, setAccent] = useState('#1e3a8a')
  const [prompt, setPrompt] = useState('')
  const [aiStatus, setAiStatus] = useState('')
  const stage = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const ev: EventRow | undefined = info.data?.event

  useEffect(() => { if (ev) { setLayout(mergedLayout(ev)); setAccent(ev.accent) } }, [ev?.id, ev?.orientation, ev?.cohosts?.length, JSON.stringify(ev?.layout)]) // eslint-disable-line

  const persist = (next: Record<FieldKey, FieldPos>) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => api.rpc('save_layout', { p_event: id, p_layout: next }).catch(e => toast.error(e.message)), 400)
  }
  const update = (k: FieldKey, patch: Partial<FieldPos>) => setLayout(prev => { if (!prev) return prev; const next = { ...prev, [k]: { ...prev[k], ...patch } }; persist(next); return next })

  const input = useMemo(() => ev && layout ? sampleInput({ ...ev, layout }, { name: info.data.root.name, logo_url: info.data.root.logo_url }, info.data.branch, info.data.watermark) : null, [ev, layout, info.data])
  if (!ev || !layout || !input) return <p className="text-muted-foreground">{info.error || 'Loading…'}</p>

  const startDrag = (k: FieldKey) => (e: React.PointerEvent) => {
    e.preventDefault(); setSel(k)
    const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId)
    const move = (m: PointerEvent) => {
      const b = stage.current!.getBoundingClientRect()
      update(k, { x: Math.min(1, Math.max(0, (m.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (m.clientY - b.top) / b.height)) })
    }
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up)
  }

  const uploadBg = (f: File) => run(async () => {
    const url = await api.upload(await prepareImage(f, 3508, false), 'backgrounds')
    await api.rpc('set_event_background', { p_event: id, p_url: url }); await info.reload()
  }, 'Custom background applied. Drag the fields to fit your artwork.')

  const generate = () => run(async () => {
    setAiStatus('Queued…')
    const job = await api.rpc<any>('request_ai_job', { p_event: id, p_prompt: prompt })
    api.invoke('ai-worker', { job_id: job.id }).catch(() => {})
    for (let i = 0; i < 90; i++) {
      const j = await api.rpc<any>('get_ai_job', { p_id: job.id })
      if (j.status === 'done') {
        const url = j.result_url || await api.upload(await proceduralBlob(job.prompt, ev.orientation), 'backgrounds')   // no AI provider configured → built-in generator
        await api.rpc('set_event_background', { p_event: id, p_url: url })
        setAiStatus(''); await Promise.all([info.reload(), policy.reload()]); toast.success(`AI background ready (${j.engine || 'procedural'}).`); return
      }
      if (j.status === 'failed') throw new Error(j.error || 'AI generation failed (credits refunded)')
      setAiStatus(j.status === 'pending' ? `In queue (position ${Number(j.queue_position) + 1})…` : 'Generating…')
      api.invoke('ai-worker', { job_id: job.id }).catch(() => {})
      await new Promise(r => setTimeout(r, 1500))
    }
    throw new Error('Timed out waiting for the AI worker')
  }).finally(() => setAiStatus(''))

  return (
    <div>
      <div className="mb-4 flex items-center gap-3"><Link to={`/admin/events/${id}`} className="text-sm underline">← {ev.title}</Link><h1 className="text-xl font-bold">Certificate designer</h1></div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <p className="mb-1 text-xs text-muted-foreground">Drag the blue handles to position fields. Sample data shown; real names render at 300 DPI.</p>
          <div ref={stage} className={cn('relative select-none', ev.orientation === 'portrait' && 'mx-auto max-w-[520px]')}>
            <CertPreview input={input} dpi={80} />
            {handles && FIELDS.map(k => (
              <div key={k} onPointerDown={startDrag(k)} data-field={k}
                className={cn('absolute -translate-x-1/2 -translate-y-1/2 cursor-move touch-none whitespace-nowrap rounded bg-blue-600/45 px-1.5 py-1 text-[10px] leading-none text-white hover:bg-blue-600', sel === k && 'outline outline-2 outline-yellow-400')}
                style={{ left: `${layout[k].x * 100}%`, top: `${layout[k].y * 100}%` }}>{FIELD_LABELS[k]}</div>))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{sel ? `Selected: ${FIELD_LABELS[sel]}` : 'Select a field, then:'}</span>
            <Button size="sm" variant="outline" disabled={!sel} onClick={() => sel && update(sel, { size: layout[sel].size / 1.08 })}>A−</Button>
            <Button size="sm" variant="outline" disabled={!sel} onClick={() => sel && update(sel, { size: layout[sel].size * 1.08 })}>A+</Button>
            <label className="ml-2 text-xs"><input type="checkbox" checked={handles} onChange={e => setHandles(e.target.checked)} /> Show handles</label>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => run(async () => { await api.rpc('save_layout', { p_event: id, p_layout: {} }); await info.reload() }, 'Positions reset.')}>Reset positions</Button>
          </div>
        </div>

        <div className="space-y-4">
          <Card><CardHeader><CardTitle>Template &amp; colour</CardTitle></CardHeader><CardContent className="space-y-3">
            <Select value={ev.template} onChange={e => run(async () => { await api.rpc('set_event_style', { p_event: id, p_template: e.target.value, p_accent: accent, p_orientation: ev.orientation }); await info.reload() })}>
              {Object.entries(TEMPLATE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}{ev.template === 'custom' && <option value="custom" disabled>Custom background (active)</option>}</Select>
            <div className="flex items-center gap-2"><Label>Accent</Label><input type="color" value={accent} onChange={e => setAccent(e.target.value)}
              onBlur={() => run(async () => { await api.rpc('set_event_style', { p_event: id, p_template: ev.template, p_accent: accent, p_orientation: ev.orientation }); await info.reload() })} /></div>
            <Select value={ev.orientation} onChange={e => run(async () => { await api.rpc('set_event_style', { p_event: id, p_template: ev.template, p_accent: accent, p_orientation: e.target.value }); await info.reload() })}>
              <option value="landscape">Landscape (297×210 mm)</option><option value="portrait">Portrait (210×297 mm)</option></Select>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Upload your own background</CardTitle></CardHeader><CardContent>
            <input type="file" accept="image/*" aria-label="Upload background" className="text-xs" onChange={e => { const f = e.target.files?.[0]; if (f) uploadBg(f); e.target.value = '' }} />
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-1"><Sparkles className="h-4 w-4 text-accent" />AI background</CardTitle></CardHeader><CardContent className="space-y-2">
            <Textarea rows={2} maxLength={300} placeholder="e.g. green eco leaves border with gold trim" value={prompt} onChange={e => setPrompt(e.target.value)} disabled={policy.data?.state === 'blocked'} />
            <p className="text-xs text-muted-foreground">{aiStatus || policy.data?.detail}</p>
            <Button variant="accent" className="w-full" disabled={busy || policy.data?.state === 'blocked' || prompt.trim().length < 3} onClick={generate}>Generate</Button>
          </CardContent></Card>
        </div>
      </div>
    </div>)
}
