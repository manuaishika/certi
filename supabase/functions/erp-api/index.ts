// REST API for School ERP / SIS integrations. verify_jwt = false; authenticated with the tenant's `x-api-key`.
//   GET  /erp-api/events/:slug/registrations     POST (one object or an array) /erp-api/events/:slug/registrations
//   GET  /erp-api/events/:slug/certificates
import { admin } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  const key = req.headers.get('x-api-key')
  if (!key) return json({ error: 'Missing x-api-key' }, 401)
  const svc = admin()
  const { data: tenant } = await svc.rpc('verify_api_key', { p_key: key })
  if (!tenant) return json({ error: 'Invalid API key' }, 401)

  const m = new URL(req.url).pathname.match(/\/events\/([^/]+)\/(registrations|certificates)\/?$/)
  if (!m) return json({ error: 'Not found. Use /events/:slug/registrations or /events/:slug/certificates' }, 404)
  const [, slug, what] = m
  try {
    if (what === 'certificates' && req.method === 'GET') return json((await svc.rpc('erp_certificates', { p_tenant: tenant, p_slug: slug })).data ?? [])
    if (what === 'registrations' && req.method === 'GET') return json((await svc.rpc('erp_registrations', { p_tenant: tenant, p_slug: slug })).data ?? [])
    if (what === 'registrations' && req.method === 'POST') {
      const body = await req.json()
      const rows = Array.isArray(body) ? body : [body]
      if (rows.length > 1000) return json({ error: 'At most 1000 rows per request' }, 413)
      const { data, error } = await svc.rpc('erp_import', { p_tenant: tenant, p_slug: slug, p_rows: rows })
      return error ? json({ error: error.message }, error.code === 'P0002' ? 404 : 422) : json(data)
    }
    return json({ error: 'Method not allowed' }, 405)
  } catch (e) { return json({ error: String((e as Error).message ?? e) }, 500) }
})
