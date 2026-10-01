import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
export const inr = (v: number) => '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2 })
export const fmtDate = (s?: string | null, withTime = false) => s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }) : ''
export const toLocalInput = (s?: string | null) => { if (!s) return ''; const d = new Date(s); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
export const hasDevanagari = (s: string) => /[ऀ-ॿ]/.test(s)
export const origin = () => (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, '') || window.location.origin
