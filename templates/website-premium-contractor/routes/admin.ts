/**
 * Admin JSON API for the premium template.
 *
 * Mounted at /api/admin/* by server-static.ts. Token-based auth (Bearer
 * Authorization header). Pages CRUD reads + writes the `pages` table.
 *
 * Auth:
 *   POST   /login              public, returns { token, user }
 *   GET    /me                 auth, returns { user }
 *   POST   /password           auth, body { currentPassword, newPassword }
 * Users (admin role only, except /password above):
 *   GET    /users              admin, list users
 *   POST   /users              admin, body { email, password, name?, role? }
 *   PATCH  /users/:id          admin, body { name?, role? }
 *   DELETE /users/:id          admin, refuses to remove last admin or self
 * Pages:
 *   GET    /pages              auth, list pages
 *   GET    /pages/:slug        auth, single page including sections JSON
 *   POST   /pages              auth, body { slug, title, sections?, ... }
 *   PATCH  /pages/:slug        auth, partial update
 *   DELETE /pages/:slug        auth, refuses to delete 'home'
 * Settings / Photos / Leads — auth, see below.
 */
import { Hono, type Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { eq, asc, desc, and, not } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import sharp from 'sharp'
import crypto from 'crypto'
import { db } from '../db'
import { users as usersTbl, pages as pagesTbl, photos as photosTbl, settings as settingsTbl, leads as leadsTbl, posts as postsTbl, userTokens as userTokensTbl, auditLog as auditLogTbl, sessions as sessionsTbl } from '../db/schema'
import { isNull } from 'drizzle-orm'
import { uploadImage, deleteImage } from '../services/storage'
import { validatePasswordStrength } from '../lib/security'
import { generateSecret, verifyTotp, otpauthUri, generateRecoveryCodes } from '../lib/totp'
import { sendPasswordResetEmail, sendEmailVerificationEmail, sendLoginNotificationEmail } from '../lib/email'
import { writeAudit, clientIp } from '../lib/audit'

// In-memory 2FA challenge store. After a successful password check we
// hand the client a one-time challenge ID; they POST it back with the
// TOTP code. Single-process is fine (one Render web service per tenant)
// and challenges expire in 5 minutes so the map stays small.
interface Challenge { userId: string; expiresAt: number }
const twofaChallenges = new Map<string, Challenge>()
function newChallenge(userId: string): string {
  const id = crypto.randomBytes(24).toString('base64url')
  twofaChallenges.set(id, { userId, expiresAt: Date.now() + 5 * 60 * 1000 })
  // Opportunistic GC
  if (twofaChallenges.size > 1000) {
    const now = Date.now()
    for (const [k, v] of twofaChallenges) if (v.expiresAt < now) twofaChallenges.delete(k)
  }
  return id
}
function consumeChallenge(id: string): string | null {
  const ch = twofaChallenges.get(id)
  if (!ch || ch.expiresAt < Date.now()) { twofaChallenges.delete(id); return null }
  twofaChallenges.delete(id)
  return ch.userId
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000  // 1 hour
const VERIFY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000  // 7 days

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function siteOrigin(c: Context): string {
  const explicit = process.env.SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const host = c.req.header('Host') || 'localhost'
  const proto = c.req.header('X-Forwarded-Proto') || (host.startsWith('localhost') ? 'http' : 'https')
  return proto + '://' + host
}

type AdminVars = {
  userId?: string
  userEmail?: string
  userRole?: string
  sessionId?: string
}

const app = new Hono<{ Variables: AdminVars }>()

const JWT_SECRET = process.env.JWT_SECRET || ''
const TOKEN_TTL_SECONDS = 60 * 60 * 12 // 12h
const AUTH_COOKIE = 'auth'

function signToken(user: { id: string; email: string; role: string }, jti: string): string {
  if (!JWT_SECRET) throw new Error('JWT_SECRET not set')
  return jwt.sign({ sub: user.id, email: user.email, role: user.role, jti }, JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS })
}

// Set the auth JWT as an httpOnly cookie. JavaScript on the page can't
// read it (so XSS can't exfiltrate the credential), the browser refuses
// to send it on cross-site requests (so CSRF is dead), and it auto-rides
// every same-origin request — admin SPA doesn't touch the token at all.
function setAuthCookie(c: Context, token: string) {
  setCookie(c, AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
    path: '/',
    maxAge: TOKEN_TTL_SECONDS,
  })
}

async function authMiddleware(c: Context<{ Variables: AdminVars }>, next: () => Promise<void>) {
  if (!JWT_SECRET) return c.json({ error: 'JWT_SECRET not configured' }, 503)
  const cookieToken = getCookie(c, AUTH_COOKIE) || ''
  const header = c.req.header('Authorization') || ''
  const headerToken = header.startsWith('Bearer ') ? header.slice(7) : ''
  const token = cookieToken || headerToken
  if (!token) return c.json({ error: 'Missing auth token' }, 401)
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string; email?: string; role?: string; iat?: number; jti?: string }
    if (!decoded.sub) return c.json({ error: 'Invalid token' }, 401)
    // jti-based session check. Bearer tokens (server-to-server) may not
    // carry a jti — those skip the session check, since they're issued
    // with the factory sync key, not from the login flow.
    if (decoded.jti) {
      const sess = (await db.select().from(sessionsTbl).where(eq(sessionsTbl.jti, decoded.jti)).limit(1))[0]
      if (!sess || sess.revokedAt) {
        deleteCookie(c, AUTH_COOKIE, { path: '/' })
        return c.json({ error: 'Session was revoked. Please sign in again.' }, 401)
      }
      // Best-effort heartbeat — don't await
      db.update(sessionsTbl).set({ lastSeenAt: new Date() }).where(eq(sessionsTbl.id, sess.id)).catch(() => {})
      c.set('sessionId', sess.id)
    } else {
      // Legacy/non-session-issued token — still honor tokensInvalidatedAt
      const rows = await db.select({ tokensInvalidatedAt: usersTbl.tokensInvalidatedAt })
        .from(usersTbl).where(eq(usersTbl.id, decoded.sub)).limit(1)
      const inv = rows[0]?.tokensInvalidatedAt
      if (inv && decoded.iat && decoded.iat * 1000 < inv.getTime()) {
        deleteCookie(c, AUTH_COOKIE, { path: '/' })
        return c.json({ error: 'Session was revoked. Please sign in again.' }, 401)
      }
    }
    c.set('userId', decoded.sub)
    c.set('userEmail', decoded.email)
    c.set('userRole', decoded.role || 'admin')
    await next()
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
}

// Audit-log every successful admin mutation. Catches everything that
// touches state without each handler needing to call writeAudit. Login
// and a few other endpoints add richer entries manually on top.
app.use('*', async (c, next) => {
  await next()
  const m = c.req.method
  if (m === 'GET' || m === 'OPTIONS' || m === 'HEAD') return
  if (c.res.status >= 400) return
  const userId = c.get('userId') || null
  const userEmail = c.get('userEmail') || null
  // Skip the noisier auth churn — login/me have their own audit entries
  const path = new URL(c.req.url).pathname
  if (/\/(login|login\/2fa|logout|me|password\/forgot)$/.test(path)) return
  writeAudit(c, {
    userId, userEmail,
    action: m.toLowerCase() + ' ' + path.replace(/^\/api\/admin/, ''),
    target: path.replace(/^\/api\/admin\//, ''),
  })
})

// ─── Auth ─────────────────────────────────────────────────────────────────

async function completeLogin(c: Context, user: { id: string; email: string; name: string | null; role: string }) {
  await db.update(usersTbl).set({ lastLoginAt: new Date() }).where(eq(usersTbl.id, user.id))
  const jti = crypto.randomBytes(16).toString('base64url')
  await db.insert(sessionsTbl).values({
    userId: user.id,
    jti,
    ip: clientIp(c),
    userAgent: (c.req.header('User-Agent') || '').slice(0, 500),
  })
  const token = signToken({ id: user.id, email: user.email, role: user.role }, jti)
  setAuthCookie(c, token)
  writeAudit(c, { userId: user.id, userEmail: user.email, action: 'login' })
  // Login notification — fire-and-forget so a flaky SendGrid doesn't stall sign-in
  const origin = siteOrigin(c)
  sendLoginNotificationEmail({
    to: user.email,
    ip: clientIp(c),
    userAgent: (c.req.header('User-Agent') || 'unknown').slice(0, 200),
    when: new Date(),
    resetUrl: origin + '/admin/forgot-password',
  }).catch(() => { /* non-fatal */ })
  return c.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  })
}

app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { email?: string; password?: string }
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!email || !password) return c.json({ error: 'Email and password are required' }, 400)

  const rows = await db.select().from(usersTbl).where(eq(usersTbl.email, email)).limit(1)
  const user = rows[0]
  // Always do bcrypt regardless of user existence so we don't leak which emails exist
  const ok = user
    ? await bcrypt.compare(password, user.passwordHash)
    : await bcrypt.compare(password, '$2a$10$invalidsaltinvalidsaltinvalidsaltinvalidsaltinval')

  if (!user || !ok) {
    writeAudit(c, { userEmail: email, action: 'login_failed', meta: { reason: 'bad_credentials' } })
    return c.json({ error: 'Incorrect email or password' }, 401)
  }

  if (user.totpEnabledAt) {
    const challengeId = newChallenge(user.id)
    return c.json({ requires2fa: true, challengeId })
  }

  return await completeLogin(c, user)
})

// Second leg of 2FA login. Accepts either a TOTP code or a recovery
// code. Recovery codes are bcrypt-hashed and stored comma-separated;
// a match consumes that hash (the user's code-list shrinks by one).
app.post('/login/2fa', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { challengeId?: string; code?: string }
  const challengeId = String(body.challengeId || '')
  const code = String(body.code || '').trim().replace(/\s/g, '')
  if (!challengeId || !code) return c.json({ error: 'challengeId and code are required' }, 400)

  const userId = consumeChallenge(challengeId)
  if (!userId) return c.json({ error: 'Challenge expired. Please sign in again.' }, 401)

  const rows = await db.select().from(usersTbl).where(eq(usersTbl.id, userId)).limit(1)
  const user = rows[0]
  if (!user || !user.totpSecret) return c.json({ error: 'Two-factor not configured' }, 401)

  // First try TOTP
  if (verifyTotp(user.totpSecret, code)) {
    return await completeLogin(c, user)
  }

  // Recovery code path — codes look like xxxx-xxxx; bcrypt hashes stored
  const stored = (user.recoveryCodes || '').split(',').filter(Boolean)
  for (let i = 0; i < stored.length; i++) {
    if (await bcrypt.compare(code.toLowerCase(), stored[i])) {
      const remaining = stored.slice(0, i).concat(stored.slice(i + 1))
      await db.update(usersTbl).set({ recoveryCodes: remaining.join(',') }).where(eq(usersTbl.id, user.id))
      writeAudit(c, { userId: user.id, userEmail: user.email, action: 'login_recovery_code_used', meta: { remaining: remaining.length } })
      return await completeLogin(c, user)
    }
  }

  writeAudit(c, { userId: user.id, userEmail: user.email, action: 'login_failed', meta: { reason: 'bad_2fa' } })
  // Re-issue the challenge so a typo doesn't force the user back to password — but only if there's time
  const newId = newChallenge(user.id)
  return c.json({ error: 'Incorrect code. Try again.', challengeId: newId }, 401)
})

// Logout — clears the cookie and revokes the current session row so
// the token is hard-invalidated even if it leaked.
app.post('/logout', async (c) => {
  const token = getCookie(c, AUTH_COOKIE) || ''
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { jti?: string }
      if (decoded.jti) {
        await db.update(sessionsTbl).set({ revokedAt: new Date() }).where(eq(sessionsTbl.jti, decoded.jti))
      }
    } catch { /* token already invalid — fine */ }
  }
  deleteCookie(c, AUTH_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

app.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId')!
  const rows = await db.select().from(usersTbl).where(eq(usersTbl.id, userId)).limit(1)
  const user = rows[0]
  if (!user) return c.json({ error: 'User not found' }, 404)
  return c.json({ user: {
    id: user.id, email: user.email, name: user.name, role: user.role,
    emailVerified: !!user.emailVerifiedAt,
    totpEnabled: !!user.totpEnabledAt,
    recoveryCodesRemaining: (user.recoveryCodes || '').split(',').filter(Boolean).length,
  } })
})

// Password change — current user only. Verifies the current password
// before accepting a new one; rejects new passwords shorter than 8 chars.
// Re-uses the JWT subject as the target user so a stolen token can't
// reset somebody else's password.
app.post('/password', authMiddleware, async (c) => {
  const userId = c.get('userId')!
  const body = await c.req.json().catch(() => ({})) as { currentPassword?: string; newPassword?: string }
  const current = String(body.currentPassword || '')
  const next = String(body.newPassword || '')
  if (!current || !next) return c.json({ error: 'currentPassword and newPassword are required' }, 400)
  const strength = validatePasswordStrength(next)
  if (!strength.ok) return c.json({ error: strength.reason }, 400)
  if (next === current) return c.json({ error: 'New password must differ from current password' }, 400)

  const rows = await db.select().from(usersTbl).where(eq(usersTbl.id, userId)).limit(1)
  const user = rows[0]
  if (!user) return c.json({ error: 'User not found' }, 404)

  const ok = await bcrypt.compare(current, user.passwordHash)
  if (!ok) return c.json({ error: 'Current password is incorrect' }, 401)

  const newHash = await bcrypt.hash(next, 10)
  // Revoke every other open session; re-mint the current one so we don't kick ourselves out
  const currentSessionId = c.get('sessionId') || null
  await db.update(usersTbl).set({ passwordHash: newHash, tokensInvalidatedAt: new Date() }).where(eq(usersTbl.id, userId))
  if (currentSessionId) {
    await db.update(sessionsTbl).set({ revokedAt: new Date() })
      .where(and(eq(sessionsTbl.userId, userId), isNull(sessionsTbl.revokedAt), not(eq(sessionsTbl.id, currentSessionId))))
  } else {
    await db.update(sessionsTbl).set({ revokedAt: new Date() })
      .where(and(eq(sessionsTbl.userId, userId), isNull(sessionsTbl.revokedAt)))
    const jti = crypto.randomBytes(16).toString('base64url')
    await db.insert(sessionsTbl).values({ userId, jti, ip: clientIp(c), userAgent: (c.req.header('User-Agent') || '').slice(0, 500) })
    setAuthCookie(c, signToken({ id: user.id, email: user.email, role: user.role }, jti))
  }
  writeAudit(c, { userId, userEmail: user.email, action: 'password_change' })
  return c.json({ ok: true })
})

// ─── Sessions ────────────────────────────────────────────────────────────

app.get('/sessions', authMiddleware, async (c) => {
  const userId = c.get('userId')!
  const currentSessionId = c.get('sessionId') || null
  const rows = await db.select().from(sessionsTbl)
    .where(and(eq(sessionsTbl.userId, userId), isNull(sessionsTbl.revokedAt)))
    .orderBy(desc(sessionsTbl.lastSeenAt))
  return c.json({
    sessions: rows.map(r => ({
      id: r.id, ip: r.ip, userAgent: r.userAgent,
      createdAt: r.createdAt, lastSeenAt: r.lastSeenAt,
      isCurrent: r.id === currentSessionId,
    })),
  })
})

app.post('/sessions/:id/revoke', authMiddleware, async (c) => {
  const userId = c.get('userId')!
  const sessionId = c.req.param('id')!
  const result = await db.update(sessionsTbl).set({ revokedAt: new Date() })
    .where(and(eq(sessionsTbl.id, sessionId), eq(sessionsTbl.userId, userId)))
    .returning({ id: sessionsTbl.id })
  if (result.length === 0) return c.json({ error: 'Session not found' }, 404)
  writeAudit(c, { userId, action: 'session_revoked', target: 'session/' + sessionId })
  return c.json({ ok: true })
})

// Revoke every other open session; re-mint the current.
app.post('/sessions/revoke-all', authMiddleware, async (c) => {
  const userId = c.get('userId')!
  const rows = await db.select().from(usersTbl).where(eq(usersTbl.id, userId)).limit(1)
  const user = rows[0]
  if (!user) return c.json({ error: 'User not found' }, 404)
  const currentSessionId = c.get('sessionId') || null
  if (currentSessionId) {
    await db.update(sessionsTbl).set({ revokedAt: new Date() })
      .where(and(eq(sessionsTbl.userId, userId), isNull(sessionsTbl.revokedAt), not(eq(sessionsTbl.id, currentSessionId))))
  } else {
    await db.update(sessionsTbl).set({ revokedAt: new Date() })
      .where(and(eq(sessionsTbl.userId, userId), isNull(sessionsTbl.revokedAt)))
    const jti = crypto.randomBytes(16).toString('base64url')
    await db.insert(sessionsTbl).values({ userId, jti, ip: clientIp(c), userAgent: (c.req.header('User-Agent') || '').slice(0, 500) })
    setAuthCookie(c, signToken({ id: user.id, email: user.email, role: user.role }, jti))
  }
  await db.update(usersTbl).set({ tokensInvalidatedAt: new Date() }).where(eq(usersTbl.id, userId))
  writeAudit(c, { userId: user.id, userEmail: user.email, action: 'sessions_revoked_all' })
  return c.json({ ok: true })
})

// ─── Password reset (public) ──────────────────────────────────────────────
// Public — no auth. We send the link to the user's email; the link
// carries a 32-byte random token. We store only its SHA-256 hash so a
// DB dump doesn't yield usable reset links. One-hour expiry, single-use.

app.post('/password/forgot', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { email?: string }
  const email = String(body.email || '').trim().toLowerCase()
  if (!email) return c.json({ error: 'Email is required' }, 400)

  const rows = await db.select().from(usersTbl).where(eq(usersTbl.email, email)).limit(1)
  const user = rows[0]

  if (user) {
    const token = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)
    await db.insert(userTokensTbl).values({
      userId: user.id, kind: 'password_reset', tokenHash: hashToken(token), expiresAt,
    })
    const origin = siteOrigin(c)
    const resetUrl = origin + '/admin/reset-password?token=' + encodeURIComponent(token)
    await sendPasswordResetEmail({ to: user.email, resetUrl }).catch((e) => console.warn('[reset] email send failed:', e?.message))
    writeAudit(c, { userId: user.id, userEmail: user.email, action: 'password_reset_requested' })
  }
  // Always respond identically so email-existence can't be probed
  return c.json({ ok: true, message: 'If that email is on file, a reset link has been sent.' })
})

app.post('/password/reset', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { token?: string; newPassword?: string }
  const token = String(body.token || '')
  const next = String(body.newPassword || '')
  if (!token || !next) return c.json({ error: 'token and newPassword are required' }, 400)
  const strength = validatePasswordStrength(next)
  if (!strength.ok) return c.json({ error: strength.reason }, 400)

  const tokenHash = hashToken(token)
  const rows = await db.select().from(userTokensTbl)
    .where(and(eq(userTokensTbl.kind, 'password_reset'), eq(userTokensTbl.tokenHash, tokenHash)))
    .limit(1)
  const row = rows[0]
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    return c.json({ error: 'This reset link is invalid or has expired.' }, 400)
  }

  const newHash = await bcrypt.hash(next, 10)
  await db.update(usersTbl).set({ passwordHash: newHash }).where(eq(usersTbl.id, row.userId))
  await db.update(userTokensTbl).set({ usedAt: new Date() }).where(eq(userTokensTbl.id, row.id))
  // Invalidate any other outstanding reset tokens for this user — once one is used the rest are stale
  await db.update(userTokensTbl).set({ usedAt: new Date() })
    .where(and(eq(userTokensTbl.userId, row.userId), eq(userTokensTbl.kind, 'password_reset'), not(eq(userTokensTbl.id, row.id))))

  const userRow = (await db.select().from(usersTbl).where(eq(usersTbl.id, row.userId)).limit(1))[0]
  if (userRow) writeAudit(c, { userId: userRow.id, userEmail: userRow.email, action: 'password_reset_completed' })
  return c.json({ ok: true })
})

// ─── Email verification ───────────────────────────────────────────────────

app.post('/verify-email/send', authMiddleware, async (c) => {
  const userId = c.get('userId')!
  const rows = await db.select().from(usersTbl).where(eq(usersTbl.id, userId)).limit(1)
  const user = rows[0]
  if (!user) return c.json({ error: 'User not found' }, 404)
  if (user.emailVerifiedAt) return c.json({ ok: true, alreadyVerified: true })
  const token = crypto.randomBytes(32).toString('base64url')
  await db.insert(userTokensTbl).values({
    userId: user.id, kind: 'email_verify', tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
  })
  const verifyUrl = siteOrigin(c) + '/admin/verify-email?token=' + encodeURIComponent(token)
  await sendEmailVerificationEmail({ to: user.email, verifyUrl }).catch(() => { /* non-fatal */ })
  return c.json({ ok: true })
})

app.post('/verify-email/confirm', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { token?: string }
  const token = String(body.token || '')
  if (!token) return c.json({ error: 'token is required' }, 400)
  const tokenHash = hashToken(token)
  const rows = await db.select().from(userTokensTbl)
    .where(and(eq(userTokensTbl.kind, 'email_verify'), eq(userTokensTbl.tokenHash, tokenHash)))
    .limit(1)
  const row = rows[0]
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    return c.json({ error: 'This verification link is invalid or has expired.' }, 400)
  }
  await db.update(usersTbl).set({ emailVerifiedAt: new Date() }).where(eq(usersTbl.id, row.userId))
  await db.update(userTokensTbl).set({ usedAt: new Date() }).where(eq(userTokensTbl.id, row.id))
  return c.json({ ok: true })
})

// ─── 2FA (TOTP) ───────────────────────────────────────────────────────────
// Three-step setup: GET /2fa/setup → returns a fresh secret + otpauth
// URI for the QR code. POST /2fa/enable with the first valid code locks
// it on and returns recovery codes (shown once). POST /2fa/disable
// requires the current password to turn it back off.

app.post('/2fa/setup', authMiddleware, async (c) => {
  const userId = c.get('userId')!
  const rows = await db.select().from(usersTbl).where(eq(usersTbl.id, userId)).limit(1)
  const user = rows[0]
  if (!user) return c.json({ error: 'User not found' }, 404)
  // Generate but don't persist as enabled — only the secret column.
  // If the user abandons setup, the secret sits unused until next attempt.
  const secret = generateSecret()
  await db.update(usersTbl).set({ totpSecret: secret, totpEnabledAt: null }).where(eq(usersTbl.id, user.id))
  const issuer = (process.env.COMPANY_NAME || 'Twomiah') + ' Admin'
  return c.json({
    secret,
    otpauthUri: otpauthUri({ secret, account: user.email, issuer }),
  })
})

app.post('/2fa/enable', authMiddleware, async (c) => {
  const userId = c.get('userId')!
  const body = await c.req.json().catch(() => ({})) as { code?: string }
  const code = String(body.code || '').trim()
  const rows = await db.select().from(usersTbl).where(eq(usersTbl.id, userId)).limit(1)
  const user = rows[0]
  if (!user || !user.totpSecret) return c.json({ error: 'Start setup before enabling' }, 400)
  if (!verifyTotp(user.totpSecret, code)) return c.json({ error: "Code didn't match. Check your authenticator and try again." }, 400)
  if (user.totpEnabledAt) return c.json({ ok: true, alreadyEnabled: true })

  const codes = generateRecoveryCodes(10)
  const hashes = await Promise.all(codes.map(c => bcrypt.hash(c, 10)))
  await db.update(usersTbl).set({
    totpEnabledAt: new Date(),
    recoveryCodes: hashes.join(','),
  }).where(eq(usersTbl.id, user.id))
  writeAudit(c, { userId: user.id, userEmail: user.email, action: '2fa_enabled' })
  return c.json({ ok: true, recoveryCodes: codes })
})

app.post('/2fa/disable', authMiddleware, async (c) => {
  const userId = c.get('userId')!
  const body = await c.req.json().catch(() => ({})) as { password?: string }
  const password = String(body.password || '')
  if (!password) return c.json({ error: 'password is required' }, 400)
  const rows = await db.select().from(usersTbl).where(eq(usersTbl.id, userId)).limit(1)
  const user = rows[0]
  if (!user) return c.json({ error: 'User not found' }, 404)
  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) return c.json({ error: 'Password is incorrect' }, 401)
  await db.update(usersTbl).set({
    totpEnabledAt: null, totpSecret: null, recoveryCodes: null,
  }).where(eq(usersTbl.id, user.id))
  writeAudit(c, { userId: user.id, userEmail: user.email, action: '2fa_disabled' })
  return c.json({ ok: true })
})

app.post('/2fa/recovery-codes/regenerate', authMiddleware, async (c) => {
  const userId = c.get('userId')!
  const body = await c.req.json().catch(() => ({})) as { password?: string }
  const password = String(body.password || '')
  const rows = await db.select().from(usersTbl).where(eq(usersTbl.id, userId)).limit(1)
  const user = rows[0]
  if (!user || !user.totpEnabledAt) return c.json({ error: 'Two-factor is not enabled' }, 400)
  if (!password || !(await bcrypt.compare(password, user.passwordHash))) {
    return c.json({ error: 'Password is incorrect' }, 401)
  }
  const codes = generateRecoveryCodes(10)
  const hashes = await Promise.all(codes.map(c => bcrypt.hash(c, 10)))
  await db.update(usersTbl).set({ recoveryCodes: hashes.join(',') }).where(eq(usersTbl.id, user.id))
  writeAudit(c, { userId: user.id, userEmail: user.email, action: '2fa_recovery_codes_regenerated' })
  return c.json({ ok: true, recoveryCodes: codes })
})

// ─── Users ────────────────────────────────────────────────────────────────
// Role-gated to 'admin'. Editors can still change their own password and
// name via /password and (TODO if we add it) /me PATCH; managing the user
// list is owner/admin only.

const VALID_ROLES = new Set(['admin', 'editor'])

async function requireAdmin(c: Context<{ Variables: AdminVars }>, next: () => Promise<void>) {
  const role = c.get('userRole')
  if (role !== 'admin') return c.json({ error: 'Admin role required' }, 403)
  await next()
}

app.get('/users', authMiddleware, requireAdmin, async (c) => {
  const rows = await db.select({
    id: usersTbl.id, email: usersTbl.email, name: usersTbl.name,
    role: usersTbl.role, lastLoginAt: usersTbl.lastLoginAt, createdAt: usersTbl.createdAt,
  }).from(usersTbl).orderBy(asc(usersTbl.createdAt))
  return c.json({ users: rows })
})

app.post('/users', authMiddleware, requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    email?: string; password?: string; name?: string; role?: string
  }
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const name = typeof body.name === 'string' ? body.name.trim() : null
  const role = body.role && VALID_ROLES.has(body.role) ? body.role : 'editor'

  if (!email || !password) return c.json({ error: 'Email and password are required' }, 400)
  const newUserStrength = validatePasswordStrength(password)
  if (!newUserStrength.ok) return c.json({ error: newUserStrength.reason }, 400)

  const existing = await db.select({ id: usersTbl.id }).from(usersTbl).where(eq(usersTbl.email, email)).limit(1)
  if (existing[0]) return c.json({ error: 'A user with that email already exists' }, 409)

  const passwordHash = await bcrypt.hash(password, 10)
  const [created] = await db.insert(usersTbl).values({
    email, passwordHash, name: name || null, role,
  }).returning({
    id: usersTbl.id, email: usersTbl.email, name: usersTbl.name,
    role: usersTbl.role, lastLoginAt: usersTbl.lastLoginAt, createdAt: usersTbl.createdAt,
  })
  return c.json({ user: created }, 201)
})

app.patch('/users/:id', authMiddleware, requireAdmin, async (c) => {
  const targetId = c.req.param('id')
  const selfId = c.get('userId')!
  const body = await c.req.json().catch(() => ({})) as { name?: string | null; role?: string }
  const patch: Record<string, any> = {}
  if (typeof body.name === 'string' || body.name === null) patch.name = body.name
  if (body.role !== undefined) {
    if (!VALID_ROLES.has(body.role)) return c.json({ error: 'Invalid role' }, 400)
    patch.role = body.role
  }
  if (Object.keys(patch).length === 0) return c.json({ error: 'No allowed fields in patch' }, 400)

  // Lockout protection: if the change demotes the *last* admin to a
  // non-admin role, refuse. Otherwise an owner could lock themselves
  // and everyone else out of the user-management UI.
  if (patch.role && patch.role !== 'admin') {
    const adminCount = await db.select({ id: usersTbl.id }).from(usersTbl).where(eq(usersTbl.role, 'admin'))
    const target = await db.select({ id: usersTbl.id, role: usersTbl.role }).from(usersTbl).where(eq(usersTbl.id, targetId)).limit(1)
    if (target[0]?.role === 'admin' && adminCount.length <= 1) {
      return c.json({ error: 'Refusing to demote the last admin — promote another user first.' }, 400)
    }
    if (target[0]?.id === selfId) {
      return c.json({ error: 'You can\'t demote yourself — ask another admin.' }, 400)
    }
  }

  const result = await db.update(usersTbl).set(patch).where(eq(usersTbl.id, targetId)).returning({
    id: usersTbl.id, email: usersTbl.email, name: usersTbl.name,
    role: usersTbl.role, lastLoginAt: usersTbl.lastLoginAt, createdAt: usersTbl.createdAt,
  })
  if (result.length === 0) return c.json({ error: 'User not found' }, 404)
  return c.json({ user: result[0] })
})

app.delete('/users/:id', authMiddleware, requireAdmin, async (c) => {
  const targetId = c.req.param('id')
  const selfId = c.get('userId')!
  if (targetId === selfId) return c.json({ error: 'You can\'t delete yourself.' }, 400)

  const target = await db.select({ id: usersTbl.id, role: usersTbl.role }).from(usersTbl).where(eq(usersTbl.id, targetId)).limit(1)
  if (!target[0]) return c.json({ error: 'User not found' }, 404)
  if (target[0].role === 'admin') {
    const otherAdmins = await db.select({ id: usersTbl.id }).from(usersTbl).where(and(eq(usersTbl.role, 'admin'), not(eq(usersTbl.id, targetId))))
    if (otherAdmins.length === 0) {
      return c.json({ error: 'Refusing to delete the last admin — promote another user first.' }, 400)
    }
  }

  await db.delete(usersTbl).where(eq(usersTbl.id, targetId))
  return c.json({ ok: true })
})

// ─── Pages ────────────────────────────────────────────────────────────────

app.get('/pages', authMiddleware, async (_c) => {
  const rows = await db.select().from(pagesTbl).orderBy(asc(pagesTbl.navOrder), asc(pagesTbl.title))
  return _c.json({
    pages: rows.map(r => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      isPublished: r.isPublished,
      navOrder: r.navOrder,
      updatedAt: r.updatedAt,
    })),
  })
})

app.get('/pages/:slug', authMiddleware, async (c) => {
  const slug = c.req.param('slug')
  const rows = await db.select().from(pagesTbl).where(eq(pagesTbl.slug, slug)).limit(1)
  const page = rows[0]
  if (!page) return c.json({ error: 'Page not found' }, 404)
  return c.json({ page })
})

// Slugs that collide with server routes (or are visually confusing). The
// premium server mounts /api/admin/*, the auth flow uses /login, and we
// reserve a handful of common slugs to keep URLs predictable.
const RESERVED_SLUGS = new Set([
  'api', 'admin', 'login', 'logout', 'auth', 'static', 'uploads',
  'assets', 'build', 'public', 'sitemap.xml', 'robots.txt',
])
// Single-segment slug only — the public renderer's /:slug route matches
// one path segment. Nested paths (service-areas/madison) would need both
// route changes in server-static.ts AND admin UI support; not in this pass.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

// Create a new page. Slug must be URL-safe and not reserved. Sections
// default to empty — the admin builds it up from there.
app.post('/pages', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const slug = String(body.slug || '').trim().toLowerCase()
  const title = String(body.title || '').trim()

  if (!slug) return c.json({ error: 'slug is required' }, 400)
  if (!title) return c.json({ error: 'title is required' }, 400)
  if (!SLUG_RE.test(slug)) {
    return c.json({ error: 'slug must be lowercase letters, numbers, and hyphens (e.g. "service-areas")' }, 400)
  }
  if (RESERVED_SLUGS.has(slug)) {
    return c.json({ error: `Slug "${slug}" is reserved` }, 400)
  }

  const existing = await db.select({ id: pagesTbl.id }).from(pagesTbl).where(eq(pagesTbl.slug, slug)).limit(1)
  if (existing[0]) return c.json({ error: 'A page with that slug already exists' }, 409)

  const sections = Array.isArray(body.sections) ? body.sections : []
  const isPublished = typeof body.isPublished === 'boolean' ? body.isPublished : true
  const navOrder = typeof body.navOrder === 'number' ? body.navOrder : 100
  const metaTitle = typeof body.metaTitle === 'string' ? body.metaTitle : null
  const metaDescription = typeof body.metaDescription === 'string' ? body.metaDescription : null

  const [created] = await db.insert(pagesTbl).values({
    slug, title, sections, isPublished, navOrder, metaTitle, metaDescription,
  }).returning()
  return c.json({ page: created }, 201)
})

// Delete a page. 'home' is essential to the site (template's root route
// reads from it), so we refuse rather than 404 the public homepage.
app.delete('/pages/:slug', authMiddleware, async (c) => {
  const slug = c.req.param('slug')
  if (slug === 'home') {
    return c.json({ error: 'The home page can\'t be deleted. Hide it via isPublished instead.' }, 400)
  }
  const result = await db.delete(pagesTbl).where(eq(pagesTbl.slug, slug)).returning({ id: pagesTbl.id })
  if (result.length === 0) return c.json({ error: 'Page not found' }, 404)
  return c.json({ ok: true })
})

app.patch('/pages/:slug', authMiddleware, async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>

  // Allow-list which fields can be patched. Sections gets the full JSON
  // array; per-section field editing happens client-side, server just
  // accepts the new array verbatim.
  const allowed: Record<string, any> = {}
  if (typeof body.title === 'string') allowed.title = body.title
  if (Array.isArray(body.sections)) allowed.sections = body.sections
  if (typeof body.metaTitle === 'string' || body.metaTitle === null) allowed.metaTitle = body.metaTitle
  if (typeof body.metaDescription === 'string' || body.metaDescription === null) allowed.metaDescription = body.metaDescription
  if (typeof body.isPublished === 'boolean') allowed.isPublished = body.isPublished
  if (typeof body.navOrder === 'number') allowed.navOrder = body.navOrder

  if (Object.keys(allowed).length === 0) return c.json({ error: 'No allowed fields in patch' }, 400)
  allowed.updatedAt = new Date()

  const result = await db.update(pagesTbl).set(allowed).where(eq(pagesTbl.slug, slug)).returning()
  if (result.length === 0) return c.json({ error: 'Page not found' }, 404)
  return c.json({ page: result[0] })
})

// ─── Settings ─────────────────────────────────────────────────────────────

const SETTINGS_FIELDS = [
  'companyName', 'tagline', 'phone', 'email', 'address',
  'seoTitle', 'seoDescription', 'contactCtaLabel',
  'primaryColor', 'secondaryColor', 'accentColor',
  'logoUrl', 'faviconUrl', 'nav',
] as const

app.get('/settings', authMiddleware, async (c) => {
  const rows = await db.select().from(settingsTbl).limit(1)
  return c.json({ settings: rows[0] || null })
})

app.patch('/settings', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const patch: Record<string, any> = {}
  for (const f of SETTINGS_FIELDS) {
    if (f in body) patch[f] = body[f]
  }
  if (Object.keys(patch).length === 0) return c.json({ error: 'No allowed fields in patch' }, 400)

  const existing = await db.select().from(settingsTbl).limit(1)
  patch.updatedAt = new Date()
  if (existing[0]) {
    const [updated] = await db.update(settingsTbl).set(patch).where(eq(settingsTbl.id, existing[0].id)).returning()
    return c.json({ settings: updated })
  }
  // First-ever PATCH — companyName is required when no row exists
  if (!patch.companyName) return c.json({ error: 'companyName is required on first save' }, 400)
  const [created] = await db.insert(settingsTbl).values(patch).returning()
  return c.json({ settings: created })
})

// ─── Leads ────────────────────────────────────────────────────────────────

app.get('/leads', authMiddleware, async (c) => {
  const status = c.req.query('status')
  const query = status
    ? db.select().from(leadsTbl).where(eq(leadsTbl.status, status)).orderBy(desc(leadsTbl.createdAt))
    : db.select().from(leadsTbl).orderBy(desc(leadsTbl.createdAt))
  const rows = await query
  return c.json({ leads: rows })
})

app.patch('/leads/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const patch: Record<string, any> = {}
  if (typeof body.status === 'string' && ['new', 'replied', 'closed', 'spam'].includes(body.status)) {
    patch.status = body.status
  }
  if (typeof body.notes === 'string' || body.notes === null) patch.notes = body.notes
  if (Object.keys(patch).length === 0) return c.json({ error: 'No allowed fields in patch' }, 400)
  const result = await db.update(leadsTbl).set(patch).where(eq(leadsTbl.id, id)).returning()
  if (result.length === 0) return c.json({ error: 'Lead not found' }, 404)
  return c.json({ lead: result[0] })
})

// ─── Photos ───────────────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
])
const MAX_IMAGE_BYTES = 8 * 1024 * 1024  // 8 MB

app.get('/photos', authMiddleware, async (c) => {
  const tag = c.req.query('tag')
  const query = tag
    ? db.select().from(photosTbl).where(eq(photosTbl.tag, tag)).orderBy(desc(photosTbl.createdAt))
    : db.select().from(photosTbl).orderBy(desc(photosTbl.createdAt))
  const rows = await query
  return c.json({ photos: rows })
})

app.post('/photos', authMiddleware, async (c) => {
  try {
    const body = await c.req.parseBody() as Record<string, any>
    const file = body.file as File | undefined
    const tag = typeof body.tag === 'string' ? body.tag : null
    const alt = typeof body.alt === 'string' ? body.alt : null

    if (!file || typeof file !== 'object' || typeof (file as any).arrayBuffer !== 'function') {
      return c.json({ error: 'File is required' }, 400)
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return c.json({ error: 'Image is too large (max 8 MB).' }, 400)
    }
    if (file.type && !ALLOWED_IMAGE_TYPES.has(file.type)) {
      return c.json({ error: 'Unsupported image type. Use JPG, PNG, WebP, or GIF.' }, 400)
    }

    const raw = Buffer.from(await file.arrayBuffer())

    // Normalize: re-encode to web-friendly format + extract dimensions.
    // Lossless conversion for PNG-with-alpha (kept as PNG); everything
    // else flattens to JPEG at q82 for reasonable file size.
    const meta = await sharp(raw).metadata()
    const width = meta.width || null
    const height = meta.height || null

    let processedBuffer: Buffer = raw
    let processedType = file.type || 'image/jpeg'
    const isAlphaPng = meta.format === 'png' && meta.hasAlpha
    if (!isAlphaPng) {
      processedBuffer = await sharp(raw).rotate().jpeg({ quality: 82, mozjpeg: true }).toBuffer()
      processedType = 'image/jpeg'
    }

    const upload = await uploadImage(processedBuffer, {
      filename: file.name || 'photo' + (isAlphaPng ? '.png' : '.jpg'),
      contentType: processedType,
    })

    const [row] = await db.insert(photosTbl).values({
      url: upload.url,
      storageKey: upload.storageKey,
      alt: alt || null,
      tag: tag || null,
      width: width || null,
      height: height || null,
      bytes: upload.bytes,
      contentType: upload.contentType,
    }).returning()

    return c.json({ photo: row })
  } catch (err: any) {
    console.error('[Photos] Upload failed:', err.message)
    return c.json({ error: err.message || 'Upload failed' }, 500)
  }
})

app.patch('/photos/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const patch: Record<string, any> = {}
  if (typeof body.tag === 'string' || body.tag === null) patch.tag = body.tag
  if (typeof body.alt === 'string' || body.alt === null) patch.alt = body.alt
  if (Object.keys(patch).length === 0) return c.json({ error: 'No allowed fields in patch' }, 400)
  const result = await db.update(photosTbl).set(patch).where(eq(photosTbl.id, id)).returning()
  if (result.length === 0) return c.json({ error: 'Photo not found' }, 404)
  return c.json({ photo: result[0] })
})

app.delete('/photos/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const rows = await db.select().from(photosTbl).where(eq(photosTbl.id, id)).limit(1)
  const photo = rows[0]
  if (!photo) return c.json({ error: 'Photo not found' }, 404)
  if (photo.storageKey) {
    await deleteImage(photo.storageKey).catch(() => { /* non-fatal */ })
  }
  await db.delete(photosTbl).where(eq(photosTbl.id, id))
  return c.json({ ok: true })
})

// ─── Blog posts ───────────────────────────────────────────────────────────
const POST_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?$/

app.get('/posts', authMiddleware, async (c) => {
  const rows = await db.select().from(postsTbl).orderBy(desc(postsTbl.createdAt))
  return c.json({
    posts: rows.map(r => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      excerpt: r.excerpt,
      status: r.status,
      coverImageUrl: r.coverImageUrl,
      publishedAt: r.publishedAt,
      updatedAt: r.updatedAt,
    })),
  })
})

app.get('/posts/:slug', authMiddleware, async (c) => {
  const slug = c.req.param('slug')!
  const rows = await db.select().from(postsTbl).where(eq(postsTbl.slug, slug)).limit(1)
  const post = rows[0]
  if (!post) return c.json({ error: 'Post not found' }, 404)
  return c.json({ post })
})

app.post('/posts', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const title = String(body.title || '').trim()
  const slug = String(body.slug || '').trim().toLowerCase()
  if (!title) return c.json({ error: 'title is required' }, 400)
  if (!slug || !POST_SLUG_RE.test(slug)) return c.json({ error: 'slug must be lowercase letters, numbers, and hyphens' }, 400)
  const existing = await db.select({ id: postsTbl.id }).from(postsTbl).where(eq(postsTbl.slug, slug)).limit(1)
  if (existing[0]) return c.json({ error: 'A post with that slug already exists' }, 409)
  const [created] = await db.insert(postsTbl).values({
    slug, title,
    excerpt: typeof body.excerpt === 'string' ? body.excerpt : null,
    body: typeof body.body === 'string' ? body.body : '',
    coverImageUrl: typeof body.coverImageUrl === 'string' ? body.coverImageUrl : null,
    status: body.status === 'published' ? 'published' : 'draft',
    publishedAt: body.status === 'published' ? new Date() : null,
  }).returning()
  return c.json({ post: created }, 201)
})

app.patch('/posts/:slug', authMiddleware, async (c) => {
  const slug = c.req.param('slug')!
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const patch: Record<string, any> = {}
  if (typeof body.title === 'string') patch.title = body.title
  if (typeof body.excerpt === 'string' || body.excerpt === null) patch.excerpt = body.excerpt
  if (typeof body.body === 'string') patch.body = body.body
  if (typeof body.coverImageUrl === 'string' || body.coverImageUrl === null) patch.coverImageUrl = body.coverImageUrl
  if (typeof body.metaTitle === 'string' || body.metaTitle === null) patch.metaTitle = body.metaTitle
  if (typeof body.metaDescription === 'string' || body.metaDescription === null) patch.metaDescription = body.metaDescription
  if (body.status === 'draft' || body.status === 'published') {
    patch.status = body.status
    if (body.status === 'published') {
      const existing = await db.select().from(postsTbl).where(eq(postsTbl.slug, slug)).limit(1)
      if (existing[0] && !existing[0].publishedAt) patch.publishedAt = new Date()
    }
  }
  if (Object.keys(patch).length === 0) return c.json({ error: 'No allowed fields in patch' }, 400)
  patch.updatedAt = new Date()
  const result = await db.update(postsTbl).set(patch).where(eq(postsTbl.slug, slug)).returning()
  if (result.length === 0) return c.json({ error: 'Post not found' }, 404)
  return c.json({ post: result[0] })
})

app.delete('/posts/:slug', authMiddleware, async (c) => {
  const slug = c.req.param('slug')!
  const result = await db.delete(postsTbl).where(eq(postsTbl.slug, slug)).returning({ id: postsTbl.id })
  if (result.length === 0) return c.json({ error: 'Post not found' }, 404)
  return c.json({ ok: true })
})

// ─── Audit log read (admin only) ─────────────────────────────────────────
app.get('/audit', authMiddleware, requireAdmin, async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10) || 100, 500)
  const rows = await db.select().from(auditLogTbl).orderBy(desc(auditLogTbl.createdAt)).limit(limit)
  return c.json({ entries: rows })
})

export default app
