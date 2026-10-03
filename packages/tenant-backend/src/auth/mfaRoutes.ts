/**
 * Enrolling a second factor, and the screens' half of it. (T57)
 *
 * The dispensary's routes/security.ts has done this since T49, mixed in with a password policy, a
 * session list and an audit feed — all dispensary-shaped. What every vertical needs is the small
 * part: turn an authenticator on, prove it works, see what is enrolled, take one off, and hold a set
 * of recovery codes.
 *
 * ── the rules that are not obvious ──────────────────────────────────────────────────────────────
 *
 * ENROLMENT IS TWO STEPS, and the first one does not arm anything. `setup` stores the seed with
 * `is_verified = false`, and the sign-in gate counts only verified devices — so somebody who starts
 * enrolling, never scans the QR code and closes the tab is not locked out of their own account at the
 * next sign-in. That is the difference between a security feature and an outage.
 *
 * THE SEED IS RETURNED ONCE, by `setup`, because the phone has to be given it. Nothing else ever
 * returns it: not the device list, not verify. A route that hands back `secret` on a GET makes the
 * second factor a function of the first.
 *
 * RECOVERY CODES ARE SHOWN ONCE, in the clear, at the moment they are made. Only hashes are stored,
 * so they cannot be re-displayed later — which is why the response says so and the screen has to
 * make the person keep them.
 *
 * YOU CANNOT REMOVE THE LAST FACTOR WHILE A POLICY DEMANDS ONE. And removing any device asks for a
 * live code from a device you still have, because "my session is open" is exactly the position an
 * attacker with a stolen laptop is in.
 *
 * ── why there is no permission gate, and what stands in for one ─────────────────────────────────
 *
 * The signed-in person is the only subject here, so there is nothing to authorise: gating "enrol my
 * own authenticator" on a right an owner grants would let somebody be refused permission to protect
 * their own account, and would make a company-wide two-factor policy unsatisfiable by the people it
 * applies to.
 *
 * What replaces it is SCOPE, and every statement in this file carries its own — including the ones
 * whose row was already fetched with a user filter. The first draft wrote to a device by bare id
 * after proving ownership a few lines above: safe as written, and the shape that stops being safe
 * the moment somebody moves the fetch. check-write-routes-authorise.ts enforces the strong rule for
 * this file, so a route added later cannot inherit the exemption without the scope.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import crypto from 'crypto'
import { base32Encode, verifyTOTP } from './totp.ts'

export interface MfaRoutesDeps {
  db: any
  authenticate: any
  /** Shown in the authenticator app's entry, e.g. "Twomiah Contractor". */
  issuer: string
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows || []))
/** Two groups of five, from an unambiguous alphabet — no O/0 or I/1 to read back wrong down a phone. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const makeRecoveryCodes = (n = 10) => Array.from({ length: n }, () =>
  Array.from({ length: 10 }, () => RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)]).join('')
    .replace(/^(.{5})(.{5})$/, '$1-$2'))

export function createMfaRoutes(deps: MfaRoutesDeps) {
  const { db, authenticate, issuer } = deps
  const app = new Hono()
  app.use('*', authenticate)

  const devicesOf = async (u: any) => rowsOf(await db.execute(sql`
    SELECT id, type, name, is_verified, is_primary, last_used_at, created_at,
           CASE WHEN type = 'backup_codes'
                THEN COALESCE(json_array_length(backup_codes::json), 0)
                ELSE NULL END AS codes_left
      FROM mfa_devices
     WHERE user_id = ${u.userId} AND company_id = ${u.companyId}
     ORDER BY created_at
  `))

  /** What this person has enrolled. Never the seed. */
  app.get('/devices', async (c) => {
    const u = c.get('user') as any
    const devices = await devicesOf(u)
    return c.json({
      devices: devices.map((d) => ({
        id: d.id,
        type: d.type,
        name: d.name,
        verified: d.is_verified !== false,
        isPrimary: d.is_primary === true,
        lastUsedAt: d.last_used_at,
        createdAt: d.created_at,
        ...(d.codes_left === null ? {} : { codesLeft: Number(d.codes_left) }),
      })),
      /** True when a code will be asked for at the next sign-in — the screen's "two-factor is on". */
      active: devices.some((d) => d.type === 'totp' && d.is_verified !== false),
    })
  })

  /**
   * Step one: make a seed and hand it over for the phone.
   *
   * Unverified, so nothing changes about signing in until step two. Starting enrolment twice replaces
   * the unfinished attempt rather than piling up rows — somebody who loses the QR code just starts
   * again.
   */
  app.post('/setup', async (c) => {
    const u = c.get('user') as any
    const secret = base32Encode(crypto.randomBytes(20))
    await db.execute(sql`
      DELETE FROM mfa_devices
       WHERE user_id = ${u.userId} AND company_id = ${u.companyId}
         AND type = 'totp' AND COALESCE(is_verified, false) = false
    `)
    const [row] = rowsOf(await db.execute(sql`
      INSERT INTO mfa_devices (id, user_id, company_id, type, name, secret, is_verified, created_at)
      VALUES (gen_random_uuid(), ${u.userId}, ${u.companyId}, 'totp', 'Authenticator app', ${secret}, false, NOW())
      RETURNING id
    `))
    const label = encodeURIComponent(`${issuer}:${u.email}`)
    return c.json({
      deviceId: String(row.id),
      secret,
      /** What a QR code encodes. The screen renders it; the seed is also shown for manual entry. */
      otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`,
      message: 'Scan this with your authenticator app, then enter the six digits it shows to finish.',
    }, 201)
  })

  /**
   * Step two: prove the phone has it, and only then does it count.
   *
   * The recovery codes are made HERE rather than at setup, so an abandoned enrolment never leaves a
   * set of live codes behind, and they are returned once because only hashes are kept.
   */
  app.post('/verify', async (c) => {
    const u = c.get('user') as any
    const body = z.object({ deviceId: z.string().min(1), code: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!body.success) return c.json({ error: 'Send the device id and the six digits from your authenticator.' }, 400)

    const [device] = rowsOf(await db.execute(sql`
      SELECT id, type, secret, is_verified FROM mfa_devices
       WHERE id = ${body.data.deviceId} AND user_id = ${u.userId} AND company_id = ${u.companyId} LIMIT 1
    `))
    if (!device) return c.json({ error: 'That enrolment is not on your account.' }, 404)
    if (device.type !== 'totp' || !device.secret) return c.json({ error: 'That device cannot be verified with a code.' }, 400)
    if (!verifyTOTP(String(device.secret), body.data.code)) {
      return c.json({ error: 'That code was not right. Check the app and try the current six digits.', code: 'bad_code' }, 400)
    }

    await db.execute(sql`
      UPDATE mfa_devices SET is_verified = true, is_primary = true, last_used_at = NOW()
       WHERE id = ${device.id} AND user_id = ${u.userId} AND company_id = ${u.companyId}
    `)

    // Recovery codes, once. Replaces any previous set: a new authenticator means the old paper is void.
    const codes = makeRecoveryCodes()
    await db.execute(sql`
      DELETE FROM mfa_devices
       WHERE user_id = ${u.userId} AND company_id = ${u.companyId} AND type = 'backup_codes'
    `)
    await db.execute(sql`
      INSERT INTO mfa_devices (id, user_id, company_id, type, name, backup_codes, is_verified, created_at)
      VALUES (gen_random_uuid(), ${u.userId}, ${u.companyId}, 'backup_codes', 'Recovery codes',
              ${JSON.stringify(codes.map(sha256))}::json, true, NOW())
    `)

    return c.json({
      active: true,
      recoveryCodes: codes,
      message: 'Two-factor is on. Keep these recovery codes somewhere safe — they are shown once and each one works a single time.',
    })
  })

  /** A fresh set, for somebody who used or lost theirs. Needs a live code, not just a session. */
  app.post('/recovery-codes', async (c) => {
    const u = c.get('user') as any
    const body = z.object({ code: z.string().min(1) }).safeParse(await c.req.json().catch(() => ({})))
    if (!body.success) return c.json({ error: 'Enter the code from your authenticator to confirm.' }, 400)
    if (!(await presentedLiveCode(u, body.data.code))) {
      return c.json({ error: 'That code was not right.', code: 'bad_code' }, 400)
    }
    const codes = makeRecoveryCodes()
    await db.execute(sql`
      DELETE FROM mfa_devices
       WHERE user_id = ${u.userId} AND company_id = ${u.companyId} AND type = 'backup_codes'
    `)
    await db.execute(sql`
      INSERT INTO mfa_devices (id, user_id, company_id, type, name, backup_codes, is_verified, created_at)
      VALUES (gen_random_uuid(), ${u.userId}, ${u.companyId}, 'backup_codes', 'Recovery codes',
              ${JSON.stringify(codes.map(sha256))}::json, true, NOW())
    `)
    return c.json({ recoveryCodes: codes, message: 'A new set. The old codes no longer work.' })
  })

  /**
   * Turn it off for this account.
   *
   * Asks for a live code: an open session is exactly what somebody who stole a laptop has, and
   * letting that session remove the second factor makes the factor decorative. Recovery codes go with
   * the authenticator — they are recovery FOR it, and leaving them behind would leave a set of live
   * credentials for a factor that no longer exists.
   */
  app.delete('/devices/:id', async (c) => {
    const u = c.get('user') as any
    const body = await c.req.json().catch(() => ({} as any))
    const code = typeof body?.code === 'string' ? body.code : ''

    // Read the device FIRST: whether a code is required depends on what it is. (T41)
    const [device] = rowsOf(await db.execute(sql`
      SELECT id, type, COALESCE(is_verified, false) AS is_verified FROM mfa_devices
       WHERE id = ${c.req.param('id')} AND user_id = ${u.userId} AND company_id = ${u.companyId} LIMIT 1
    `))
    if (!device) return c.json({ error: 'That device is not on your account.' }, 404)

    /**
     * AN ABANDONED ENROLMENT NEEDS NO CODE TO CLEAN UP. (T41)
     *
     * Demanding a code is right for a VERIFIED device: it proves the person asking still holds the
     * factor they are switching off. For an UNVERIFIED one it is a trap. T41, on every tenant
     * tested: "Cancelling two-factor setup leaves an unverified device behind. Deleting it needs a
     * code, so it can't be cleaned up."
     *
     * Someone who started setup and stopped — closed the tab, could not scan the QR, changed their
     * mind — may never have had the seed in an authenticator at all, so there is no code they could
     * produce. And the row protects nothing: `mfaGateFor` counts only VERIFIED devices, which is
     * why sign-in was unaffected and why this sat there unnoticed. The result was a row nobody could
     * remove and a card showing a pending enrolment for ever.
     *
     * Deleting an unverified row cannot weaken the account: it was never a second factor.
     */
    const needsCode = device.is_verified === true || device.is_verified === 't' || device.is_verified === 1
    if (needsCode) {
      if (!code) return c.json({ error: 'Enter the code from your authenticator to turn two-factor off.', code: 'code_required' }, 400)
      if (!(await presentedLiveCode(u, code))) return c.json({ error: 'That code was not right.', code: 'bad_code' }, 400)
    }

    // A policy that demands a second factor must not be left demanding one nobody has.
    const [co] = rowsOf(await db.execute(sql`SELECT settings FROM company WHERE id = ${u.companyId} LIMIT 1`))
    let requires = false
    try {
      const raw = typeof co?.settings === 'string' ? JSON.parse(co.settings) : (co?.settings || {})
      requires = raw?.requireMfa === true || raw?.security?.requireMfa === true
    } catch { /* unreadable policy is not enforced */ }
    if (requires && device.type === 'totp') {
      const others = rowsOf(await db.execute(sql`
        SELECT id FROM mfa_devices
         WHERE user_id = ${u.userId} AND company_id = ${u.companyId}
           AND type = 'totp' AND id <> ${device.id} AND COALESCE(is_verified, false) = true
      `))
      if (!others.length) {
        return c.json({
          error: 'This company requires two-factor, so you cannot remove your last authenticator. Add another one first.',
          code: 'policy_requires_mfa',
        }, 409)
      }
    }

    await db.execute(sql`
      DELETE FROM mfa_devices
       WHERE id = ${device.id} AND user_id = ${u.userId} AND company_id = ${u.companyId}
    `)
    if (device.type === 'totp') {
      const left = rowsOf(await db.execute(sql`
        SELECT id FROM mfa_devices
         WHERE user_id = ${u.userId} AND company_id = ${u.companyId}
           AND type = 'totp' AND COALESCE(is_verified, false) = true
      `))
      if (!left.length) {
        await db.execute(sql`
          DELETE FROM mfa_devices
           WHERE user_id = ${u.userId} AND company_id = ${u.companyId} AND type = 'backup_codes'
        `)
      }
    }
    return c.json({ removed: true, message: 'Two-factor is off for your account.' })
  })

  /** A code from something currently enrolled — an authenticator, or one of the recovery codes. */
  async function presentedLiveCode(u: any, given: string): Promise<boolean> {
    const code = String(given).trim().toUpperCase().replace(/\s+/g, '')
    const devices = rowsOf(await db.execute(sql`
      SELECT id, type, secret, backup_codes FROM mfa_devices
       WHERE user_id = ${u.userId} AND company_id = ${u.companyId} AND COALESCE(is_verified, false) = true
    `))
    for (const d of devices) {
      if (d.type === 'totp' && d.secret && verifyTOTP(String(d.secret), code)) return true
    }
    const hash = sha256(code)
    for (const d of devices.filter((x) => x.type === 'backup_codes')) {
      const stored: string[] = Array.isArray(d.backup_codes)
        ? d.backup_codes
        : (typeof d.backup_codes === 'string' ? JSON.parse(d.backup_codes || '[]') : [])
      if (!stored.includes(hash)) continue
      // Spent, like any other use of a recovery code.
      await db.execute(sql`
        UPDATE mfa_devices
           SET backup_codes = ${JSON.stringify(stored.filter((h) => h !== hash))}::json, last_used_at = NOW()
         WHERE id = ${d.id} AND user_id = ${u.userId} AND company_id = ${u.companyId}
      `)
      return true
    }
    return false
  }

  return app
}
