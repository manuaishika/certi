import { useEffect, useRef, useState } from 'react'
import { renderCertificate, type CertInput } from '@/lib/cert/render'

/** Renders the certificate to a canvas (low DPI for on-screen preview; export always re-renders at 300 DPI). */
export function CertPreview({ input, dpi = 90, className, onRendered }: { input: CertInput; dpi?: number; className?: string; onRendered?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [busy, setBusy] = useState(true)
  const key = JSON.stringify(input)
  useEffect(() => {
    let live = true; setBusy(true)
    const t = setTimeout(() => {
      if (!ref.current) return
      renderCertificate(ref.current, input, { dpi }).then(() => { if (live) { setBusy(false); onRendered?.() } })
    }, 60)
    return () => { live = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dpi])
  return (
    <div className={className} style={{ position: 'relative' }}>
      <canvas ref={ref} className="h-auto w-full rounded border bg-white shadow" aria-label="Certificate preview" />
      {busy && <div className="absolute inset-0 grid place-items-center rounded bg-white/60 text-xs text-muted-foreground">Rendering…</div>}
    </div>)
}
