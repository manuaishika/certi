import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './backend'

/** White-label: when the app is served from a tenant's verified custom domain, show their brand instead of CerGeMA's. */
export interface Branding { appName: string; logo: string; color: string; hideBranding: boolean; tenantName: string | null }
const DEFAULT: Branding = { appName: 'CerGeMA', logo: '/icons/icon-192.png', color: '', hideBranding: false, tenantName: null }
const Ctx = createContext<Branding>(DEFAULT)

function hexToHsl(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b); let h = 0, s = 0; const l = (max + min) / 2
  if (max !== min) { const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60 }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [b, setB] = useState<Branding>(DEFAULT)
  useEffect(() => {
    const host = window.location.hostname
    api.rpc<any>('resolve_tenant_host', { p_host: host }).then(r => {
      if (!r) return
      const brand = r.brand ?? {}
      const next: Branding = { appName: brand.app_name || r.name, logo: r.logo_url || DEFAULT.logo, color: brand.color || '', hideBranding: !!brand.hide_branding, tenantName: r.name }
      setB(next)
      if (next.color) document.documentElement.style.setProperty('--primary', hexToHsl(next.color))
      document.title = next.appName
    }).catch(() => {})
  }, [])
  return <Ctx.Provider value={b}>{children}</Ctx.Provider>
}
export const useBranding = () => useContext(Ctx)
