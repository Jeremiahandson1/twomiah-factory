/**
 * Two-factor at SIGN-IN, for every vertical.
 *
 * ── where this came from ────────────────────────────────────────────────────────────────────────
 *
 * Built for the dispensary in T49 H4, after a report found the product had the whole of MFA except
 * the part that matters: enrolment screens, an authenticator secret, recovery codes and a "Require
 * MFA for all users" switch — and POST /api/auth/login handed out tokens for an email and a password
 * every time. An owner who turned two-factor on believed the account holding the tax filings and the
 * payroll rates was protected by it; it was protected by the password alone.
 *
 * Moved here in T57 because nothing about it is a dispensary concern. Every vertical holds contacts,
 * invoices and a Stripe connection, and two implementations of a code verifier is two verifiers that
 * can disagree — the one nobody updated being the one that lets the wrong code through.
 *
 * ── the rule ────────────────────────────────────────────────────────────────────────────────────
 *
 * If the account has a second factor that can actually be PRESENTED, sign-in returns a challenge
 * instead of tokens, and the tokens are issued only once a code is accepted.
 *
 * ── and the part that has to be right, or nobody can work ───────────────────────────────────────
 *
 * The failure mode of getting this wrong is locking every user out of a live business. So the test
 * is "is there a factor that can be presented", not "is MFA configured":
 *
 *   · a verified totp / sms / email device  → CHALLENGE. There is something to type.
 *   · backup codes ALONE                    → let them in. Recovery codes are recovery FOR a second
 *     factor, not a second factor; they are not presented at sign-in because nobody carries them.
 *   · the policy requires MFA but the user has enrolled nothing → let them in, and say so. Switching
 *     a policy on must not lock out the people it applies to before they have had a chance to enrol.
 *     The flag lets a screen insist; it does not bar the door.
 *   · THE TABLES ARE NOT IN THIS VERTICAL'S SCHEMA → let them in. (T57)
 *     This is the new one, and it is why the port is safe to land everywhere at once: a template
 *     that has not added mfa_devices has nothing enrolled by definition, so the honest answer is
 *     "no second factor", not a 500 on the sign-in route of every tenant in the fleet.
 *
 * Recovery codes ARE accepted at the challenge — that is their entire purpose.
 */
import { sql } from 'drizzle-orm'
import crypto from 'crypto'
// The same verifier enrolment uses. Passing it in as a parameter would have let sign-in be handed
// a different one.
import { verifyTOTP } from './totp.ts'

/** A factor a person can be asked for at sign-in. Backup codes are deliberately not one. */
const PRESENTABLE = ['totp', 'sms', 'email'] as const

/** Wrong codes one challenge will take before it is spent. (T57) */
export const MAX_CODE_ATTEMPTS = 5

export interface MfaGate {
  /** Sign-in must stop and ask for a code. */
  required: boolean
  /** Which factors this account can present, for the screen to offer. */
  methods: string[]
  /** True when the company policy demands MFA and this user has enrolled nothing yet. */
  enrolmentRequired: boolean
  /** Whether a recovery code would be accepted — so the screen can offer that route. */
  hasRecoveryCodes: boolean
}

const NO_FACTOR: MfaGate = { required: false, methods: [], enrolmentRequired: false, hasRecoveryCodes: false }

/**
 * WHERE THE PEOPLE AND THE BUSINESS ARE, for a schema that is not the contractor's. (store, home care)
 *
 * Everything above assumes the contractor lineage: people in `"user"`, each carrying a company_id, and
 * the require-MFA policy on `company.settings`. crm-store and crm-homecare are one business per
 * database with forked auth — their people are in `users`, nobody carries a company_id, and there is
 * no `company` table (home care has `agencies`; the store has `store_settings`). Querying the default
 * shapes there is a 500 on the sign-in route, so those two pass a scope instead.
 *
 * EVERY FIELD IS OPTIONAL AND THE DEFAULT IS EXACTLY THE OLD BEHAVIOUR: with no scope, the same SQL
 * runs against the same tables. Nine verticals call this without one and must not notice it exists.
 *
 * The mfa_* tables keep their company_id column in single-company mode, filled with the fixed value
 * below. One set of statements, not a second dialect with the company filter missing — a statement
 * that forgot its scope is how two implementations of the same rule begin to disagree.
 */
export interface MfaScope {
  /** The table signed-in people live in. Default `user`. */
  usersTable?: string
  /**
   * One business per database: the company_id every mfa_* row is written and read with, instead of
   * the user row's. Unset (the default), the company is the user's own company_id.
   */
  singleCompanyId?: string
  /**
   * Does this business's policy demand two-factor? Default: `company.settings.requireMfa`. In
   * single-company mode with no reader given, there is no policy — off, never a lockout.
   */
  policyRequiresMfa?: (db: any, companyId: string) => Promise<boolean>
}

/** The policy, read the way the scope says — a policy we cannot read is a policy we do not enforce. */
async function policyRequires(db: any, companyId: string, scope?: MfaScope): Promise<boolean> {
  if (scope?.policyRequiresMfa) {
    try { return (await scope.policyRequiresMfa(db, companyId)) === true } catch { return false }
  }
  if (scope?.singleCompanyId) return false
  try {
    const co: any = await db.execute(sql`SELECT settings FROM company WHERE id = ${companyId} LIMIT 1`)
    const settings = (((co as any).rows || co)[0] || {}).settings || {}
    const raw = typeof settings === 'string' ? JSON.parse(settings) : settings
    return raw?.requireMfa === true || raw?.security?.requireMfa === true
  } catch { return false }
}

/**
 * Is two-factor even possible in this schema?
 *
 * Asked of the database rather than configured per template, so adding the tables is the only thing
 * a vertical has to do to switch the feature on — and forgetting to flip a flag cannot leave a
 * vertical with enrolment screens and a sign-in that ignores them, which is the T49 fault exactly.
 */
async function tablesPresent(db: any): Promise<boolean> {
  try {
    const r: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_name IN ('mfa_devices', 'mfa_challenges')
    `)
    return Number(((r as any).rows || r)[0]?.n ?? 0) >= 2
  } catch { return false }
}

/** What sign-in should do about two-factor for this user. */
export async function mfaGateFor(db: any, companyId: string, userId: string, scope?: MfaScope): Promise<MfaGate> {
  if (!(await tablesPresent(db))) return NO_FACTOR
  if (scope?.singleCompanyId) companyId = scope.singleCompanyId
  let devices: Array<{ type: string; is_verified: boolean }> = []
  try {
    const rows: any = await db.execute(sql`
      SELECT type, is_verified FROM mfa_devices
      WHERE user_id = ${userId} AND company_id = ${companyId}
    `)
    devices = ((rows as any).rows || rows) as any[]
  } catch { return NO_FACTOR }

  const presentable = devices
    .filter((d) => d.is_verified !== false && (PRESENTABLE as readonly string[]).includes(String(d.type)))
    .map((d) => String(d.type))
  const hasRecoveryCodes = devices.some((d) => String(d.type) === 'backup_codes' && d.is_verified !== false)

  const policy = await policyRequires(db, companyId, scope)

  return {
    required: presentable.length > 0,
    methods: [...new Set(presentable)],
    // Only meaningful when there is nothing to present: the policy is owed an enrolment, not a lockout.
    enrolmentRequired: policy && presentable.length === 0,
    hasRecoveryCodes,
  }
}

/**
 * Open a sign-in challenge. Short-lived, single-use, and tied to the user it was made for.
 *
 * Reuses mfa_challenges, the table the in-app challenge already uses, with type 'login' so the two
 * cannot be mistaken for one another.
 */
export async function openLoginChallenge(db: any, companyId: string, userId: string): Promise<{ challengeId: string; expiresAt: string }> {
  const rows: any = await db.execute(sql`
    INSERT INTO mfa_challenges (id, device_id, user_id, type, code, status, expires_at, created_at)
    VALUES (gen_random_uuid(), NULL, ${userId}, 'login', NULL, 'pending', NOW() + INTERVAL '10 minutes', NOW())
    RETURNING id, expires_at
  `)
  const row = ((rows as any).rows || rows)[0]
  return { challengeId: String(row.id), expiresAt: new Date(row.expires_at).toISOString() }
}

export type MfaCodeOutcome =
  | { ok: true; userId: string; usedRecoveryCode: boolean }
  | { ok: false; error: string; code: string }

/**
 * Check a code against a pending sign-in challenge, and spend it.
 *
 * TOTP is checked against the enrolled secret. A recovery code is matched by hash and REMOVED, so it
 * works once. A wrong code costs one of five tries on this challenge (T57): a pending challenge used
 * to accept guesses for its whole ten-minute life, and a suite put twelve through before the real
 * code still worked. Being spent is not a lockout on the ACCOUNT — the person signs in again with
 * their password and gets a fresh challenge, which is what an honest typo needs.
 */
export async function verifyLoginChallenge(
  db: any,
  challengeId: string,
  code: string,
  scope?: MfaScope,
): Promise<MfaCodeOutcome> {
  const given = String(code || '').trim().toUpperCase().replace(/\s+/g, '')
  if (!given) return { ok: false, error: 'Enter the code from your authenticator, or one of your recovery codes.', code: 'code_required' }

  // Two plain queries rather than a join: the challenge, then the user it belongs to. The table is
  // `user` (singular) in these schemas, and guessing it in a clever join is how this would have
  // failed at runtime on a route nothing else covers.
  const rows: any = await db.execute(sql`
    SELECT id, user_id, expires_at, status, attempts FROM mfa_challenges
    WHERE id = ${challengeId} AND type = 'login' LIMIT 1
  `)
  const challenge = ((rows as any).rows || rows)[0]
  if (!challenge || challenge.status !== 'pending') {
    return { ok: false, error: 'That sign-in request is no longer valid. Start again.', code: 'challenge_not_found' }
  }
  if (new Date(challenge.expires_at) < new Date()) {
    await db.execute(sql`UPDATE mfa_challenges SET status = 'expired' WHERE id = ${challengeId}`)
    return { ok: false, error: 'That code request has expired. Sign in again.', code: 'challenge_expired' }
  }

  const userId = String(challenge.user_id)
  //
  // A scope that names another table is quoted with sql.identifier, never spliced: `user` is a reserved
  // word and an unquoted FROM user reads the function, not the table. A single-company scope has no
  // company_id to read, so only the person's existence is asked and the fixed id stands in.
  const userRows: any = scope?.singleCompanyId
    ? await db.execute(sql`SELECT id FROM ${sql.identifier(scope.usersTable || 'user')} WHERE id = ${userId} LIMIT 1`)
    : scope?.usersTable
      ? await db.execute(sql`SELECT company_id FROM ${sql.identifier(scope.usersTable)} WHERE id = ${userId} LIMIT 1`)
      : await db.execute(sql`SELECT company_id FROM "user" WHERE id = ${userId} LIMIT 1`)
  const userRow = ((userRows as any).rows || userRows)[0]
  if (!userRow) return { ok: false, error: 'That sign-in request is no longer valid. Start again.', code: 'challenge_not_found' }
  const companyId = scope?.singleCompanyId ?? String(userRow.company_id)

  const devRows: any = await db.execute(sql`
    SELECT id, type, secret, backup_codes FROM mfa_devices
    WHERE user_id = ${userId} AND company_id = ${companyId} AND COALESCE(is_verified, true) = true
  `)
  const devices = ((devRows as any).rows || devRows) as any[]

  // An authenticator first — it is what the person is holding.
  for (const d of devices.filter((x) => String(x.type) === 'totp' && x.secret)) {
    if (verifyTOTP(String(d.secret), given)) {
      await spend(db, challengeId, d.id)
      return { ok: true, userId, usedRecoveryCode: false }
    }
  }

  // …then a recovery code, matched by hash and burned.
  const hash = crypto.createHash('sha256').update(given).digest('hex')
  for (const d of devices.filter((x) => String(x.type) === 'backup_codes')) {
    const stored: string[] = Array.isArray(d.backup_codes)
      ? d.backup_codes
      : (typeof d.backup_codes === 'string' ? JSON.parse(d.backup_codes || '[]') : [])
    if (!stored.includes(hash)) continue
    const left = stored.filter((h) => h !== hash)
    await db.execute(sql`UPDATE mfa_devices SET backup_codes = ${JSON.stringify(left)}::jsonb, last_used_at = NOW() WHERE id = ${d.id}`)
    await spend(db, challengeId, d.id)
    return { ok: true, userId, usedRecoveryCode: true }
  }

  const spentAttempts = Number(challenge.attempts ?? 0) + 1
  if (spentAttempts >= MAX_CODE_ATTEMPTS) {
    await db.execute(sql`UPDATE mfa_challenges SET status = 'failed', attempts = ${spentAttempts} WHERE id = ${challengeId}`)
    return {
      ok: false,
      error: `That code was not right, and this sign-in request has had ${MAX_CODE_ATTEMPTS} tries. Sign in again to get a new code.`,
      code: 'too_many_attempts',
    }
  }
  await db.execute(sql`UPDATE mfa_challenges SET attempts = ${spentAttempts} WHERE id = ${challengeId}`)
  const left = MAX_CODE_ATTEMPTS - spentAttempts
  return {
    ok: false,
    error: `That code was not right. Try again, or use one of your recovery codes. ${left} ${left === 1 ? 'try' : 'tries'} left on this request.`,
    code: 'bad_code',
  }
}

async function spend(db: any, challengeId: string, deviceId: string) {
  await db.execute(sql`
    UPDATE mfa_challenges SET status = 'verified', verified_at = NOW(), device_id = ${deviceId}
    WHERE id = ${challengeId}
  `)
}
