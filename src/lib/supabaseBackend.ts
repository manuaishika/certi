import { createClient } from '@supabase/supabase-js'
import type { Backend } from './backend'

export async function createSupabaseBackend(): Promise<Backend> {
  const sb = createClient(import.meta.env.VITE_SUPABASE_URL!, import.meta.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: true, autoRefreshToken: true },
  })
  return {
    mode: 'supabase',
    async rpc(fn, args = {}) {
      const { data, error } = await sb.rpc(fn, args)
      if (error) throw new Error(error.message)
      return data
    },
    auth: {
      async user() {
        const { data } = await sb.auth.getSession()
        const u = data.session?.user
        return u ? { id: u.id, email: u.email ?? '' } : null
      },
      async signIn(email, password) {
        const { error } = await sb.auth.signInWithPassword({ email, password })
        if (error) throw new Error('Invalid email or password')
      },
      async signOut() { await sb.auth.signOut() },
      onChange(cb) {
        const { data } = sb.auth.onAuthStateChange(() => cb())
        return () => data.subscription.unsubscribe()
      },
    },
    async upload(file, folder) {
      const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
      const path = `${folder}/${crypto.randomUUID()}.${ext}`
      const { error } = await sb.storage.from('assets').upload(path, file, { contentType: file.type, upsert: false })
      if (error) throw new Error(error.message)
      return sb.storage.from('assets').getPublicUrl(path).data.publicUrl
    },
    async invoke(fn, body) {
      const { data, error } = await sb.functions.invoke(fn, { body })
      if (error) {
        let msg = error.message
        try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error } catch { /* ignore */ }
        throw new Error(msg)
      }
      return data
    },
  }
}
