import Papa from 'papaparse'
import { readSheet } from 'read-excel-file/browser'

const ALIASES: Record<string, string> = {
  name: 'name_en', name_en: 'name_en', 'full name': 'name_en', 'name (english)': 'name_en',
  name_hi: 'name_hi', 'hindi name': 'name_hi', 'name (hindi)': 'name_hi', 'नाम': 'name_hi',
  institution: 'institution', school: 'institution', college: 'institution', grade: 'grade', class: 'grade',
  mobile: 'mobile', phone: 'mobile', 'mobile number': 'mobile', email: 'email', parent: 'parent_name', parent_name: 'parent_name', 'parent name': 'parent_name',
}

/** Parses a CSV or XLSX roster into row objects keyed by our field names. */
export async function parseRoster(file: File): Promise<Record<string, string>[]> {
  let rows: string[][]
  if (/\.xlsx?$/i.test(file.name)) {
    rows = (await readSheet(file)).map((r: unknown[]) => r.map(c => (c == null ? '' : String(c))))
  } else {
    const text = await file.text()
    rows = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: true }).data
  }
  if (!rows.length) return []
  const heads = rows[0].map(h => ALIASES[h.trim().toLowerCase()] ?? '')
  if (!heads.includes('name_en') || !heads.includes('mobile')) throw new Error("The file needs at least 'name' and 'mobile' columns")
  return rows.slice(1).filter(r => r.some(c => String(c).trim())).map(r => Object.fromEntries(heads.map((h, i) => [h, String(r[i] ?? '').trim()]).filter(([h]) => h)))
}

export function downloadCsv(filename: string, rows: (string | number | boolean | null)[][]) {
  const csv = '﻿' + Papa.unparse(rows)
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = filename; a.click()
}

/** Downscale + JPEG/PNG re-encode images before upload (backgrounds stay crisp at A4/300 DPI, logos stay small). */
export async function prepareImage(file: File, maxSide: number, keepAlpha: boolean): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s)
  const g = c.getContext('2d')!
  if (!keepAlpha) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height) }
  g.drawImage(bmp, 0, 0, c.width, c.height)
  return await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Not a valid image'))), keepAlpha ? 'image/png' : 'image/jpeg', 0.9))
}
