// Drains the AI job queue (highest plan priority first, FIFO within a priority).
// Providers, in order: FLUX (fal.ai) -> Google Imagen -> none. With no provider the job completes as
// engine="procedural" and the browser draws the deterministic built-in border instead.
import { admin, asUser } from '../_shared/supabase.ts'
import { json, preflight } from '../_shared/cors.ts'

const frame = (prompt: string) => `Ornamental certificate border and background, decorative frame only, large empty plain centre, no text, no letters, no logos, print ready. ${prompt}`

async function flux(prompt: string, landscape: boolean): Promise<Uint8Array | null> {
  const key = Deno.env.get('FAL_KEY'); if (!key) return null
  const r = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: frame(prompt), image_size: landscape ? 'landscape_4_3' : 'portrait_4_3', num_images: 1 }),
  })
  if (!r.ok) throw new Error(`FLUX ${r.status}`)
  const url = (await r.json()).images?.[0]?.url
  if (!url) throw new Error('FLUX returned no image')
  return new Uint8Array(await (await fetch(url)).arrayBuffer())
}

async function imagen(prompt: string, landscape: boolean): Promise<Uint8Array | null> {
  const key = Deno.env.get('GEMINI_API_KEY'); if (!key) return null
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: [{ prompt: frame(prompt) }], parameters: { sampleCount: 1, aspectRatio: landscape ? '4:3' : '3:4' } }),
  })
  if (!r.ok) throw new Error(`Imagen ${r.status}`)
  const b64 = (await r.json()).predictions?.[0]?.bytesBase64Encoded
  if (!b64) throw new Error('Imagen returned no image')
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  // callers: signed-in organisers (right after queuing a job) or the cron secret
  const cron = Deno.env.get('CRON_SECRET')
  const isCron = !!cron && req.headers.get('x-cron-secret') === cron
  if (!isCron && !(await asUser(req).auth.getUser()).data.user) return json({ error: 'unauthorized' }, 401)

  const svc = admin()
  let processed = 0
  for (let i = 0; i < 3; i++) {
    const { data: jobs, error } = await svc.rpc('claim_ai_jobs', { p_limit: 1 })
    if (error || !jobs?.length) break
    const job = jobs[0]
    try {
      const landscape = job.orientation !== 'portrait'
      let engine = 'flux', bytes = await flux(job.prompt, landscape)
      if (!bytes) { engine = 'imagen'; bytes = await imagen(job.prompt, landscape) }
      if (!bytes) { await svc.rpc('complete_ai_job', { p_id: job.id, p_url: '', p_engine: 'procedural', p_error: '' }); processed++; continue }
      const path = `ai/${job.id}.png`
      const up = await svc.storage.from('assets').upload(path, bytes, { contentType: 'image/png', upsert: true })
      if (up.error) throw new Error(up.error.message)
      await svc.rpc('complete_ai_job', { p_id: job.id, p_url: svc.storage.from('assets').getPublicUrl(path).data.publicUrl, p_engine: engine, p_error: '' })
    } catch (e) {
      await svc.rpc('complete_ai_job', { p_id: job.id, p_url: '', p_engine: '', p_error: String((e as Error).message ?? e) })   // refunds the credits
    }
    processed++
  }
  return json({ processed })
})
