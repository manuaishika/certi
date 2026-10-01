// verify_jwt = false. /sitemap.xml is rewritten here by the CDN.
import { baseUrl, publicClient } from '../_shared/supabase.ts'
Deno.serve(async () => {
  const base = baseUrl()
  const { data } = await publicClient().rpc('list_open_events')
  const urls = [`${base}/`, `${base}/claim`, ...((data ?? []) as { slug: string }[]).map(e => `${base}/events/${e.slug}`)]
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${u}</loc></url>`).join('')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' } })
})
