// CallRail webhooks — signature check and payload mapping, ONE implementation for every CRM.
//
// Before: POST /api/calltracking/webhook/callrail/:companyId accepted ANY caller. Anybody who knew a
// company id could write call-log rows, file Lead Inbox leads and make contacts.
//
// CallRail's spec ("Webhooks Security", apidocs.callrail.com): every webhook carries a `Signature`
// header whose value is Base64( HMAC-SHA1( signing key, raw JSON request body ) ). The signing key is
// per CallRail company and the owner copies it from CallRail into Call Tracking › Settings, which
// stores it in company.callrail_signing_key (never returned to a browser — only "set" / "not set").
//
// The body must be verified as the RAW text CallRail sent: re-serialising parsed JSON changes key
// order and whitespace and would never match. Handlers read `await c.req.text()` first and JSON.parse it
// themselves.
import crypto from 'crypto'

/** Base64(HMAC-SHA1(signingKey, rawBody)) — CallRail's `Signature` header value. */
export function callRailSignatureFor(signingKey: string, rawBody: string): string {
  return crypto.createHmac('sha1', signingKey).update(Buffer.from(rawBody, 'utf8')).digest('base64')
}

/**
 * Is this request CallRail's? Timing-safe. With no signing key configured: refused in production
 * (the reason says which key is missing), allowed outside production so local dev and the test
 * harness keep working — the same policy verifyTwilioRequest has.
 */
export function verifyCallRailSignature(rawBody: string, signatureHeader: string | undefined, signingKey: string | undefined): { ok: boolean; reason?: string } {
  if (!signingKey) {
    return process.env.NODE_ENV === 'production'
      ? { ok: false, reason: 'CallRail signing key not configured (Call Tracking › Settings)' }
      : { ok: true, reason: 'no CallRail signing key (non-production)' }
  }
  if (!signatureHeader) return { ok: false, reason: 'missing Signature header' }
  const expected = Buffer.from(callRailSignatureFor(signingKey, rawBody))
  const given = Buffer.from(String(signatureHeader).trim())
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { ok: false, reason: 'signature mismatch' }
  return { ok: true }
}

/**
 * A CallRail call webhook → the call-log fields logCall() takes.
 *
 * The mapper this replaces read caller_phone_number / caller_name / caller_city / caller_state /
 * source — none of which CallRail sends (its payload says customer_phone_number, customer_name,
 * customer_city, customer_state, source_name; see CallRail's own sample in
 * tests/shared/fixtures/callrail-vector.json). A real call was logged with no caller at all. The old
 * names are still read as a fallback, so a tool that posted them keeps working.
 */
export function mapCallRailPayload(payload: any) {
  const p = payload || {}
  const first = (...vals: unknown[]) => { for (const v of vals) if (v !== undefined && v !== null && v !== '') return v as any; return undefined }
  // answered → completed, anything else → missed: what the old mapper stored, and what the volume
  // report counts as missed. A voicemail is an unanswered call.
  const answered = p.answered === true || p.answered === 'true'
  const duration = Number(first(p.duration, 0))
  return {
    trackingNumber: first(p.tracking_phone_number, p.trackingnum),
    callerNumber: first(p.customer_phone_number, p.caller_phone_number, p.callernum),
    callerName: first(p.customer_name, p.caller_name, p.callername),
    callerCity: first(p.customer_city, p.caller_city, p.callercity),
    callerState: first(p.customer_state, p.caller_state, p.callerstate),
    source: first(p.source_name, p.source, p.utm_source),
    campaign: first(p.campaign, p.utm_campaign),
    medium: first(p.medium, p.utm_medium),
    keyword: first(p.keywords, p.utm_term),
    landingPage: first(p.landing_page_url, p.landingpage),
    direction: p.direction === 'outbound' ? 'outbound' : 'inbound',
    status: answered ? 'completed' : 'missed',
    duration: Number.isFinite(duration) ? duration : 0,
    startTime: first(p.start_time, p.timestamp),
    recordingUrl: first(p.recording),
    transcription: first(p.transcription),
    providerId: p.id !== undefined && p.id !== null ? String(p.id) : undefined,
  }
}
