import { CertPreview } from '@/components/CertPreview'
import { sampleInput } from '@/lib/cert/render'

/** Rendered by the same engine organisers use. All personal details are placeholders on purpose. */
const input = {
  ...sampleInput(
    { orientation: 'landscape', template: 'classic', bg_url: '', accent: '#0b3d38', cert_title: 'Certificate of Participation',
      cert_body: 'for participating in XXXX XXXX held on XX XXXX XXXX.', signatory: 'XXXX XXXX', signatory_role: 'XXXX', layout: {},
      cohosts: [], sponsors: [], sponsor_label: 'Supported By', starts_at: null, title: 'XXXX XXXX' },
    { name: 'XXXX XXXX', logo_url: '' }, null, false),
  person: { name_en: 'XXXX XXXX', name_hi: '', grade: 'XX', institution: 'XXXX XXXX' },
  cert_id: 'CGM-XXXXXXXXXX', dateText: 'XX XXXX XXXX', verify_url: 'https://example.com/verify/CGM-XXXXXXXXXX',
}

export function SampleCertificate() {
  return (
    <figure className="mx-auto w-full max-w-xl">
      <CertPreview input={input} dpi={72} className="rounded-xl bg-card p-2 shadow-xl ring-1 ring-border" />
      <figcaption className="mt-3 text-center text-xs text-muted-foreground">Sample layout. Names, institution and signatory are placeholders.</figcaption>
    </figure>)
}
