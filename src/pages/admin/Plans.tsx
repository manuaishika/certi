import { useState } from 'react'
import { api } from '@/lib/backend'
import { useAction, useRpc } from '@/lib/hooks'
import { MODULES, MODULE_LABELS, type Module, type Plan } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToggleField } from '@/components/ui/toggle-field'
import { Field, PageHeader } from '@/components/Field'

const num = (v: string) => (v.trim() === '' ? null : Number(v))

function PlanEditor({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
  const [f, setF] = useState({ name: plan.name, price_inr: String(plan.price_inr), quota: plan.quota?.toString() ?? '', branches: plan.branches?.toString() ?? '', ai_free: plan.ai_free?.toString() ?? '',
    ai_enabled: plan.ai_enabled, watermark: plan.watermark, modules: plan.modules as Module[] })
  const { busy, run } = useAction()
  return (
    <Card><CardHeader><CardTitle>{plan.key}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
      <Field label="Name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price (₹)"><Input type="number" value={f.price_inr} onChange={e => setF({ ...f, price_inr: e.target.value })} /></Field>
        <Field label={`Quota / ${plan.period}`} hint="blank = unlimited"><Input type="number" value={f.quota} onChange={e => setF({ ...f, quota: e.target.value })} /></Field>
        <Field label="Branches" hint="blank = unlimited"><Input type="number" value={f.branches} onChange={e => setF({ ...f, branches: e.target.value })} /></Field>
        <Field label="Free AI runs / month" hint="blank = unlimited"><Input type="number" value={f.ai_free} onChange={e => setF({ ...f, ai_free: e.target.value })} /></Field></div>
      <ToggleField label="AI backgrounds available" checked={f.ai_enabled} onChange={v => setF({ ...f, ai_enabled: v })} />
      <ToggleField label="“Powered by CerGeMA” watermark" checked={f.watermark} onChange={v => setF({ ...f, watermark: v })} />
      <div className="grid gap-1">{MODULES.map(m => <label key={m} className="flex items-center gap-2"><input type="checkbox" checked={f.modules.includes(m)} onChange={e => setF({ ...f, modules: e.target.checked ? [...f.modules, m] : f.modules.filter(x => x !== m) })} />{MODULE_LABELS[m]}</label>)}</div>
      <Button disabled={busy} onClick={() => run(async () => { await api.rpc('update_plan', { p_key: plan.key, p: { name: f.name, price_inr: Number(f.price_inr), quota: num(f.quota), branches: num(f.branches), ai_free: num(f.ai_free), ai_enabled: f.ai_enabled, watermark: f.watermark, modules: f.modules } }); onSaved() }, 'Plan saved.')}>Save plan</Button>
    </CardContent></Card>)
}

export default function Plans() {
  const { data, reload } = useRpc<Plan[]>('list_plans')
  return <div><PageHeader title="Plans & entitlements" sub="Changes apply to every tenant on the plan immediately. Per-tenant overrides live on the Organisations page." />
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{data?.map(p => <PlanEditor key={p.key + JSON.stringify(p)} plan={p} onSaved={reload} />)}</div></div>
}
