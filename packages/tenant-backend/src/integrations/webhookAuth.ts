// What every provider webhook shares once its own verifier has answered: the refusal, and the
// shared-secret check for a partner that signs nothing and sends a secret instead.
import crypto from 'crypto'

/**
 * The one refusal every provider webhook sends: 403, nothing else done, one warning line naming the
 * webhook and the reason — never the key, the signature or the body.
 */
export function refuseUnverifiedWebhook(c: any, label: string, reason: string | undefined) {
  console.warn(`[webhook] refused ${label}: ${reason || 'not verified'}`)
  return c.json({ error: 'Webhook not verified', reason: reason || 'not verified' }, 403)
}

/** A per-integration webhook secret, compared in constant time. No expected secret → refused, never "anything goes". */
export function verifyWebhookSecret(given: string | undefined | null, expected: string | undefined | null): boolean {
  if (!expected || !given) return false
  const a = Buffer.from(String(given))
  const b = Buffer.from(String(expected))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
