import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './backend'
import type { AuthUser } from './backend'
import type { Me } from './types'

const PENDING = 'cergema.pending'
export interface Pending { org: string; name: string; ref: string }
export const savePending = (p: Pending) => { try { localStorage.setItem(PENDING, JSON.stringify(p)) } catch { /* private mode */ } }
export const readPending = (): Pending | null => { try { return JSON.parse(localStorage.getItem(PENDING) ?? 'null') } catch { return null } }
const clearPending = () => { try { localStorage.removeItem(PENDING) } catch { /* ignore */ } }

interface AuthCtx {
  me: Me | null
  /** signed in with Supabase Auth */
  user: AuthUser | null
  /** signed in but has not created an organisation yet */
  needsOnboarding: boolean
  loading: boolean
  refresh: () => Promise<void>
  signIn: (e: string, p: string) => Promise<Me | null>
  signUp: (e: string, p: string) => Promise<{ signedIn: boolean }>
  createWorkspace: (org: string, name: string, ref?: string) => Promise<void>
  signOut: () => Promise<void>
}
const Ctx = createContext<AuthCtx>(null as any)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const auth = await api.auth()
      const u = await auth.user()
      setUser(u)
      setMe(u ? await api.rpc<Me | null>('get_me') : null)
    } catch { setMe(null); setUser(null) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let off = () => {}
    refresh()
    api.auth().then(a => { off = a.onChange(refresh) })
    return () => off()
  }, [refresh])

  const value = useMemo<AuthCtx>(() => ({
    me, user, loading, refresh, needsOnboarding: !!user && !me,
    async signIn(email, password) {
      const a = await api.auth(); await a.signIn(email, password)
      const u = await a.user(); setUser(u)
      const m = await api.rpc<Me | null>('get_me'); setMe(m); return m
    },
    async signUp(email, password) { const a = await api.auth(); const r = await a.signUp(email, password); if (r.signedIn) await refresh(); return r },
    async createWorkspace(org, name, ref = '') {
      const a = await api.auth(); const u = await a.user()
      await api.rpc('create_my_tenant', { p_org_name: org, p_name: name, p_email: u?.email ?? '', p_ref: ref })
      clearPending(); await refresh()
    },
    async signOut() { const a = await api.auth(); await a.signOut(); setMe(null); setUser(null) },
  }), [me, user, loading, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
export const useAuth = () => useContext(Ctx)
export const useModules = () => useAuth().me?.tenant?.modules ?? []
