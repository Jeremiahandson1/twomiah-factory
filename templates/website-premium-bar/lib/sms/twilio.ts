/**
 * lib/sms/twilio.ts — transactional SMS only (owner alerts, "your burger's on
 * the grill"). Plain fetch against Twilio's REST API; no SDK. Marketing SMS
 * is a different legal animal (10DLC + written consent, SPEC §12) and must
 * not be sent from here.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, OWNER_ALERT_NUMBER
 */

export interface SmsResult { ok: boolean; sid?: string; error?: string; skipped?: boolean }

export function smsConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER)
}

export function toE164(raw: string): string | null {
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  if (/^\+\d{8,15}$/.test(String(raw || '').trim())) return String(raw).trim()
  return null
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  if (!smsConfigured()) return { ok: false, skipped: true, error: 'SMS not configured' }
  const dest = toE164(to)
  if (!dest) return { ok: false, error: 'Invalid destination number' }
  const sid = process.env.TWILIO_ACCOUNT_SID!
  const token = process.env.TWILIO_AUTH_TOKEN!
  const from = process.env.TWILIO_FROM_NUMBER!
  const form = new URLSearchParams({ To: dest, From: from, Body: body.slice(0, 1500) })
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(10000),
    })
    const json: any = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json?.message || ('Twilio HTTP ' + res.status) }
    return { ok: true, sid: json?.sid }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Twilio request failed' }
  }
}

/** Owner alert: fire-and-forget with logging; never throws. */
export async function alertOwner(body: string): Promise<SmsResult> {
  const owner = process.env.OWNER_ALERT_NUMBER
  if (!owner) return { ok: false, skipped: true, error: 'OWNER_ALERT_NUMBER not set' }
  const r = await sendSms(owner, body)
  if (!r.ok && !r.skipped) console.warn('[sms] owner alert failed:', r.error)
  return r
}
