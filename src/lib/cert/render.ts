import QRCode from 'qrcode'
import type { BrandItem, EventRow } from '../types'
import { drawProcedural, drawTemplate } from './backgrounds'
import { FIELD_LABELS, mergedLayout, pageSize, type FieldKey } from './layout'

type Ctx = CanvasRenderingContext2D

export interface CertInput {
  event: Pick<EventRow, 'orientation' | 'template' | 'bg_url' | 'accent' | 'cert_title' | 'cert_body' | 'signatory' | 'signatory_role' | 'layout' | 'cohosts' | 'sponsors' | 'sponsor_label' | 'starts_at' | 'title'>
  person: { name_en: string; name_hi: string; grade: string; institution: string }
  org: { name: string; logo_url: string }
  branch: string | null
  cert_id: string
  issued_at: string
  verify_url: string
  watermark: boolean
}

const SERIF = '"Noto Serif", "Noto Serif Devanagari", Georgia, serif'
const imgCache = new Map<string, Promise<HTMLImageElement | null>>()
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)
  let p = imgCache.get(url)
  if (!p) {
    p = new Promise(resolve => {
      const im = new Image(); im.crossOrigin = 'anonymous'
      im.onload = () => resolve(im); im.onerror = () => resolve(null); im.src = url
    })
    imgCache.set(url, p)
  }
  return p
}

let fontsReady: Promise<unknown> | null = null
export function ensureFonts() {
  fontsReady ??= Promise.all(['400', '700'].flatMap(w => [`${w} 40px "Noto Serif"`, `${w} 40px "Noto Serif Devanagari"`].map(f => document.fonts.load(f, 'Aअ')))).catch(() => {})
  return fontsReady
}

function text(c: Ctx, s: string, x: number, y: number, size: number, color: string, bold = false, maxW?: number) {
  let px = size
  c.font = `${bold ? 700 : 400} ${px}px ${SERIF}`
  if (maxW) while (px > 10 && c.measureText(s).width > maxW) { px *= 0.94; c.font = `${bold ? 700 : 400} ${px}px ${SERIF}` }
  c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle'
  c.fillText(s, x, y)
}

function wrap(c: Ctx, s: string, maxW: number): string[] {
  const words = s.split(/\s+/), lines: string[] = []; let cur = ''
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w } else cur = t }
  if (cur) lines.push(cur)
  return lines
}

/** Equal-proportion logo row (co-hosts must be rendered at the same size). */
function logoRow(c: Ctx, logos: HTMLImageElement[], cx: number, cy: number, box: number, gap: number) {
  if (!logos.length) return
  const sc = logos.map(l => { const r = Math.min(box / l.width, box / l.height); return [l, l.width * r, l.height * r] as const })
  let x = cx - (sc.reduce((a, s) => a + s[1], 0) + gap * (sc.length - 1)) / 2
  for (const [l, w, h] of sc) { c.drawImage(l, x, cy - h / 2, w, h); x += w + gap }
}

/** Fills a bitmap exactly with an uploaded/AI background (object-fit: cover). */
function cover(c: Ctx, im: HTMLImageElement, w: number, h: number) {
  const s = Math.max(w / im.width, h / im.height), dw = im.width * s, dh = im.height * s
  c.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

export async function renderCertificate(canvas: HTMLCanvasElement, d: CertInput, opts: { dpi?: number } = {}) {
  await ensureFonts()
  const e = d.event, dpi = opts.dpi ?? 300
  const [W, H] = pageSize(e.orientation, dpi)
  canvas.width = W; canvas.height = H
  const c = canvas.getContext('2d')!
  const base = Math.min(W, H), L = mergedLayout(e)
  const pos = (k: FieldKey): [number, number] => [L[k].x * W, L[k].y * H]
  const sz = (k: FieldKey) => L[k].size * base
  const ink = '#141826', muted = '#5a606e', accent = /^#[0-9a-f]{6}$/i.test(e.accent) ? e.accent : '#1e3a8a'

  const bg = e.bg_url ? await loadImage(e.bg_url) : null
  if (bg) cover(c, bg, W, H)
  else if (e.template === 'procedural') drawProcedural(c, e.title, W, H)
  else drawTemplate(c, e.template === 'custom' ? 'classic' : e.template, W, H, accent)

  const cohostLogos = (await Promise.all([d.org.logo_url, ...(e.cohosts ?? []).map(x => x.logo)].map(loadImage))).filter(Boolean) as HTMLImageElement[]
  const hasCohosts = (e.cohosts?.length ?? 0) > 0
  const orgName = hasCohosts ? [d.org.name, ...e.cohosts.map(x => x.name)].join(' × ') : d.org.name
  if (hasCohosts) {
    logoRow(c, cohostLogos, ...pos('cohosts'), sz('cohosts'), base * .05)
    text(c, orgName, ...pos('org'), sz('org'), accent, true, W * .8)
  } else {
    text(c, orgName, ...pos('org'), sz('org'), accent, true, W * .7)
    if (cohostLogos[0]) {
      c.font = `700 ${sz('org')}px ${SERIF}`
      const half = Math.min(W * .35, c.measureText(orgName).width / 2)
      logoRow(c, [cohostLogos[0]], W / 2 - half - base * .06, pos('org')[1], base * .07, 0)
    }
  }
  if (d.branch) text(c, d.branch, ...pos('branch'), sz('branch'), muted, false, W * .7)
  text(c, e.cert_title, ...pos('title'), sz('title'), accent, true, W * .8)
  text(c, 'This is to certify that', ...pos('certify'), sz('certify'), muted, false, W * .7)
  text(c, d.person.name_en, ...pos('name'), sz('name'), ink, true, W * .78)
  if (d.person.name_hi) text(c, d.person.name_hi, ...pos('name_hi'), sz('name_hi'), ink, true, W * .7)

  const when = new Date(e.starts_at ?? d.issued_at)
  const dateTxt = when.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
  const body = e.cert_body.replaceAll('{event}', e.title).replaceAll('{date}', dateTxt).replaceAll('{name}', d.person.name_en).replaceAll('{grade}', d.person.grade)
  const [bx, by] = pos('body'); c.font = `400 ${sz('body')}px ${SERIF}`
  wrap(c, body, W * (e.orientation === 'landscape' ? .62 : .72)).forEach((ln, i) => text(c, ln, bx, by + i * sz('body') * 1.45, sz('body'), ink))
  const detail = [d.person.grade && `Grade ${d.person.grade}`, d.person.institution].filter(Boolean).join(' · ')
  if (detail) text(c, detail, ...pos('grade'), sz('grade'), muted, false, W * .7)

  const [dx, dy] = pos('date'); c.strokeStyle = muted; c.lineWidth = Math.max(2, base * .0012)
  text(c, dateTxt, dx, dy, sz('date'), ink)
  c.beginPath(); c.moveTo(dx - base * .12, dy - base * .03); c.lineTo(dx + base * .12, dy - base * .03); c.stroke()
  text(c, 'Date', dx, dy + base * .035, sz('date') * .7, muted)
  if (e.signatory) {
    const [sx, sy] = pos('signature')
    text(c, e.signatory, sx, sy, sz('signature'), ink, true)
    c.beginPath(); c.moveTo(sx - base * .14, sy - base * .03); c.lineTo(sx + base * .14, sy - base * .03); c.stroke()
    text(c, e.signatory_role || 'Authorised Signatory', sx, sy + base * .035, sz('signature') * .7, muted)
  }

  const q = sz('qr'), [qx, qy] = pos('qr')
  const qc = document.createElement('canvas')
  await QRCode.toCanvas(qc, d.verify_url, { margin: 1, width: Math.round(q), errorCorrectionLevel: 'M' })
  c.fillStyle = '#fff'; c.fillRect(qx - q / 2, qy - q / 2, q, q); c.drawImage(qc, qx - q / 2, qy - q / 2, q, q)
  text(c, 'Scan to verify', qx, qy + q / 2 + base * .018, base * .014, muted)
  text(c, d.cert_id, ...pos('id'), sz('id'), muted)

  const sponsors = e.sponsors ?? []
  if (sponsors.length) {
    const logos = (await Promise.all(sponsors.map((s: BrandItem) => loadImage(s.logo)))).filter(Boolean) as HTMLImageElement[]
    const [sx, sy] = pos('sponsors')
    if (logos.length) { text(c, e.sponsor_label, sx, sy - sz('sponsors') * .75, base * .016, muted); logoRow(c, logos, sx, sy, sz('sponsors'), base * .04) }
    else text(c, `${e.sponsor_label}: ${sponsors.map(s => s.name).join('   |   ')}`, sx, sy, base * .018, muted, false, W * .8)
  }
  if (d.watermark) text(c, 'Powered by CerGeMA · cergema.mangalhands.com', W / 2, H * .915, base * .014, muted)
  return canvas
}

export const sampleInput = (event: CertInput['event'], org: CertInput['org'], branch: string | null, watermark: boolean): CertInput => ({
  event, org, branch, watermark, cert_id: 'CGM-SAMPLE0001', issued_at: new Date().toISOString(), verify_url: 'https://cergema.mangalhands.com/verify/CGM-SAMPLE0001',
  person: { name_en: 'Aarav Sharma', name_hi: 'आरव शर्मा', grade: '8', institution: 'Demo Public School' },
})

export { FIELD_LABELS }
