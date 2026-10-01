/**
 * Demo backend: a complete Postgres running in the browser (PGlite) with the production migrations.
 * Authorisation is still enforced by the database: each call runs as role anon/authenticated with
 * the JWT subject set, exactly like PostgREST. Data persists in IndexedDB.
 */
import { PGlite } from '@electric-sql/pglite'
import type { Backend } from './backend'
import { callFn } from './pgcall'
import bootstrap from '../demo/bootstrap.sql?raw'
import seed from '../demo/seed.sql?raw'

const migrations = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const UID_KEY = 'cergema.demo.uid'
const DB_KEY = 'idb://cergema-demo-v1'

function fingerprint(s: string) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0) }

async function open(): Promise<PGlite> {
  const files = Object.keys(migrations).sort().map(k => migrations[k])
  const stamp = fingerprint([bootstrap, seed, ...files].join('\n--\n'))
  let db = new PGlite(DB_KEY, { relaxedDurability: false })   // a write is only acknowledged once it is in IndexedDB, so a quick page reload can't lose it
  await db.waitReady
  const has = await db.query<{ stamp: string }>(`select to_regclass('public.demo_meta') is not null as ok`).then(r => (r.rows[0] as any).ok).catch(() => false)
  let current = ''
  if (has) current = ((await db.query<{ stamp: string }>('select stamp from public.demo_meta limit 1')).rows[0] as any)?.stamp ?? ''
  if (current !== stamp) {   // first run, or migrations changed: rebuild from scratch
    await db.close()
    indexedDB.deleteDatabase('/pglite/cergema-demo-v1')
    db = new PGlite(DB_KEY, { relaxedDurability: false })
    await db.waitReady
    await db.exec(`drop schema if exists public cascade; drop schema if exists app cascade; drop schema if exists auth cascade; create schema public;
      do $$ begin if exists (select 1 from pg_roles where rolname='anon') then
        drop owned by anon, authenticated, service_role; drop role anon; drop role authenticated; drop role service_role; end if; end $$;`)
    await db.exec(bootstrap)
    for (const f of files) await db.exec(f)
    await db.exec(seed)
    await db.exec(`create table public.demo_meta (stamp text); insert into public.demo_meta values ('${stamp}');`)
  }
  return db
}

export async function createDemoBackend(): Promise<Backend> {
  let db = await open()
  const listeners = new Set<() => void>()
  const uid = () => localStorage.getItem(UID_KEY) ?? ''
  /** PGlite does not reliably persist after an explicit transaction, so flush to IndexedDB before reporting success.
   *  Otherwise a quick page reload (or closing the tab) right after an action could silently lose it. */
  const flush = () => db.syncToFs().catch(() => {})

  async function asRole<T>(role: 'anon' | 'authenticated' | 'service_role', sub: string, run: (q: any) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`)
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub])
      return run(tx)
    })
  }

  const rpc = async (fn: string, args: Record<string, any> = {}): Promise<any> => {
    const id = uid()
    const out = await asRole(id ? 'authenticated' : 'anon', id, (tx) => callFn(tx, fn, args))
    await flush()
    return out
  }

  return {
    mode: 'demo',
    rpc,
    auth: {
      async user() {
        const id = uid()
        if (!id) return null
        const r = await db.query<{ email: string }>('select email from public.dev_users where profile_id = $1', [id])
        return r.rows[0] ? { id, email: r.rows[0].email } : null
      },
      async signIn(email, password) {
        const r = await db.query<{ profile_id: string }>('select profile_id from public.dev_users where lower(email) = lower($1) and password = $2', [email.trim(), password])
        if (!r.rows[0]) throw new Error('Invalid email or password')
        localStorage.setItem(UID_KEY, r.rows[0].profile_id)
        listeners.forEach(l => l())
      },
      async signUp(email, password) {
        const em = email.trim().toLowerCase()
        if (password.length < 8) throw new Error('Password must be at least 8 characters')
        const dup = await db.query('select 1 from public.dev_users where email = $1', [em])
        if (dup.rows.length) throw new Error('That email is already registered. Please log in.')
        const id = crypto.randomUUID()
        await db.query('insert into public.dev_users (email, password, profile_id) values ($1,$2,$3)', [em, password, id])
        await flush()
        localStorage.setItem(UID_KEY, id); listeners.forEach(l => l())
        return { signedIn: true }
      },
      async signOut() { localStorage.removeItem(UID_KEY); listeners.forEach(l => l()) },
      onChange(cb) { listeners.add(cb); return () => listeners.delete(cb) },
    },
    async upload(file) {
      // Demo storage: small data URLs kept in the row itself.
      return await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(fr.error)
        fr.readAsDataURL(file)
      })
    },
    async invoke(fn, body): Promise<any> {
      // Emulates the Edge Functions that exist in production.
      if (fn === 'invite-user') {
        const caller = await rpc('get_me')
        if (!caller || !['super', 'org_admin'].includes(caller.profile.role)) throw new Error('forbidden')
        const b = body as { email: string; password: string; role: string; org_id?: string; name?: string; coupon_code?: string }
        const org = caller.profile.role === 'super' ? b.org_id ?? null : caller.tenant.id
        if (caller.profile.role !== 'super' && !['org_admin', 'volunteer'].includes(b.role)) throw new Error('forbidden')
        const id = crypto.randomUUID()
        await db.query('insert into public.profiles (id, email, name, role, org_id, coupon_code) values ($1,$2,$3,$4,$5,$6)', [id, b.email.toLowerCase(), b.name ?? '', b.role, org, b.coupon_code ?? null])
        await db.query('insert into public.dev_users (email, password, profile_id) values ($1,$2,$3)', [b.email.toLowerCase(), b.password, id])
        await flush()
        return { id }
      }
      if (fn === 'ai-worker') {
        // production: Imagen / FLUX. Demo: report "procedural" and let the browser draw the border.
        const jobs = await asRole('service_role', '', (tx) => callFn<any[]>(tx, 'claim_ai_jobs', { p_limit: 1 }))
        for (const j of jobs) await asRole('service_role', '', (tx) => callFn(tx, 'complete_ai_job', { p_id: j.id, p_url: '', p_engine: 'procedural', p_error: '' }))
        return { processed: jobs.length }
      }
      if (fn === 'dispatch-outbox') return { processed: 0 }
      throw new Error(`Edge function ${fn} is not available in demo mode`)
    },
    async reset() {
      localStorage.removeItem(UID_KEY)
      await db.close()
      indexedDB.deleteDatabase('/pglite/cergema-demo-v1')
      location.reload()
    },
  }
}
