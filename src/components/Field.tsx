import { cn } from '@/lib/utils'
/** The wrapping <label> ties the caption to its input for screen readers and click-to-focus. */
export function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return <label className={cn('block space-y-1', className)}><span className="text-sm font-medium leading-none">{label}</span>{children}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</label>
}
export function PageHeader({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-end gap-3"><div><h1 className="text-2xl font-bold">{title}</h1>{sub && <div className="text-sm text-muted-foreground">{sub}</div>}</div><div className="ml-auto flex flex-wrap gap-2">{children}</div></div>
}
export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return <div className="rounded-xl border bg-card p-4"><div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-3xl font-bold">{value}</div>{sub && <div className="text-xs text-muted-foreground">{sub}</div>}</div>
}
