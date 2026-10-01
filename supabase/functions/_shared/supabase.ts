import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const URL = () => Deno.env.get('SUPABASE_URL')!
/** Service-role client: bypasses RLS. Only ever used after the caller has been authenticated/authorised here. */
export const admin = (): SupabaseClient => createClient(URL(), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
/** Client acting as the calling user (RLS applies). */
export const asUser = (req: Request): SupabaseClient =>
  createClient(URL(), Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } })
export const publicClient = (): SupabaseClient => createClient(URL(), Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } })
export const baseUrl = () => (Deno.env.get('PUBLIC_URL') ?? '').replace(/\/$/, '')
