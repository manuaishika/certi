// Minimal in-memory stand-in for supabase-js, scripted per test. Records every RPC so tests can assert what was (not) called.
export const state: { rows: Record<string, any[]>; rpc: Record<string, (args: any) => any>; calls: { fn: string; args: any }[]; user: unknown } = { rows: {}, rpc: {}, calls: [], user: null }
export const reset = () => { state.rows = {}; state.rpc = {}; state.calls = []; state.user = null }

function table(name: string) {
  const filters: [string, unknown][] = []
  const q: any = {
    select() { return q }, eq(k: string, v: unknown) { filters.push([k, v]); return q },
    insert: async (row: any) => { (state.rows[name] ??= []).push(row); return { error: null } },
    update(v: any) { return { eq: async (k: string, val: unknown) => { for (const r of state.rows[name] ?? []) if (r[k] === val) Object.assign(r, v); return { error: null } } } },
    maybeSingle: async () => ({ data: (state.rows[name] ?? []).find(r => filters.every(([k, v]) => r[k] === v)) ?? null }),
  }
  return q
}
export function createClient() {
  return {
    from: table,
    rpc: async (fn: string, args: any) => { state.calls.push({ fn, args }); const h = state.rpc[fn]; return h ? { data: h(args), error: null } : { data: null, error: null } },
    auth: { getUser: async () => ({ data: { user: state.user } }), admin: {} },
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/y.png' } }) }) },
  }
}
