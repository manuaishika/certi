import { pageSize } from './layout'

type Ctx = CanvasRenderingContext2D
export const TEMPLATE_LABELS: Record<string, string> = { classic: 'Classic Gold', modern: 'Modern Band', mangal: 'Mangal Tricolour' }

function frame(c: Ctx, w: number, h: number, inset: number, width: number, color: string) {
  c.strokeStyle = color; c.lineWidth = width
  c.strokeRect(inset, inset, w - 2 * inset, h - 2 * inset)
}

export function drawTemplate(c: Ctx, name: string, w: number, h: number, accent: string) {
  const u = Math.min(w, h) / 100
  if (name === 'modern') {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h)
    c.fillStyle = accent; c.fillRect(0, 0, 6 * u, h); c.fillRect(w - 2 * u, 0, 2 * u, h)
    c.fillStyle = '#d4af37'; c.beginPath(); c.moveTo(6 * u, 0); c.lineTo(18 * u, 0); c.lineTo(6 * u, 12 * u); c.closePath(); c.fill()
  } else if (name === 'mangal') {
    c.fillStyle = '#fffaf0'; c.fillRect(0, 0, w, h)
    ;['#ff9933', '#cfcfcf', '#138808'].forEach((col, i) => frame(c, w, h, (2.2 + i * 1.3) * u, 1.2 * u, col))
    frame(c, w, h, 7 * u, 0.3 * u, accent)
  } else {
    c.fillStyle = '#fffdf6'; c.fillRect(0, 0, w, h)
    frame(c, w, h, 3 * u, 0.9 * u, accent); frame(c, w, h, 5 * u, 0.3 * u, '#b8902f')
    c.strokeStyle = '#b8902f'; c.lineWidth = 0.4 * u
    for (const [cx, cy] of [[5, 5], [w / u - 5, 5], [5, h / u - 5], [w / u - 5, h / u - 5]]) { c.beginPath(); c.arc(cx * u, cy * u, 2.2 * u, 0, Math.PI * 2); c.stroke() }
  }
}

// ---------------------------------------------------------------- procedural "AI" border
const PALETTES: Record<string, [string, string, string]> = {
  green: ['#0f5132', '#2e8b57', '#d4af37'], eco: ['#0f5132', '#2e8b57', '#d4af37'], leaf: ['#0f5132', '#2e8b57', '#d4af37'],
  saffron: ['#ff9933', '#138808', '#1e3a8a'], mangal: ['#ff9933', '#138808', '#1e3a8a'], blue: ['#0b2a5b', '#2563eb', '#d4af37'],
  royal: ['#2b1055', '#7c3aed', '#d4af37'], red: ['#7f1d1d', '#dc2626', '#d4af37'], gold: ['#8a6d1d', '#d4af37', '#f3e3a1'],
  ocean: ['#0c4a6e', '#0ea5e9', '#e0f2fe'], sunset: ['#9a3412', '#f97316', '#fde68a'], purple: ['#3b0764', '#9333ea', '#f0abfc'],
}
const PAL_LIST = Object.values(PALETTES)

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const rgba = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})` }

/** Deterministic generative border seeded by the prompt: same words, same artwork. Always available offline. */
export function drawProcedural(c: Ctx, prompt: string, w: number, h: number) {
  const rnd = mulberry32(hash(prompt))
  const low = prompt.toLowerCase()
  const key = Object.keys(PALETTES).find(k => low.includes(k))
  const [c1, c2, c3] = key ? PALETTES[key] : PAL_LIST[Math.floor(rnd() * PAL_LIST.length)]
  const u = Math.min(w, h) / 100
  c.fillStyle = '#fffdf7'; c.fillRect(0, 0, w, h)
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, rgba(c2, 0)); g.addColorStop(1, rgba(c2, 0.14))
  c.fillStyle = g; c.fillRect(0, 0, w, h)
  const style = ['rosette', 'wave', 'dots'][Math.floor(rnd() * 3)]
  const band = 7 * u, step = 4.5 * u
  const orn = (x: number, y: number, r: number) => {
    c.strokeStyle = rgba(c1, 0.8); c.fillStyle = rgba(c1, 0.8); c.lineWidth = Math.max(1, u * 0.3)
    if (style === 'rosette') for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; c.beginPath(); c.arc(x + Math.cos(a) * r * .6, y + Math.sin(a) * r * .6, r * .45, 0, Math.PI * 2); c.stroke() }
    else if (style === 'wave') { c.beginPath(); c.arc(x, y, r, 0, Math.PI); c.stroke() }
    else { c.beginPath(); c.arc(x, y, r * .4, 0, Math.PI * 2); c.fill() }
  }
  for (let x = band / 2; x < w - band / 2; x += step) { orn(x, band / 2, step * .55); orn(x, h - band / 2, step * .55) }
  for (let y = band / 2; y < h - band / 2; y += step) { orn(band / 2, y, step * .55); orn(w - band / 2, y, step * .55) }
  frame(c, w, h, band + 1.2 * u, u * 0.5, c3); frame(c, w, h, band + 2.6 * u, u * 0.2, c1)
  c.strokeStyle = rgba(c2, 0.35); c.lineWidth = Math.max(1, u * .3)
  for (let i = 0; i < 14; i++) {
    const [cx, cy] = [[0, 0], [w, 0], [0, h], [w, h]][Math.floor(rnd() * 4)]
    const r = (4 + rnd() * 12) * u; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke()
  }
}

export async function proceduralBlob(prompt: string, orientation: 'landscape' | 'portrait'): Promise<Blob> {
  const [w, h] = pageSize(orientation, 200)
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h
  drawProcedural(cv.getContext('2d')!, prompt, w, h)
  return await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('Canvas export failed')), 'image/jpeg', 0.92))
}
