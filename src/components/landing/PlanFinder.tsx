import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, X } from 'lucide-react'
import type { Module, Plan } from '@/lib/types'
import { priceLabel } from '@/lib/defaults'
import { Select } from '@/components/ui/input'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface Need { id: string; label: string; hint: string; module?: Module; ai?: boolean }
const NEEDS: Need[] = [
  { id: 'list', label: 'I already have a list of names and just need certificates', hint: 'Upload a CSV / Excel file and issue certificates in one click', module: 'certificates' },
  { id: 'reg', label: 'People should register themselves on a web page', hint: 'A shareable event page with a bilingual form and a confirmation step', module: 'registration' },
  { id: 'online', label: 'Online or hybrid events (Zoom, Meet, YouTube)', hint: 'The joining link is shown only to registered attendees', module: 'lifecycle' },
  { id: 'qr', label: 'A digital ID pass with a QR code for each person', hint: 'Instant pass on registration, scannable at the gate', module: 'idpass' },
  { id: 'att', label: 'Only people who actually attended should get certificates', hint: 'Volunteers scan passes on a phone; absentees are skipped automatically', module: 'attendance' },
  { id: 'co', label: 'Joint events with a co-host and sponsor logos', hint: 'Equal-size co-host crests in the header, “Supported By” in the footer', module: 'cobrand' },
  { id: 'ai', label: 'AI-drawn certificate backgrounds', hint: 'Describe a border in words and get artwork', ai: true },
  { id: 'wl', label: 'Everything under my own brand and web address', hint: 'Your name, colour and domain instead of ours', module: 'whitelabel' },
]
const SIZES = [{ n: 100, l: 'Up to 100' }, { n: 1000, l: 'Up to 1,000' }, { n: 15000, l: 'Up to 15,000' }, { n: 50000, l: 'More than 15,000' }]
const BRANCHES = [{ n: 1, l: 'Just one' }, { n: 3, l: '2 or 3' }, { n: 4, l: '4 or more' }]

function unmet(p: Plan, picked: Need[], size: number, branches: number): string[] {
  const out: string[] = []
  for (const n of picked) if ((n.module && !p.modules.includes(n.module)) || (n.ai && !p.ai_enabled)) out.push(n.label.replace(/^I /, '').replace(/^People should /, 'people to ').replace(/^Only /, 'only '))
  if (p.quota !== null && p.quota < size) out.push(`${size.toLocaleString('en-IN')} certificates at once (limit ${p.quota.toLocaleString('en-IN')})`)
  if (p.branches !== null && p.branches < branches) out.push(`${branches === 4 ? '4+' : branches} campuses (limit ${p.branches})`)
  return out
}

/** Maps what a visitor wants to the cheapest plan that includes it. Driven by live plan data, so Super Admin edits flow through. */
export function PlanFinder({ plans }: { plans: Plan[] }) {
  const [on, setOn] = useState<Record<string, boolean>>({ list: true })
  const [size, setSize] = useState(100); const [branches, setBranches] = useState(1)
  const picked = NEEDS.filter(n => on[n.id])
  const { rec, skipped } = useMemo(() => {
    const sorted = [...plans].sort((a, b) => a.price_inr - b.price_inr)
    const idx = sorted.findIndex(p => unmet(p, picked, size, branches).length === 0)
    const i = idx < 0 ? sorted.length - 1 : idx
    return { rec: sorted[i], skipped: sorted.slice(0, i).map(p => ({ plan: p, why: unmet(p, picked, size, branches) })) }
  }, [plans, picked, size, branches])
  if (!rec) return null

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3"><CardContent className="space-y-5 pt-5">
        <fieldset><legend className="mb-2 font-semibold">What do you need? <span className="font-normal text-muted-foreground">(tick all that apply)</span></legend>
          <div className="space-y-2">
            {NEEDS.map(n => (
              <label key={n.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm hover:bg-secondary/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input type="checkbox" className="mt-1" checked={!!on[n.id]} onChange={e => setOn({ ...on, [n.id]: e.target.checked })} />
                <span><span className="font-medium">{n.label}</span><span className="block text-xs text-muted-foreground">{n.hint}</span></span>
              </label>))}
          </div></fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">How many certificates at your biggest event?
            <Select className="mt-1" value={size} onChange={e => setSize(Number(e.target.value))}>{SIZES.map(s => <option key={s.n} value={s.n}>{s.l}</option>)}</Select></label>
          <label className="text-sm font-medium">How many campuses or branches?
            <Select className="mt-1" value={branches} onChange={e => setBranches(Number(e.target.value))}>{BRANCHES.map(s => <option key={s.n} value={s.n}>{s.l}</option>)}</Select></label>
        </div>
      </CardContent></Card>

      <Card className="border-primary lg:col-span-2" aria-live="polite"><CardContent className="space-y-3 pt-5">
        <div className="eyebrow">Your best fit</div>
        <div className="font-display text-3xl">{rec.name}</div>
        <div className="font-display text-4xl">{priceLabel(rec).amount}<span className="font-sans text-sm text-muted-foreground"> {priceLabel(rec).per}</span></div>
        <ul className="space-y-1 text-sm">
          {picked.map(n => <li key={n.id} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{n.label}</li>)}
          {!picked.length && <li className="text-muted-foreground">Tick what you need on the left.</li>}
        </ul>
        {skipped.length > 0 && (
          <div className="rounded-lg bg-secondary p-3 text-xs text-muted-foreground">
            {skipped.slice(-1).map(s => <div key={s.plan.key}><b>{s.plan.name}</b> wouldn’t cover:
              <ul className="mt-1 space-y-0.5">{s.why.slice(0, 3).map(w => <li key={w} className="flex gap-1"><X className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />{w}</li>)}</ul></div>)}
          </div>)}
        <Link to="/signup" className={buttonVariants({ size: 'lg' }) + ' w-full'}>Organise an event <ArrowRight className="h-4 w-4" /></Link>

      </CardContent></Card>
    </div>)
}
