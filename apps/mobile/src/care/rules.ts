/**
 * Small caregiver-app rules that decide what a screen may do: the clock-in guard, the geofence
 * verdict, payday-verification snoozing, the signature image. Pure — no React Native imports —
 * so tests/mobile/care-app.test.ts runs them under plain `bun run`.
 */

// ─── Clock-in guard ────────────────────────────────────────────────────────────────────────

export interface OpenVisit { id: string; client_id?: string | null; client_name?: string | null; offline?: boolean }

/**
 * Why a clock-in must not be sent, or null. The server would auto-close an open visit when the
 * caregiver clocks into another client (and its note would land on the wrong client), so the
 * phone refuses a second open visit instead: clock out of the first one.
 */
export function clockInBlocker(o: { clientId: string | null | undefined; active: OpenVisit | null | undefined; busy?: boolean; activeClientName?: string | null }): string | null {
  if (o.busy) return 'Working on it — no need to tap again.'
  if (o.active) {
    const who = o.activeClientName || o.active.client_name || 'your current client'
    return `You're still clocked in with ${who}. Clock out of that visit first.`
  }
  if (!o.clientId) return 'Pick the client you are with.'
  return null
}

/** Why a clock-out note is required, or null. A visit saved offline lives only on this phone until
 * it syncs — its note is the only record if the office has to fix it. */
export function clockOutNoteBlocker(o: { offline: boolean; note: string | null | undefined }): string | null {
  if (o.offline && !String(o.note || '').trim()) return 'No signal — please add a short visit note so this visit can be saved on your phone.'
  return null
}

// ─── Geofence ──────────────────────────────────────────────────────────────────────────────

export function haversineFeet(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902231 // earth radius in feet
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

export type GeofenceVerdict =
  | { status: 'unknown'; reason: 'no_fix' | 'no_client_location' }
  | { status: 'inside' | 'outside'; distanceFeet: number; radiusFeet: number }

/**
 * Is the phone at the client's home? Uses the agency's geofence radius for the client
 * (GET /api/time-entries/geofence/:clientId, default 300 ft) and gives the fix its accuracy:
 * a fix whose error circle reaches the radius counts as inside.
 */
export function geofenceVerdict(o: {
  fix: { latitude: number; longitude: number; accuracy?: number | null } | null | undefined
  clientLat: unknown; clientLng: unknown; radiusFeet?: number | null
}): GeofenceVerdict {
  if (!o.fix) return { status: 'unknown', reason: 'no_fix' }
  const lat = Number(o.clientLat), lng = Number(o.clientLng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0) || o.clientLat == null || o.clientLng == null) {
    return { status: 'unknown', reason: 'no_client_location' }
  }
  const radiusFeet = o.radiusFeet && o.radiusFeet > 0 ? o.radiusFeet : 300
  const distanceFeet = haversineFeet(o.fix.latitude, o.fix.longitude, lat, lng)
  const slack = o.fix.accuracy && o.fix.accuracy > 0 ? Math.min(o.fix.accuracy * 3.28084, 1000) : 0
  return { status: distanceFeet - slack <= radiusFeet ? 'inside' : 'outside', distanceFeet, radiusFeet }
}

export function formatDistance(feet: number): string {
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`
  const mi = feet / 5280
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`
}

// ─── Payday verification ───────────────────────────────────────────────────────────────────

export interface PaydayPending { payPeriodStart: string; payPeriodEnd: string; payDate?: string }
export interface PaydaySnooze { period: string; until: number }

export const PAYDAY_SNOOZE_MS = 4 * 60 * 60 * 1000
export const paydayPeriodKey = (p: PaydayPending) => `${p.payPeriodStart}..${p.payPeriodEnd}`

/**
 * Show the "please confirm your hours" card? Only when the agency has it on (the server returns
 * `pending: null` otherwise) and the caregiver hasn't put THIS period off. It is a card, never a
 * modal — it must never stand between a caregiver and the clock button.
 */
export function showPayday(pending: PaydayPending | null | undefined, snooze: PaydaySnooze | null | undefined, now: number): boolean {
  if (!pending) return false
  if (snooze && snooze.period === paydayPeriodKey(pending) && snooze.until > now) return false
  return true
}

export function snoozePayday(pending: PaydayPending, now: number): PaydaySnooze {
  return { period: paydayPeriodKey(pending), until: now + PAYDAY_SNOOZE_MS }
}

// ─── Signature image ───────────────────────────────────────────────────────────────────────

export type Stroke = { x: number; y: number }[]

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** UTF-8 → base64, without btoa (not on every Hermes build). */
export function base64Utf8(text: string): string {
  const bytes: number[] = []
  for (const ch of text) {
    let cp = ch.codePointAt(0)!
    if (cp < 0x80) bytes.push(cp)
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63))
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? '=' : B64[b2 & 63]
  }
  return out
}

export const hasInk = (strokes: Stroke[]) => strokes.some((s) => s.length > 1)

/**
 * The drawn signature as an SVG data URI (data:image/svg+xml;base64,…) — the document-sign
 * endpoint accepts any data:image URI and the office shows it in an <img>. Dark ink on a white
 * ground so it reads the same on paper and in either theme.
 */
export function signatureDataUri(strokes: Stroke[], width: number, height: number): string {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height))
  const r = (n: number) => Math.round(n * 10) / 10
  const paths = strokes.filter((s) => s.length > 1)
    .map((s) => `<path d="M${r(s[0].x)} ${r(s[0].y)}${s.slice(1).map((p) => ` L${r(p.x)} ${r(p.y)}`).join('')}"/>`)
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>` +
    `<g fill="none" stroke="#111827" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`
  return `data:image/svg+xml;base64,${base64Utf8(svg)}`
}

// ─── Readable ink ──────────────────────────────────────────────────────────────────────────
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const mix = (fg: string, to: string, a: number) => '#' + [1, 3, 5].map((i) =>
  Math.round(parseInt(fg.slice(i, i + 2), 16) * (1 - a) + parseInt(to.slice(i, i + 2), 16) * a).toString(16).padStart(2, '0')).join('')

/** `color` as text on `ground`, lightened (dark mode) or darkened until it reads at 4.5:1. */
export function readableOn(color: string, ground: string, dark: boolean): string {
  if (!/^#[0-9a-f]{6}$/i.test(color) || !/^#[0-9a-f]{6}$/i.test(ground)) return dark ? '#f1f5f9' : '#0f172a'
  for (const a of [0, 0.2, 0.35, 0.5, 0.65, 0.8]) {
    const c = mix(color, dark ? '#ffffff' : '#000000', a)
    if (contrast(c, ground) >= 4.5) return c
  }
  return dark ? '#ffffff' : '#000000'
}
