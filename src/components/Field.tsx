import { Label } from './ui/label'
import { cn } from '@/lib/utils'
export function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return <div className={cn('space-y-1', className)}><Label>{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
}
export function PageHeader({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-end gap-3"><div><h1 className="text-2xl font-bold">{title}</h1>{sub && <div className="text-sm text-muted-foreground">{sub}</div>}</div><div className="ml-auto flex flex-wrap gap-2">{children}</div></div>
}
export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return <div className="rounded-xl border bg-card p-4"><div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-3xl font-bold">{value}</div>{sub && <div className="text-xs text-muted-foreground">{sub}</div>}</div>
}
