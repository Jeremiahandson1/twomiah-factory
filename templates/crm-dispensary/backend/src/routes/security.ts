import { Hono } from 'hono'
import { z } from 'zod'
import crypto from 'crypto'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// ==========================================
// TOTP Helpers
// ==========================================

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function generateTOTPSecret(): string {
  const bytes = crypto.randomBytes(20)
  let result = ''
  let bits = 0
  let value = 0
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      result += BASE32_CHARS[(value >>> bits) & 0x1f]
    }
  }
  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f]
  }
  return result
}

function base32Decode(encoded: string): Buffer {
  let bits = 0
  let value = 0
  const output: number[] = []
  for (const char of encoded.toUpperCase()) {
    const idx = BASE32_CHARS.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      output.push((value >>> bits) & 0xff)
    }
  }
  return Buffer.from(output)
}

function generateTOTPCode(secret: string, timeStep: number): string {
  const key = base32Decode(secret)
  const timeBuffer = Buffer.alloc(8)
  timeBuffer.writeUInt32BE(0, 0)
  timeBuffer.writeUInt32BE(timeStep, 4)

  const hmac = crypto.createHmac('sha1', key)
  hmac.update(timeBuffer)
  const hash = hmac.digest()

  const offset = hash[hash.length - 1] & 0x0f
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff)

  return String(code % 1000000).padStart(6, '0')
}

function verifyTOTP(secret: string, code: string): boolean {
  const now = Math.floor(Date.now() / 1000)
  const timeStep = Math.floor(now / 30)
  // Check current window ±1
  for (let i = -1; i <= 1; i++) {
    if (generateTOTPCode(secret, timeStep + i) === code) return true
  }
  return false
}

// ==========================================
// Zod Schemas
// ==========================================

const mfaSetupSchema = z.object({
  type: z.enum(['totp', 'sms', 'email']),
})

const mfaVerifySchema = z.object({
  deviceId: z.string().uuid(),
  code: z.string().min(6).max(6),
})

const mfaChallengeSchema = z.object({
  userId: z.string().uuid(),
  deviceId: z.string().uuid(),
})

const mfaChallengeVerifySchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().min(6).max(6),
})

const mfaDeleteSchema = z.object({
  password: z.string().min(1),
})

const passwordPolicySchema = z.object({
  minLength: z.number().int().min(6).max(128).optional(),
  maxLength: z.number().int().min(6).max(128).optional(),
  requireUppercase: z.boolean().optional(),
  requireLowercase: z.boolean().optional(),
  requireNumbers: z.boolean().optional(),
  requireSpecialChars: z.boolean().optional(),
  maxAgeDays: z.number().int().min(0).optional(),
  historyCount: z.number().int().min(0).max(24).optional(),
  lockoutAttempts: z.number().int().min(0).optional(),
  lockoutDurationMinutes: z.number().int().min(0).optional(),
})

const passwordValidateSchema = z.object({
  password: z.string(),
})

const securityEventLogSchema = z.object({
  eventType: z.string().min(1),
  severity: z.enum(['info', 'warning', 'critical']),
  description: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  userId: z.string().uuid().optional(),
  ipAddress: z.string().optional(),
})

// ==========================================
// MFA/2FA (CC6.1)
// ==========================================

// Set up MFA device
app.post('/mfa/setup', async (c) => {
  const currentUser = c.get('user') as any
  const data = mfaSetupSchema.parse(await c.req.json())

  let secret: string | null = null
  let otpauthUrl: string | null = null
  let verificationCode: string | null = null

  if (data.type === 'totp') {
    secret = generateTOTPSecret()
    otpauthUrl = `otpauth://totp/Dispensary:${currentUser.email}?secret=${secret}&issuer=Dispensary&algorithm=SHA1&digits=6&period=30`
  } else {
    // SMS or email — generate a 6-digit verification code
    verificationCode = String(crypto.randomInt(100000, 999999))
  }

  // For TOTP, store the raw secret (needed for code verification).
  // For SMS/email, store the hashed verification code.
  const secretToStore = data.type === 'totp' ? secret : null
  const hashedVerification = data.type !== 'totp' && verificationCode
    ? crypto.createHash('sha256').update(verificationCode).digest('hex')
    : null

  const result = await db.execute(sql`
    INSERT INTO mfa_devices (
      id, company_id, user_id, type, secret,
      is_verified, created_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId}, ${currentUser.userId},
      ${data.type}, ${secretToStore},
      false, NOW()
    ) RETURNING id, type, is_verified, created_at
  `)

  const device = ((result as any).rows || result)[0]

  // For SMS, send verification code (placeholder — actual SMS handled by SMS service)
  if (data.type === 'sms' && verificationCode) {
    await db.execute(sql`
      INSERT INTO mfa_challenges (
        id, company_id, device_id, user_id, code_hash,
        expires_at, used, created_at
      ) VALUES (
        gen_random_uuid(), ${currentUser.companyId}, ${device.id}, ${currentUser.userId},
        ${crypto.createHash('sha256').update(verificationCode).digest('hex')},
        NOW() + INTERVAL '5 minutes', false, NOW()
      )
    `)
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'mfa_device',
    entityId: device.id,
    metadata: { type: data.type },
    req: c.req,
  })

  const response: any = { device }
  if (data.type === 'totp') {
    response.secret = secret
    response.otpauthUrl = otpauthUrl
  }

  return c.json(response, 201)
})

// Verify MFA setup
app.post('/mfa/verify', async (c) => {
  const currentUser = c.get('user') as any
  const data = mfaVerifySchema.parse(await c.req.json())

  const deviceResult = await db.execute(sql`
    SELECT * FROM mfa_devices
    WHERE id = ${data.deviceId}
      AND user_id = ${currentUser.userId}
      AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const device = ((deviceResult as any).rows || deviceResult)[0]
  if (!device) return c.json({ error: 'MFA device not found' }, 404)

  let valid = false

  if (device.type === 'totp') {
    // For TOTP, read the raw secret stored during setup and verify the code
    if (device.secret) {
      valid = verifyTOTP(device.secret, data.code)
    }
  } else {
    // SMS/email — compare code hash against challenge
    const codeHash = crypto.createHash('sha256').update(data.code).digest('hex')
    const challengeResult = await db.execute(sql`
      SELECT * FROM mfa_challenges
      WHERE device_id = ${data.deviceId}
        AND user_id = ${currentUser.userId}
        AND code_hash = ${codeHash}
        AND expires_at > NOW()
        AND used = false
      ORDER BY created_at DESC
      LIMIT 1
    `)
    const challenge = ((challengeResult as any).rows || challengeResult)[0]
    if (challenge) {
      valid = true
      await db.execute(sql`
        UPDATE mfa_challenges SET used = true WHERE id = ${challenge.id}
      `)
    }
  }

  if (!valid) {
    await db.execute(sql`
      INSERT INTO security_events (
        id, company_id, event_type, severity, description,
        user_id, ip_address, created_at
      ) VALUES (
        gen_random_uuid(), ${currentUser.companyId}, 'mfa_verify_failed', 'warning',
        'MFA setup verification failed', ${currentUser.userId},
        ${c.req.header('x-forwarded-for') || 'unknown'}, NOW()
      )
    `)
    return c.json({ error: 'Invalid verification code' }, 400)
  }

  await db.execute(sql`
    UPDATE mfa_devices
    SET is_verified = true, verified_at = NOW(), updated_at = NOW()
    WHERE id = ${data.deviceId}
  `)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'mfa_device',
    entityId: data.deviceId,
    metadata: { event: 'verified' },
    req: c.req,
  })

  return c.json({ success: true })
})

// Create MFA challenge during login
app.post('/mfa/challenge', async (c) => {
  const currentUser = c.get('user') as any
  const data = mfaChallengeSchema.parse(await c.req.json())

  const deviceResult = await db.execute(sql`
    SELECT * FROM mfa_devices
    WHERE id = ${data.deviceId}
      AND user_id = ${data.userId}
      AND company_id = ${currentUser.companyId}
      AND is_verified = true
    LIMIT 1
  `)
  const device = ((deviceResult as any).rows || deviceResult)[0]
  if (!device) return c.json({ error: 'MFA device not found or not verified' }, 404)

  const code = String(crypto.randomInt(100000, 999999))
  const codeHash = crypto.createHash('sha256').update(code).digest('hex')

  const result = await db.execute(sql`
    INSERT INTO mfa_challenges (
      id, company_id, device_id, user_id, code_hash,
      expires_at, used, created_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId}, ${data.deviceId}, ${data.userId},
      ${codeHash},
      NOW() + INTERVAL '5 minutes', false, NOW()
    ) RETURNING id, expires_at
  `)

  const challenge = ((result as any).rows || result)[0]

  // For SMS devices, send the code
  if (device.device_type === 'sms') {
    // SMS sending would be handled by the SMS service
    // This is a placeholder — the actual implementation would call smsService.send()
    await db.execute(sql`
      INSERT INTO security_events (
        id, company_id, event_type, severity, description,
        user_id, ip_address, metadata, created_at
      ) VALUES (
        gen_random_uuid(), ${currentUser.companyId}, 'mfa_code_sent', 'info',
        'MFA challenge code sent via SMS', ${data.userId},
        ${c.req.header('x-forwarded-for') || 'unknown'},
        ${JSON.stringify({ deviceType: 'sms', challengeId: challenge.id })}::jsonb,
        NOW()
      )
    `)
  }

  return c.json({ challengeId: challenge.id, expiresAt: challenge.expires_at })
})

// Verify MFA challenge
app.post('/mfa/challenge/verify', async (c) => {
  const currentUser = c.get('user') as any
  const data = mfaChallengeVerifySchema.parse(await c.req.json())

  const challengeResult = await db.execute(sql`
    SELECT mc.*, md.type as device_type, md.secret
    FROM mfa_challenges mc
    JOIN mfa_devices md ON md.id = mc.device_id
    WHERE mc.id = ${data.challengeId}
      AND mc.company_id = ${currentUser.companyId}
      AND mc.used = false
    LIMIT 1
  `)
  const challenge = ((challengeResult as any).rows || challengeResult)[0]
  if (!challenge) return c.json({ error: 'Challenge not found or already used' }, 404)

  // Check expiry
  if (new Date(challenge.expires_at) < new Date()) {
    await db.execute(sql`
      INSERT INTO security_events (
        id, company_id, event_type, severity, description,
        user_id, ip_address, created_at
      ) VALUES (
        gen_random_uuid(), ${currentUser.companyId}, 'mfa_challenge_expired', 'warning',
        'MFA challenge expired', ${challenge.user_id},
        ${c.req.header('x-forwarded-for') || 'unknown'}, NOW()
      )
    `)
    return c.json({ error: 'Challenge has expired' }, 400)
  }

  let valid = false

  if (challenge.device_type === 'totp') {
    // For TOTP, verify against the raw secret
    if (challenge.secret) {
      valid = verifyTOTP(challenge.secret, data.code)
    }
  } else {
    // SMS/email — compare code hash
    const codeHash = crypto.createHash('sha256').update(data.code).digest('hex')
    valid = codeHash === challenge.code_hash
  }

  if (!valid) {
    await db.execute(sql`
      INSERT INTO security_events (
        id, company_id, event_type, severity, description,
        user_id, ip_address, created_at
      ) VALUES (
        gen_random_uuid(), ${currentUser.companyId}, 'mfa_challenge_failed', 'warning',
        'MFA challenge verification failed', ${challenge.user_id},
        ${c.req.header('x-forwarded-for') || 'unknown'}, NOW()
      )
    `)
    return c.json({ success: false, error: 'Invalid code' }, 400)
  }

  // Mark challenge as used
  await db.execute(sql`
    UPDATE mfa_challenges SET used = true WHERE id = ${data.challengeId}
  `)

  // Log success event
  await db.execute(sql`
    INSERT INTO security_events (
      id, company_id, event_type, severity, description,
      user_id, ip_address, created_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId}, 'mfa_challenge_verified', 'info',
      'MFA challenge verified successfully', ${challenge.user_id},
      ${c.req.header('x-forwarded-for') || 'unknown'}, NOW()
    )
  `)

  audit.log({
    action: audit.ACTIONS.LOGIN,
    entity: 'mfa_challenge',
    entityId: data.challengeId,
    metadata: { event: 'challenge_verified' },
    req: c.req,
  })

  return c.json({ success: true })
})

// List user's MFA devices
app.get('/mfa/devices', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT id, device_type, is_verified, verified_at, created_at, updated_at
    FROM mfa_devices
    WHERE user_id = ${currentUser.userId}
      AND company_id = ${currentUser.companyId}
    ORDER BY created_at DESC
  `)

  return c.json((result as any).rows || result)
})

// Remove MFA device (requires password confirmation)
app.delete('/mfa/devices/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = mfaDeleteSchema.parse(await c.req.json())

  // Verify password
  const passwordHash = crypto.createHash('sha256').update(data.password).digest('hex')
  const userResult = await db.execute(sql`
    SELECT id FROM "user"
    WHERE id = ${currentUser.userId}
      AND password_hash = crypt(${data.password}, password_hash)
    LIMIT 1
  `)
  const userFound = ((userResult as any).rows || userResult)[0]
  if (!userFound) return c.json({ error: 'Invalid password' }, 403)

  const deviceResult = await db.execute(sql`
    SELECT * FROM mfa_devices
    WHERE id = ${id}
      AND user_id = ${currentUser.userId}
      AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const device = ((deviceResult as any).rows || deviceResult)[0]
  if (!device) return c.json({ error: 'MFA device not found' }, 404)

  await db.execute(sql`
    DELETE FROM mfa_devices WHERE id = ${id}
  `)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'mfa_device',
    entityId: id,
    metadata: { deviceType: device.device_type },
    req: c.req,
  })

  return c.json({ success: true })
})

// Generate backup codes
app.get('/mfa/backup-codes', async (c) => {
  const currentUser = c.get('user') as any

  // Generate 10 single-use backup codes
  const codes: string[] = []
  const hashedCodes: string[] = []

  for (let i = 0; i < 10; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase()
    codes.push(code)
    hashedCodes.push(crypto.createHash('sha256').update(code).digest('hex'))
  }

  // Store backup codes in an mfa_device record of type 'backup'
  // Remove any existing backup codes device first
  await db.execute(sql`
    DELETE FROM mfa_devices
    WHERE user_id = ${currentUser.userId}
      AND company_id = ${currentUser.companyId}
      AND type = 'backup_codes'
  `)

  await db.execute(sql`
    INSERT INTO mfa_devices (
      id, company_id, user_id, type,
      backup_codes, is_verified, created_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId}, ${currentUser.userId},
      'backup_codes',
      ${JSON.stringify(hashedCodes)}::jsonb,
      true, NOW()
    )
  `)

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'mfa_backup_codes',
    entityId: currentUser.userId,
    metadata: { codeCount: 10 },
    req: c.req,
  })

  // Return plaintext codes — only shown once
  return c.json({ codes })
})

// ==========================================
// Password Policy (CC6.1)
// ==========================================

// Get company's password policy
app.get('/password-policy', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT * FROM password_policies
    WHERE company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const policy = ((result as any).rows || result)[0]

  if (!policy) {
    // Return defaults
    return c.json({
      minLength: 8,
      maxLength: 128,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChars: false,
      maxAgeDays: 90,
      historyCount: 5,
      lockoutAttempts: 5,
      lockoutDurationMinutes: 30,
    })
  }

  return c.json(policy)
})

// Update password policy (admin only)
app.put('/password-policy', requireRole('owner'), async (c) => {
  const currentUser = c.get('user') as any
  const data = passwordPolicySchema.parse(await c.req.json())

  // Upsert
  const existing = await db.execute(sql`
    SELECT id FROM password_policies
    WHERE company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const found = ((existing as any).rows || existing)[0]

  let result
  if (found) {
    result = await db.execute(sql`
      UPDATE password_policies SET
        min_length = COALESCE(${data.minLength ?? null}, min_length),
        max_length = COALESCE(${data.maxLength ?? null}, max_length),
        require_uppercase = COALESCE(${data.requireUppercase ?? null}, require_uppercase),
        require_lowercase = COALESCE(${data.requireLowercase ?? null}, require_lowercase),
        require_numbers = COALESCE(${data.requireNumbers ?? null}, require_numbers),
        require_special_chars = COALESCE(${data.requireSpecialChars ?? null}, require_special_chars),
        max_age_days = COALESCE(${data.maxAgeDays ?? null}, max_age_days),
        history_count = COALESCE(${data.historyCount ?? null}, history_count),
        lockout_attempts = COALESCE(${data.lockoutAttempts ?? null}, lockout_attempts),
        lockout_duration_minutes = COALESCE(${data.lockoutDurationMinutes ?? null}, lockout_duration_minutes),
        updated_at = NOW()
      WHERE company_id = ${currentUser.companyId}
      RETURNING *
    `)
  } else {
    result = await db.execute(sql`
      INSERT INTO password_policies (
        id, company_id, min_length, max_length,
        require_uppercase, require_lowercase, require_numbers, require_special_chars,
        max_age_days, history_count, lockout_attempts, lockout_duration_minutes,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${currentUser.companyId},
        ${data.minLength ?? 8}, ${data.maxLength ?? 128},
        ${data.requireUppercase ?? true}, ${data.requireLowercase ?? true},
        ${data.requireNumbers ?? true}, ${data.requireSpecialChars ?? false},
        ${data.maxAgeDays ?? 90}, ${data.historyCount ?? 5},
        ${data.lockoutAttempts ?? 5}, ${data.lockoutDurationMinutes ?? 30},
        NOW(), NOW()
      ) RETURNING *
    `)
  }

  const updated = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'password_policy',
    entityId: updated.id,
    metadata: data,
    req: c.req,
  })

  return c.json(updated)
})

// Validate a password against policy
app.post('/password/validate', async (c) => {
  const currentUser = c.get('user') as any
  const data = passwordValidateSchema.parse(await c.req.json())

  // Get policy
  const policyResult = await db.execute(sql`
    SELECT * FROM password_policies
    WHERE company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const policy = ((policyResult as any).rows || policyResult)[0] || {
    min_length: 8,
    max_length: 128,
    require_uppercase: true,
    require_lowercase: true,
    require_numbers: true,
    require_special_chars: false,
    history_count: 5,
  }

  const errors: string[] = []
  const pw = data.password

  if (pw.length < (policy.min_length || 8)) errors.push('Too short')
  if (pw.length > (policy.max_length || 128)) errors.push('Too long')
  if (policy.require_uppercase && !/[A-Z]/.test(pw)) errors.push('Missing uppercase letter')
  if (policy.require_lowercase && !/[a-z]/.test(pw)) errors.push('Missing lowercase letter')
  if (policy.require_numbers && !/[0-9]/.test(pw)) errors.push('Missing number')
  if (policy.require_special_chars && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw)) {
    errors.push('Missing special character')
  }

  // Check password history
  if (policy.history_count > 0) {
    const pwHash = crypto.createHash('sha256').update(pw).digest('hex')
    const historyResult = await db.execute(sql`
      SELECT password_hash FROM password_history
      WHERE user_id = ${currentUser.userId}
      ORDER BY created_at DESC
      LIMIT ${policy.history_count}
    `)
    const history = (historyResult as any).rows || historyResult
    for (const h of history) {
      if (h.password_hash === pwHash) {
        errors.push('Password was recently used')
        break
      }
    }
  }

  return c.json({ valid: errors.length === 0, errors })
})

// ==========================================
// Session Management (CC6.3)
// ==========================================

// List active sessions for current user
app.get('/sessions', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT id, device_type, ip_address, location, user_agent,
           last_activity, created_at, is_current
    FROM active_sessions
    WHERE user_id = ${currentUser.userId}
      AND company_id = ${currentUser.companyId}
      AND revoked = false
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY last_activity DESC
  `)

  return c.json((result as any).rows || result)
})

// List all sessions for company (admin only)
app.get('/sessions/all', requireRole('owner'), async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')
  const offset = (page - 1) * limit

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT s.*, u.email as user_email, u.first_name, u.last_name
      FROM active_sessions s
      LEFT JOIN "user" u ON u.id = s.user_id
      WHERE s.company_id = ${currentUser.companyId}
        AND s.revoked = false
        AND (s.expires_at IS NULL OR s.expires_at > NOW())
      ORDER BY s.last_activity DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM active_sessions
      WHERE company_id = ${currentUser.companyId}
        AND revoked = false
        AND (expires_at IS NULL OR expires_at > NOW())
    `),
  ])

  const data = (dataResult as any).rows || dataResult
  const total = Number(((countResult as any).rows || countResult)[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Revoke a specific session
app.delete('/sessions/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existing = await db.execute(sql`
    SELECT * FROM active_sessions
    WHERE id = ${id}
      AND user_id = ${currentUser.userId}
      AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const found = ((existing as any).rows || existing)[0]
  if (!found) return c.json({ error: 'Session not found' }, 404)

  await db.execute(sql`
    UPDATE active_sessions SET revoked = true, revoked_at = NOW() WHERE id = ${id}
  `)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'session',
    entityId: id,
    metadata: { event: 'session_revoked' },
    req: c.req,
  })

  return c.json({ success: true })
})

// Revoke all sessions except current
app.post('/sessions/revoke-all', async (c) => {
  const currentUser = c.get('user') as any
  const currentSessionId = c.req.header('x-session-id') || ''

  const result = await db.execute(sql`
    UPDATE active_sessions
    SET revoked = true, revoked_at = NOW()
    WHERE user_id = ${currentUser.userId}
      AND company_id = ${currentUser.companyId}
      AND revoked = false
      AND id != ${currentSessionId}
    RETURNING id
  `)

  const revoked = (result as any).rows || result

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'session',
    entityId: currentUser.userId,
    metadata: { event: 'revoke_all_sessions', count: revoked.length },
    req: c.req,
  })

  return c.json({ success: true, revokedCount: revoked.length })
})

// Revoke all sessions for a user (admin only)
app.post('/sessions/revoke-user/:userId', requireRole('owner'), async (c) => {
  const currentUser = c.get('user') as any
  const userId = c.req.param('userId')

  const result = await db.execute(sql`
    UPDATE active_sessions
    SET revoked = true, revoked_at = NOW()
    WHERE user_id = ${userId}
      AND company_id = ${currentUser.companyId}
      AND revoked = false
    RETURNING id
  `)

  const revoked = (result as any).rows || result

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'session',
    entityId: userId,
    metadata: { event: 'revoke_active_sessions', targetUserId: userId, count: revoked.length },
    req: c.req,
  })

  return c.json({ success: true, revokedCount: revoked.length })
})

// ==========================================
// Security Events (CC6.2)
// ==========================================

// List security events (admin only, paginated, filterable)
app.get('/events', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')
  const offset = (page - 1) * limit
  const eventType = c.req.query('type')
  const severity = c.req.query('severity')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  let typeFilter = sql``
  if (eventType) typeFilter = sql`AND event_type = ${eventType}`

  let severityFilter = sql``
  if (severity) severityFilter = sql`AND severity = ${severity}`

  let dateFilter = sql``
  if (startDate) dateFilter = sql`${dateFilter} AND created_at >= ${new Date(startDate)}`
  if (endDate) dateFilter = sql`${dateFilter} AND created_at <= ${new Date(endDate)}`

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT se.*, u.email as user_email
      FROM security_events se
      LEFT JOIN "user" u ON u.id = se.user_id
      WHERE se.company_id = ${currentUser.companyId}
        ${typeFilter}
        ${severityFilter}
        ${dateFilter}
      ORDER BY se.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM security_events
      WHERE company_id = ${currentUser.companyId}
        ${typeFilter}
        ${severityFilter}
        ${dateFilter}
    `),
  ])

  const data = (dataResult as any).rows || dataResult
  const total = Number(((countResult as any).rows || countResult)[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Event summary: counts by type and severity for last 24h/7d/30d
app.get('/events/summary', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const [byType24h, byType7d, byType30d, bySeverity24h, bySeverity7d, bySeverity30d] = await Promise.all([
    db.execute(sql`
      SELECT event_type, COUNT(*)::int as count
      FROM security_events
      WHERE company_id = ${currentUser.companyId}
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY event_type ORDER BY count DESC
    `),
    db.execute(sql`
      SELECT event_type, COUNT(*)::int as count
      FROM security_events
      WHERE company_id = ${currentUser.companyId}
        AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY event_type ORDER BY count DESC
    `),
    db.execute(sql`
      SELECT event_type, COUNT(*)::int as count
      FROM security_events
      WHERE company_id = ${currentUser.companyId}
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY event_type ORDER BY count DESC
    `),
    db.execute(sql`
      SELECT severity, COUNT(*)::int as count
      FROM security_events
      WHERE company_id = ${currentUser.companyId}
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY severity
    `),
    db.execute(sql`
      SELECT severity, COUNT(*)::int as count
      FROM security_events
      WHERE company_id = ${currentUser.companyId}
        AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY severity
    `),
    db.execute(sql`
      SELECT severity, COUNT(*)::int as count
      FROM security_events
      WHERE company_id = ${currentUser.companyId}
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY severity
    `),
  ])

  return c.json({
    last24h: {
      byType: (byType24h as any).rows || byType24h,
      bySeverity: (bySeverity24h as any).rows || bySeverity24h,
    },
    last7d: {
      byType: (byType7d as any).rows || byType7d,
      bySeverity: (bySeverity7d as any).rows || bySeverity7d,
    },
    last30d: {
      byType: (byType30d as any).rows || byType30d,
      bySeverity: (bySeverity30d as any).rows || bySeverity30d,
    },
  })
})

// Acknowledge a security event
app.put('/events/:id/acknowledge', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existing = await db.execute(sql`
    SELECT * FROM security_events
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const found = ((existing as any).rows || existing)[0]
  if (!found) return c.json({ error: 'Security event not found' }, 404)

  const result = await db.execute(sql`
    UPDATE security_events
    SET acknowledged = true, acknowledged_by = ${currentUser.userId}, acknowledged_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'security_event',
    entityId: id,
    metadata: { event: 'acknowledged' },
    req: c.req,
  })

  return c.json(updated)
})

// Log a security event (used by other services)
app.post('/events/log', async (c) => {
  const currentUser = c.get('user') as any
  const data = securityEventLogSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO security_events (
      id, company_id, event_type, severity, description,
      user_id, ip_address, metadata, created_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId},
      ${data.eventType}, ${data.severity}, ${data.description || null},
      ${data.userId || currentUser.userId},
      ${data.ipAddress || c.req.header('x-forwarded-for') || 'unknown'},
      ${data.metadata ? JSON.stringify(data.metadata) : null}::jsonb,
      NOW()
    ) RETURNING *
  `)

  const created = ((result as any).rows || result)[0]

  return c.json(created, 201)
})

// ==========================================
// Encryption Key Management (CC9.1)
// ==========================================

// List encryption keys (admin only, never returns actual key material)
app.get('/encryption/keys', requireRole('owner'), async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT id, key_name, key_type, algorithm, version,
           is_active, created_at, rotated_at, expires_at
    FROM encryption_keys
    WHERE company_id = ${currentUser.companyId}
    ORDER BY key_name, version DESC
  `)

  return c.json((result as any).rows || result)
})

// Rotate an encryption key
app.post('/encryption/keys/rotate', requireRole('owner'), async (c) => {
  const currentUser = c.get('user') as any
  const { keyId } = z.object({ keyId: z.string().uuid() }).parse(await c.req.json())

  // Get current key
  const existing = await db.execute(sql`
    SELECT * FROM encryption_keys
    WHERE id = ${keyId} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const currentKey = ((existing as any).rows || existing)[0]
  if (!currentKey) return c.json({ error: 'Encryption key not found' }, 404)

  // Deactivate old key
  await db.execute(sql`
    UPDATE encryption_keys
    SET is_active = false, updated_at = NOW()
    WHERE id = ${keyId}
  `)

  // Create new version
  const result = await db.execute(sql`
    INSERT INTO encryption_keys (
      id, company_id, key_name, key_type, algorithm,
      key_hash, version, is_active,
      created_at, rotated_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId},
      ${currentKey.key_name}, ${currentKey.key_type}, ${currentKey.algorithm},
      ${crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex')},
      ${(currentKey.version || 1) + 1}, true,
      NOW(), NOW(), NOW()
    ) RETURNING id, key_name, key_type, algorithm, version, is_active, created_at, rotated_at
  `)

  const newKey = ((result as any).rows || result)[0]

  await db.execute(sql`
    INSERT INTO security_events (
      id, company_id, event_type, severity, description,
      user_id, ip_address, metadata, created_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId}, 'encryption_key_rotated', 'info',
      'Encryption key rotated', ${currentUser.userId},
      ${c.req.header('x-forwarded-for') || 'unknown'},
      ${JSON.stringify({ keyName: currentKey.key_name, oldVersion: currentKey.version, newVersion: newKey.version })}::jsonb,
      NOW()
    )
  `)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'encryption_key',
    entityId: newKey.id,
    metadata: {
      event: 'key_rotated',
      keyName: currentKey.key_name,
      oldVersion: currentKey.version,
      newVersion: newKey.version,
    },
    req: c.req,
  })

  return c.json(newKey, 201)
})

export default app
