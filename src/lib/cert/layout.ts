import type { EventRow, FieldPos } from '../types'

export const FIELDS = ['org', 'branch', 'cohosts', 'title', 'certify', 'name', 'name_hi', 'body', 'grade', 'date', 'signature', 'qr', 'sponsors', 'id'] as const
export type FieldKey = (typeof FIELDS)[number]
export const FIELD_LABELS: Record<FieldKey, string> = {
  org: 'Organisation', branch: 'Branch / Campus', cohosts: 'Co-host logos', title: 'Title', certify: "'This is to certify'",
  name: 'Name (English)', name_hi: 'Name (Devanagari)', body: 'Body text', grade: 'Grade / Institution', date: 'Date',
  signature: 'Signature', qr: 'Verification QR', sponsors: 'Sponsors', id: 'Certificate ID',
}

/** A4 at a given DPI: 297 x 210 mm (landscape) or 210 x 297 mm (portrait). */
export function pageSize(orientation: 'landscape' | 'portrait', dpi = 300): [number, number] {
  const w = Math.round(297 / 25.4 * dpi), h = Math.round(210 / 25.4 * dpi)
  return orientation === 'landscape' ? [w, h] : [h, w]
}

/**
 * x, y = centre as a fraction of the page; size = font size as a fraction of the short side.
 * Everything sits inside the ornament-safe zone (~8-92 % of each axis).
 */
export function defaultLayout(orientation: 'landscape' | 'portrait', cohosts = false): Record<FieldKey, FieldPos> {
  if (orientation === 'landscape') {
    const l: Record<FieldKey, FieldPos> = {
      org: { x: .5, y: .12, size: .05 }, branch: { x: .5, y: .175, size: .028 }, cohosts: { x: .5, y: .10, size: .07 },
      title: { x: .5, y: .285, size: .08 }, certify: { x: .5, y: .365, size: .03 }, name: { x: .5, y: .445, size: .09 },
      name_hi: { x: .5, y: .53, size: .05 }, body: { x: .5, y: .61, size: .03 }, grade: { x: .5, y: .70, size: .027 },
      date: { x: .22, y: .78, size: .027 }, signature: { x: .5, y: .78, size: .027 }, qr: { x: .83, y: .74, size: .13 },
      sponsors: { x: .5, y: .885, size: .05 }, id: { x: .83, y: .86, size: .016 },
    }
    if (cohosts) { l.org = { ...l.org, y: .17, size: .038 }; l.branch = { ...l.branch, y: .215 } }
    return l
  }
  const l: Record<FieldKey, FieldPos> = {
    org: { x: .5, y: .10, size: .05 }, branch: { x: .5, y: .135, size: .03 }, cohosts: { x: .5, y: .095, size: .06 },
    title: { x: .5, y: .225, size: .072 }, certify: { x: .5, y: .29, size: .033 }, name: { x: .5, y: .355, size: .08 },
    name_hi: { x: .5, y: .415, size: .048 }, body: { x: .5, y: .49, size: .033 }, grade: { x: .5, y: .58, size: .03 },
    date: { x: .26, y: .69, size: .03 }, signature: { x: .74, y: .69, size: .03 }, qr: { x: .8, y: .80, size: .14 },
    sponsors: { x: .36, y: .83, size: .05 }, id: { x: .8, y: .895, size: .017 },
  }
  if (cohosts) { l.org = { ...l.org, y: .145, size: .036 }; l.branch = { ...l.branch, y: .175 } }
  return l
}

export function mergedLayout(e: Pick<EventRow, 'orientation' | 'layout' | 'cohosts'>): Record<FieldKey, FieldPos> {
  const base = defaultLayout(e.orientation, (e.cohosts?.length ?? 0) > 0)
  for (const k of FIELDS) {
    const o = e.layout?.[k]
    if (o) base[k] = { ...base[k], ...Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'number')) } as FieldPos
  }
  return base
}
