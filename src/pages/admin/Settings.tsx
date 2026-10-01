import { useEffect, useState } from 'react'
import { api } from '@/lib/backend'
import { useAction, useRpc } from '@/lib/hooks'
import type { PublicSettings } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Field, PageHeader } from '@/components/Field'

export default function Settings() {
  const { data, reload } = useRpc<PublicSettings>('get_public_settings')
  const [f, setF] = useState<Record<string, string>>({})
  const { busy, run } = useAction()
  useEffect(() => { if (data) setF(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))) }, [data])
  if (!data) return null
  const save = () => run(async () => {
    for (const [k, v] of Object.entries(f)) if (String(data[k as keyof PublicSettings]) !== v) await api.rpc('update_setting', { p_key: k, p_value: k === 'gateway_mode' ? v : Number(v) })
    await reload()
  }, 'Settings saved.')
  const n = (k: string) => <Input type="number" step="any" value={f[k] ?? ''} onChange={e => setF({ ...f, [k]: e.target.value })} />
  return (
    <div className="max-w-2xl"><PageHeader title="Platform settings" />
      <Card><CardContent className="grid gap-4 pt-5 md:grid-cols-2">
        <Field label="Payment gateway" hint="mock = test mode. live = Razorpay (INR) / Stripe (USD) through Edge Functions; mock payments are then refused."><Select value={f.gateway_mode ?? 'mock'} onChange={e => setF({ ...f, gateway_mode: e.target.value })}><option value="mock">mock (test)</option><option value="live">live</option></Select></Field>
        <Field label="USD per ₹1"><>{n('usd_per_inr')}</></Field>
        <Field label="AI credits per generation" hint="SRS: 10–15"><>{n('ai_credits_per_run')}</></Field>
        <Field label="Overage per certificate (₹)" hint="SRS: ₹0.50–1.00"><>{n('overage_inr')}</></Field>
        <Field label="Max co-hosts per event"><>{n('max_cohosts')}</></Field>
        <Field label="Max sponsors per event"><>{n('max_sponsors')}</></Field>
        <Button className="md:col-span-2" disabled={busy} onClick={save}>Save settings</Button>
      </CardContent></Card></div>)
}
