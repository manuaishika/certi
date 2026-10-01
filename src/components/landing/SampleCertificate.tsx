import { CertPreview } from '@/components/CertPreview'
import { sampleInput } from '@/lib/cert/render'

const input = sampleInput(
  { orientation: 'landscape', template: 'classic', bg_url: '', accent: '#1e3a8a', cert_title: 'Certificate of Participation',
    cert_body: 'for actively participating in {event} held on {date}.', signatory: 'Dr. A. Sharma', signatory_role: 'Principal', layout: {},
    cohosts: [], sponsors: [], sponsor_label: 'Supported By', starts_at: '2026-10-14T10:00:00Z', title: 'Annual Language Day 2026' },
  { name: 'Greenfield Public School', logo_url: '' }, null, false)

/** A real certificate rendered by the same engine organisers use, so visitors see exactly what they will hand out. */
export function SampleCertificate() {
  return (
    <figure className="mx-auto w-full max-w-xl">
      <CertPreview input={{ ...input, person: { name_en: 'Aarav Sharma', name_hi: 'आरव शर्मा', grade: '8', institution: 'Greenfield Public School' } }} dpi={72} className="drop-shadow-xl" />
      <figcaption className="mt-2 text-center text-xs text-muted-foreground">A real certificate made with CerGeMA: English + Devanagari names, signature, and a QR code that proves it is genuine.</figcaption>
    </figure>)
}
