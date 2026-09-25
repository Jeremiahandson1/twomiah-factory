/**
 * lib/square/client.ts — the one place that talks to Square. Plain fetch, no
 * SDK (same reason as lib/sms/twilio.ts: one small surface, no dependency).
 *
 * Everything Square-shaped is dormant until the env is set:
 *   SQUARE_ACCESS_TOKEN        the seller's access token (Developer dashboard → Credentials)
 *   SQUARE_LOCATION_ID         840 E Madison's location id
 *   SQUARE_APPLICATION_ID      for the Web Payments SDK on /order (public)
 *   SQUARE_ENVIRONMENT         'sandbox' (default) | 'production'
 *   SQUARE_WEBHOOK_SIGNATURE_KEY  optional — the admin "Connect webhooks" button stores its own
 *   ONLINE_ORDERING            'on' to open /order. Menu sync works without it.
 *   SQUARE_API_BASE            test-only override of the API host
 */
import crypto from 'crypto'

export const SQUARE_VERSION = '2026-09-16'

export interface SquareConfig {
  accessToken: string
  locationId: string
  applicationId: string
  environment: 'sandbox' | 'production'
  base: string
  sdkUrl: string
}

export function squareConfig(): SquareConfig | null {
  const accessToken = (process.env.SQUARE_ACCESS_TOKEN || '').trim()
  const locationId = (process.env.SQUARE_LOCATION_ID || '').trim()
  if (!accessToken || !locationId) return null
  const environment = process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox'
  return {
    accessToken,
    locationId,
    applicationId: (process.env.SQUARE_APPLICATION_ID || '').trim(),
    environment,
    base: (process.env.SQUARE_API_BASE || (environment === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com')).replace(/\/+$/, ''),
    sdkUrl: environment === 'production' ? 'https://web.squarecdn.com/v1/square.js' : 'https://sandbox.web.squarecdn.com/v1/square.js',
  }
}

/** Online ordering needs Square + an application id for the card form + the explicit switch. */
export function onlineOrderingEnabled(): boolean {
  const cfg = squareConfig()
  return !!cfg && !!cfg.applicationId && (process.env.ONLINE_ORDERING || '').toLowerCase() === 'on'
}

export class SquareError extends Error {
  constructor(message: string, public status: number, public errors: any[] = []) { super(message) }
  /** First Square error code, e.g. 'CARD_DECLINED', 'INSUFFICIENT_FUNDS'. */
  get code(): string { return this.errors?.[0]?.code || '' }
}

export async function squareApi<T = any>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown, cfg = squareConfig()): Promise<T> {
  if (!cfg) throw new SquareError('Square is not configured', 503)
  const res = await fetch(cfg.base + path, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = json?.errors?.[0]
    throw new SquareError(`Square ${method} ${path}: ${err?.detail || err?.code || res.status}`, res.status, json?.errors || [])
  }
  return json as T
}

/**
 * Square signs HMAC-SHA256(signatureKey, notificationUrl + rawBody), base64,
 * in the x-square-hmacsha256-signature header. The URL must be byte-for-byte
 * the one the subscription was created with.
 */
export function verifySquareSignature(rawBody: string, signature: string | undefined, signatureKey: string, notificationUrl: string): boolean {
  if (!signature || !signatureKey || !notificationUrl) return false
  const expected = crypto.createHmac('sha256', signatureKey).update(notificationUrl + rawBody).digest('base64')
  const a = Buffer.from(expected), b = Buffer.from(signature)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`
}
