// Public URL bootstrap.
//
// Imported first from src/index.ts, before any module that captures
// FRONTEND_URL at import time (services/email.ts, routes/stripe.ts).
//
// FRONTEND_URL is what every emailed link is built from: portal invites,
// password resets, invoice payment links, Stripe return URLs. When it is
// unset those links come out as "/portal?token=..." or
// "undefined/portal/...", and a relative link in an email resolves against
// the mail client's domain — which is what makes Gmail flag it as unsafe.
//
// Render sets RENDER_EXTERNAL_URL on every web service, and the CRM frontend
// is served by this same service, so it is the portal's real origin. The
// factory sets FRONTEND_URL explicitly when a tenant has its own domain; this
// is the floor, not a replacement for that.

function normalise(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /^https?:\/\//.test(trimmed) ? trimmed : 'https://' + trimmed
}

const configured = normalise(process.env.FRONTEND_URL || '')
const fallback = normalise(process.env.RENDER_EXTERNAL_URL || '')

if (!configured && fallback) {
  process.env.FRONTEND_URL = fallback
  console.log('[config] FRONTEND_URL not set — using this service\'s own URL:', fallback)
} else if (configured) {
  // Normalised so a trailing slash cannot produce "https://host//portal".
  process.env.FRONTEND_URL = configured
} else {
  console.warn('[config] FRONTEND_URL and RENDER_EXTERNAL_URL are both unset — emailed links will be relative and may be flagged as unsafe')
}

export const publicBaseUrl = () => process.env.FRONTEND_URL || ''
