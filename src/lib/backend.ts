/**
 * Transport abstraction. Two interchangeable implementations of the same contract:
 *   - supabaseBackend: the real thing (PostgREST RPC, Supabase Auth/Storage/Edge Functions)
 *   - demoBackend:     an in-browser Postgres (PGlite) running the very same migrations, no server needed
 * The UI only ever talks to `api`.
 */
export interface AuthUser { id: string; email: string }

export interface Backend {
  mode: 'supabase' | 'demo'
  rpc<T = any>(fn: string, args?: Record<string, any>): Promise<T>
  auth: {
    user(): Promise<AuthUser | null>
    signIn(email: string, password: string): Promise<void>
    signOut(): Promise<void>
    onChange(cb: () => void): () => void
  }
  upload(file: Blob, folder: string): Promise<string>
  invoke<T = any>(fn: string, body?: any): Promise<T>
  /** demo only */
  reset?(): Promise<void>
}

let promise: Promise<Backend> | null = null
export function backend(): Promise<Backend> {
  if (!promise) {
    promise = import.meta.env.VITE_SUPABASE_URL
      ? import('./supabaseBackend').then(m => m.createSupabaseBackend())
      : import('./demoBackend').then(m => m.createDemoBackend())
  }
  return promise
}

export const isDemo = !import.meta.env.VITE_SUPABASE_URL

export const api = {
  async rpc<T = any>(fn: string, args: Record<string, any> = {}): Promise<T> { return (await backend()).rpc<T>(fn, args) },
  async invoke<T = any>(fn: string, body?: any): Promise<T> { return (await backend()).invoke<T>(fn, body) },
  async upload(file: Blob, folder: string) { return (await backend()).upload(file, folder) },
  async auth() { return (await backend()).auth },
}

export function errMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as any).message) : String(e)
  if (/unauthorized/.test(m)) return 'Please sign in again.'
  if (/^forbidden$|permission denied/.test(m)) return 'You do not have permission to do that.'
  return m.replace(/^error: /i, '')
}
