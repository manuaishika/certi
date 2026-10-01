// Customer notification templates (WhatsApp / SMS / email). Pure functions, unit-tested.
export interface Composed { text: string; subject: string; html: string }
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function composeNotification(type: string, p: Record<string, any>, baseUrl: string): Composed | null {
  const base = baseUrl.replace(/\/$/, '')
  if (type === 'registration.confirmation') {
    const url = `${base}/pass/${p.token}`
    return {
      subject: `You're registered: ${p.event_title}`,
      text: `Hi ${p.name}, you're registered for ${p.event_title}. Your ID pass: ${url}`,
      html: `<p>Hi ${esc(p.name)},</p><p>You're registered for <b>${esc(p.event_title)}</b>.</p><p><a href="${esc(url)}">Open your ID pass</a></p>`,
    }
  }
  if (type === 'certificate.ready') {
    const url = `${base}/certificate/${p.cert_id}`
    return {
      subject: `Your certificate is ready: ${p.event_title}`,
      text: `Congratulations ${p.name}! Your certificate for ${p.event_title} is ready: ${url}`,
      html: `<p>Congratulations ${esc(p.name)}!</p><p>Your certificate for <b>${esc(p.event_title)}</b> is ready.</p><p><a href="${esc(url)}">Download it here</a></p>`,
    }
  }
  return null
}

/** Indian mobile numbers are stored as 10 digits; everything else must already be E.164. */
export function toE164(mobile: string): string {
  const d = String(mobile).replace(/[^\d+]/g, '')
  return d.startsWith('+') ? d : `+91${d}`
}
