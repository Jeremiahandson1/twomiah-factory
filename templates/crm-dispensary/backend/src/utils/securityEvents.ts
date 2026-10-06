/**
 * The ONE writer for a security event. (T51 follow-up)
 *
 * Owner: "no user agent is stored."
 *
 * `security_events.user_agent` exists and the read returns it, and not one of the NINE places that
 * wrote a security event listed the column — so it was null on all 41 rows on the live tenant while
 * the audit log beside it had one on 50 of 50. On a security trail that is the difference between
 * "six failed PINs from 10.1.2.3" and knowing whether they came from the till in the shop or a
 * script somewhere else.
 *
 * Nine hand-rolled copies of one INSERT is why the column could be missing from all of them at
 * once, and why the ip was captured two different ways — `callerIp` in the auth route and the raw
 * `x-forwarded-for` header everywhere else, which stores "client, proxy1, proxy2" instead of an
 * address. They all come through here now, so the next column added to this table reaches every
 * event instead of one of them.
 */
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import logger from '../services/logger.ts'

/**
 * WHO IS ASKING — the caller, not the chain of proxies in front of them.
 *
 * `x-forwarded-for` is a list: "client, proxy1, proxy2". The whole header was being stored, so the
 * Security Events screen showed a chain instead of an address (T42, dispensary low) and a throttle
 * keyed on it could not have grouped attempts by anybody. The first hop is the client.
 */
export const callerIp = (c: any) =>
  String(c?.req?.header?.('x-forwarded-for') || '').split(',')[0].trim() ||
  c?.req?.header?.('x-real-ip') ||
  'unknown'

/**
 * …AND WHAT THEY WERE USING.
 *
 * Truncated at 512 characters: a user agent is attacker-controlled input, some are absurdly long,
 * and nothing reads past the first part of one.
 */
export const callerAgent = (c: any) => {
  const ua = c?.req?.header?.('user-agent')
  return ua ? String(ua).slice(0, 512) : null
}

/**
 * Never throws: a security log that fails must not take the operation down with it. A credential
 * change that succeeded and went unlogged is bad; one rolled back because the log was unavailable is
 * worse.
 *
 * `ip` overrides the request's own address for the one caller that records an event on someone
 * else's behalf (the manual /events POST).
 */
export async function recordSecurityEvent(
  c: any,
  companyId: string,
  userId: string | null,
  eventType: string,
  severity: 'info' | 'warning' | 'critical',
  description: string | null,
  opts?: { metadata?: unknown; ip?: string | null },
): Promise<any | null> {
  try {
    const result = await db.execute(sql`
      INSERT INTO security_events (
        id, company_id, event_type, severity, description,
        user_id, ip_address, user_agent, metadata, created_at
      ) VALUES (
        gen_random_uuid(), ${companyId}, ${eventType}, ${severity}, ${description ?? null},
        ${userId}, ${opts?.ip || callerIp(c)}, ${callerAgent(c)},
        ${opts?.metadata === undefined ? null : JSON.stringify(opts.metadata)}::jsonb, NOW()
      ) RETURNING *
    `)
    // Returned for the one caller that hands the row back to the client (POST /events/log). Every
    // other caller ignores it, which is why this is allowed to be null on failure rather than throw.
    return ((result as any).rows || result)?.[0] ?? null
  } catch (e: any) {
    logger.warn('security event not recorded', { eventType, message: e?.message })
    return null
  }
}
