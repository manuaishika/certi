/**
 * Calls a `public.*` SQL function the way PostgREST's `rpc()` does: named arguments, JSON-typed
 * parameters serialised as JSON. Used by the browser demo backend and by the test-suite, so both
 * exercise exactly the same call path against the same migrations.
 */
interface Queryable { query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> }

const sigCache = new WeakMap<object, Map<string, { names: string[]; types: string[] }>>()

async function signature(q: Queryable, fn: string) {
  let m = sigCache.get(q)
  if (!m) { m = new Map(); sigCache.set(q, m) }
  const hit = m.get(fn)
  if (hit) return hit
  const res = await q.query<{ names: string[] | null; types: string[] }>(
    `select p.proargnames as names,
            (select array_agg(format_type(t, null) order by ord) from unnest(p.proargtypes::oid[]) with ordinality u(t, ord)) as types
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`, [fn])
  if (!res.rows.length) throw new Error(`Unknown function: ${fn}`)
  const row = res.rows[0]
  const sig = { names: row.names ?? [], types: row.types ?? [] }
  m.set(fn, sig)
  return sig
}

/** args: positional array or an object keyed by parameter name */
export async function callFn<T = any>(q: Queryable, fn: string, args: any[] | Record<string, any> = []): Promise<T> {
  const sig = await signature(q, fn)
  const named: Record<string, any> = Array.isArray(args)
    ? Object.fromEntries(args.map((v, i) => [sig.names[i], v]))
    : args
  const parts: string[] = []
  const values: any[] = []
  for (const [name, value] of Object.entries(named)) {
    const idx = sig.names.indexOf(name)
    if (idx < 0) throw new Error(`${fn}: unknown parameter ${name}`)
    const type = sig.types[idx]
    values.push(value == null ? null : type === 'jsonb' ? JSON.stringify(value) : value)
    parts.push(`${name} => $${values.length}${type === 'jsonb' ? '::jsonb' : ''}`)
  }
  const res = await q.query<{ r: T }>(`select public.${fn}(${parts.join(', ')}) as r`, values)
  return res.rows[0].r
}
