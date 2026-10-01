import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import { renderCertificate, type CertInput, ensureFonts } from './render'

export function canvasBlob(c: HTMLCanvasElement, type = 'image/png', q?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not export image'))), type, q))
}

export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

/** 300 DPI print-ready PNG (3508 x 2480) generated entirely in the browser. */
export async function certificatePng(d: CertInput) {
  const c = document.createElement('canvas'); await renderCertificate(c, d, { dpi: 300 }); return canvasBlob(c)
}

/** A4 PDF with the 300 DPI render embedded at full page size. */
export async function certificatePdf(d: CertInput): Promise<Blob> {
  const c = document.createElement('canvas'); await renderCertificate(c, d, { dpi: 300 })
  const land = d.event.orientation === 'landscape'
  const pdf = new jsPDF({ orientation: land ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true })
  pdf.addImage(c.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, land ? 297 : 210, land ? 210 : 297, undefined, 'FAST')
  pdf.setProperties({ title: `${d.person.name_en} — ${d.event.title}`, subject: `Certificate ${d.cert_id}`, creator: 'CerGeMA' })
  return pdf.output('blob')
}

/** 1200 x 630 social preview badge for WhatsApp / LinkedIn / Facebook sharing. */
export async function shareBadge(name: string, eventTitle: string, org: string, certId: string): Promise<Blob> {
  await ensureFonts()
  const c = document.createElement('canvas'); c.width = 1200; c.height = 630
  const g = c.getContext('2d')!
  const font = (px: number, w = 700) => `${w} ${px}px "Noto Serif", "Noto Serif Devanagari", Georgia, serif`
  g.fillStyle = '#0b2a5b'; g.fillRect(0, 0, 1200, 630)
  g.strokeStyle = '#d4af37'; g.lineWidth = 4; g.strokeRect(24, 24, 1152, 582)
  g.textAlign = 'center'; g.textBaseline = 'middle'
  const fit = (s: string, px: number, maxW: number, w = 700) => { let p = px; g.font = font(p, w); while (p > 14 && g.measureText(s).width > maxW) { p -= 2; g.font = font(p, w) } }
  g.fillStyle = '#d4af37'; fit('CERTIFIED', 40, 600); g.fillText('CERTIFIED', 600, 120)
  g.fillStyle = '#fff'; fit(name, 88, 1000); g.fillText(name, 600, 250)
  g.fillStyle = '#c8d2eb'; fit('successfully completed', 34, 800, 400); g.fillText('successfully completed', 600, 360)
  g.fillStyle = '#fff'; fit(eventTitle, 50, 1050); g.fillText(eventTitle, 600, 430)
  g.fillStyle = '#c8d2eb'; fit(org, 32, 1000, 400); g.fillText(org, 600, 505)
  g.fillStyle = '#96a5c8'; fit(`Verify: ${certId}  ·  CerGeMA`, 24, 900, 400); g.fillText(`Verify: ${certId}  ·  CerGeMA`, 600, 570)
  return canvasBlob(c)
}

/** Entry-pass badge image (900 x 1300). */
export async function passBadge(p: { org: string; event: string; name_en: string; name_hi: string; sub: string; token: string; mode: string }): Promise<Blob> {
  await ensureFonts()
  const c = document.createElement('canvas'); c.width = 900; c.height = 1300
  const g = c.getContext('2d')!
  const font = (px: number, w = 700) => `${w} ${px}px "Noto Serif", "Noto Serif Devanagari", Georgia, serif`
  g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 1300); g.fillStyle = '#0b2a5b'; g.fillRect(0, 0, 900, 260)
  g.textAlign = 'center'; g.textBaseline = 'middle'
  const line = (s: string, y: number, px: number, color: string, w = 700, maxW = 820) => { let q = px; g.font = font(q, w); while (q > 14 && g.measureText(s).width > maxW) { q -= 2; g.font = font(q, w) } g.fillStyle = color; g.fillText(s, 450, y) }
  line(p.org, 70, 44, '#fff'); line(p.event, 150, 38, '#d4af37'); line('ENTRY PASS', 215, 28, '#c8d2eb', 400)
  line(p.name_en, 380, 64, '#111827'); if (p.name_hi) line(p.name_hi, 460, 44, '#111827')
  line(p.sub, 530, 30, '#4b5563', 400)
  const qc = document.createElement('canvas'); await QRCode.toCanvas(qc, p.token, { margin: 1, width: 560 })
  g.drawImage(qc, 170, 600); line(p.token, 1210, 40, '#111827'); line(p.mode.toUpperCase(), 1260, 28, '#6b7280', 400)
  return canvasBlob(c)
}
