import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { callFn } from '../src/lib/pgcall'

const root = join(__dirname, '..')

export const IDS = {
  super: 'b0000000-0000-0000-0000-000000000001', pro: 'b0000000-0000-0000-0000-000000000002',
  ent: 'b0000000-0000-0000-0000-000000000003', volunteer: 'b0000000-0000-0000-0000-000000000004',
  free: 'b0000000-0000-0000-0000-000000000005', affiliate: 'b0000000-0000-0000-0000-000000000006',
  proOrg: 'a0000000-0000-0000-0000-000000000001', branch: 'a0000000-0000-0000-0000-000000000002',
  entOrg: 'a0000000-0000-0000-0000-000000000003', freeOrg: 'a0000000-0000-0000-0000-000000000004',
  evPro: 'c0000000-0000-0000-0000-000000000001', evEnt: 'c0000000-0000-0000-0000-000000000002',
}

export async function freshDb(seed = true) {
  const db = new PGlite()
  await db.exec(readFileSync(join(root, 'src/demo/bootstrap.sql'), 'utf8'))
  for (const f of readdirSync(join(root, 'supabase/migrations')).sort()) {
    await db.exec(readFileSync(join(root, 'supabase/migrations', f), 'utf8'))
  }
  if (seed) await db.exec(readFileSync(join(root, 'src/demo/seed.sql'), 'utf8'))
  return db
}

export type Who = 'anon' | 'service' | keyof typeof IDS

/** Runs `select fn(args)` as the given user, exactly like PostgREST would (role + JWT subject). */
export async function rpc<T = any>(db: PGlite, who: Who, fn: string, args: any[] | Record<string, any> = []): Promise<T> {
  const role = who === 'anon' ? 'anon' : who === 'service' ? 'service_role' : 'authenticated'
  const uid = who === 'anon' || who === 'service' ? '' : (IDS as any)[who]
  return db.transaction(async (tx) => {
    await tx.query(`set local role ${role}`)
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid])
    return callFn<T>(tx as any, fn, args)
  })
}

export async function as<T>(db: PGlite, who: Who, sql: string, params: any[] = []): Promise<T[]> {
  const role = who === 'anon' ? 'anon' : who === 'service' ? 'service_role' : 'authenticated'
  const uid = who === 'anon' || who === 'service' ? '' : (IDS as any)[who]
  return db.transaction(async (tx) => {
    await tx.query(`set local role ${role}`)
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid])
    return (await tx.query<any>(sql, params)).rows as T[]
  })
}
