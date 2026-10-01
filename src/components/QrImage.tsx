import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
export function QrImage({ value, size = 224, className }: { value: string; size?: number; className?: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => { QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: 'M' }).then(setSrc) }, [value, size])
  return src ? <img src={src} width={size} height={size} alt={`QR code ${value}`} className={className} /> : <div style={{ width: size, height: size }} className="animate-pulse rounded bg-secondary" />
}
