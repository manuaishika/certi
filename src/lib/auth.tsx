import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './backend'
import type { Me } from './types'

interface AuthCtx { me: Me | null; loading: boolean; refresh: () => Promise<void>; signIn: (e: string, p: string) => Promise<Me | null>; signOut: () => Promise<void> }
const Ctx = createContext<AuthCtx>(null as any)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const auth = await api.auth()
      const u = await auth.user()
      setMe(u ? await api.rpc<Me | null>('get_me') : null)
    } catch { setMe(null) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let off = () => {}
    refresh()
    api.auth().then(a => { off = a.onChange(refresh) })
    return () => off()
  }, [refresh])

  const value = useMemo<AuthCtx>(() => ({
    me, loading, refresh,
    async signIn(email, password) { const a = await api.auth(); await a.signIn(email, password); const m = await api.rpc<Me | null>('get_me'); setMe(m); return m },
    async signOut() { const a = await api.auth(); await a.signOut(); setMe(null) },
  }), [me, loading, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
export const useAuth = () => useContext(Ctx)
export const useModules = () => useAuth().me?.tenant?.modules ?? []
