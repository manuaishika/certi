// verify_jwt = false. Crawlers (WhatsApp, LinkedIn, Facebook, Google) don't run the SPA, so the CDN rewrites
// their requests for /certificate/:id and /events/:slug here to get real Open Graph tags + Schema.org JSON-LD.
import { baseUrl, publicClient } from '../_shared/supabase.ts'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const MODE = { offline: 'OfflineEventAttendanceMode', online: 'OnlineEventAttendanceMode', hybrid: 'MixedEventAttendanceMode' } as Record<string, string>

Deno.serve(async (req) => {
  const path = new URL(req.url).searchParams.get('path') ?? '/'
  const base = baseUrl(), sb = publicClient()
  let title = 'CerGeMA — Smart Events, Instant Certificates', desc = 'Registration, QR attendance and verified bilingual certificates.', ld = ''
  let m: RegExpMatchArray | null
  if ((m = path.match(/^\/certificate\/([A-Za-z0-9-]+)$/))) {
    const { data } = await sb.rpc('get_certificate', { p_cert_id: m[1] })
    if (data) { title = `${data.name} earned a certificate: ${data.event_title}`; desc = `Verified by CerGeMA · ${data.org}` }
  } else if ((m = path.match(/^\/events\/([a-z0-9-]+)$/))) {
    const { data } = await sb.rpc('get_public_event', { p_slug: m[1] })
    if (data) {
      const e = data.event; title = `${e.title} — Register`; desc = String(e.description).slice(0, 200)
      ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Event', name: e.title, description: e.description, startDate: e.starts_at,
        eventAttendanceMode: `https://schema.org/${MODE[e.mode]}`, eventStatus: 'https://schema.org/EventScheduled',
        location: e.venue ? { '@type': 'Place', name: e.venue } : undefined, organizer: { '@type': 'Organization', name: data.org.name } }).replace(/</g, '\\u003c')
    }
  }
  const url = `${base}${path}`
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(base)}/og-default.png"><meta name="twitter:card" content="summary_large_image">
${ld ? `<script type="application/ld+json">${ld}</script>` : ''}<meta http-equiv="refresh" content="0;url=${esc(url)}"></head><body><a href="${esc(url)}">${esc(title)}</a></body></html>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } })
})
