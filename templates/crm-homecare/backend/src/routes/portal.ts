/**
 * Home Care Client Portal Routes
 *
 * Admin routes: manage portal access for clients
 * Portal routes: the client's (and their relatives') own view
 *
 * Who signs in: a client_portal_accounts row — one per PERSON, several per client
 * (the client and each relative), each with their own email, password, lockout
 * counter and invite/reset link. clientId is the authorisation scope; the account
 * email in the token says which person it is.
 *
 * The older direct link (clients.portal_token, /portal?token=…) still works: it is
 * redeemed once at /exchange for a session, and signable-document emails use it.
 */

import { Hono } from 'hono'
import crypto from 'crypto'

import jwt from 'jsonwebtoken'
import { eq, and, desc, sql, count } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import {
  clients,
  agencies,
  schedules,
  timeEntries,
  invoices,
  invoiceLineItems,
  clientAssignments,
  clientEmergencyContacts,
  authorizations,
  users,
  clientNotifications,
  portalMessageThreads,
  portalMessages,
  clientDocuments,
  auditLogs,
  clientPortalAccounts,
  clientNotificationPreferences,
  backgroundChecks,
} from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import emailService from '../services/email.ts'
import logger from '../services/logger.ts'
import type { Context, Next } from 'hono'

const app = new Hono()

// The numbers the portal's sign-in rules run on.
export const PORTAL_RULES = {
  maxFailedLogins: 5,               // the 5th wrong password locks the account…
  lockMinutes: 15,                  // …for 15 minutes
  inviteHours: 48,                  // an invite link lasts 48 hours
  resetHours: 1,                    // a forgot-password link lasts 1 hour
  sessionHours: 8,                  // a portal sign-in lasts 8 hours
  previewHours: 2,                  // an administrator's portal preview lasts 2 hours
  minPasswordLength: 8,
} as const

const frontendUrl = () => process.env.FRONTEND_URL || ''
const setupUrl = (token: string) => `${frontendUrl()}/portal/setup?token=${token}`
const EMAIL_RE = /^\S+@\S+\.\S+$/
const normEmail = (e: unknown) => String(e ?? '').trim().toLowerCase()
const newToken = () => crypto.randomBytes(32).toString('hex')

/** A send that only printed to the console (no provider configured) did not reach anybody. */
async function delivered(send: Promise<{ success: boolean; dev?: boolean }>): Promise<{ sent: boolean; error: string | null }> {
  try {
    const r = await send
    if (r?.dev) return { sent: false, error: 'No email provider is configured for this agency' }
    return { sent: !!r?.success, error: r?.success ? null : 'Email send failed' }
  } catch (err) {
    return { sent: false, error: (err as Error)?.message || 'Email send failed' }
  }
}

// Ensure the client's direct-link credential (clients.portal_token) exists and
// is live. Signable-document emails carry this link, so a client whose portal
// is switched on must have one.
async function ensureClientLink(clientId: string, existing: { portalToken: string | null; portalTokenExp: Date | null }) {
  const live = existing.portalToken && (!existing.portalTokenExp || new Date(existing.portalTokenExp) > new Date())
  const set: Record<string, unknown> = { portalEnabled: true, updatedAt: new Date() }
  if (!live) {
    set.portalToken = newToken()
    set.portalTokenExp = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
  }
  await db.update(clients).set(set as any).where(eq(clients.id, clientId))
}

// =============================================
// ADMIN ROUTES (require staff auth)
// =============================================

// Enable portal for a client
app.post('/contacts/:clientId/enable', authenticate, requireAdmin, async (c) => {
  const clientId = c.req.param('clientId')

  const [foundClient] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)

  if (!foundClient) {
    return c.json({ error: 'Client not found' }, 404)
  }

  const email = foundClient.portalEmail || foundClient.email
  if (!email) {
    return c.json({ error: 'Client must have an email (or portal email) to enable portal access' }, 400)
  }

  // Generate token (valid for 90 days)
  const portalToken = crypto.randomBytes(32).toString('hex')
  const portalTokenExp = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)

  await db
    .update(clients)
    .set({
      portalEnabled: true,
      portalToken,
      portalTokenExp,
      portalEmail: email,
      updatedAt: new Date(),
    } as any)
    .where(eq(clients.id, clientId))

  const portalUrl = `${process.env.FRONTEND_URL || ''}/portal?token=${portalToken}`

  return c.json({
    success: true,
    portalUrl,
    expiresAt: portalTokenExp,
  })
})

// Disable portal for a client — every way in: the direct link AND every person's login.
app.post('/contacts/:clientId/disable', authenticate, requireAdmin, async (c) => {
  const clientId = c.req.param('clientId')

  await db
    .update(clients)
    .set({
      portalEnabled: false,
      portalToken: null,
      portalTokenExp: null,
      updatedAt: new Date(),
    } as any)
    .where(eq(clients.id, clientId))
  await db
    .update(clientPortalAccounts)
    .set({ portalEnabled: false, updatedAt: new Date() })
    .where(eq(clientPortalAccounts.clientId, clientId))

  return c.json({ success: true })
})

// Regenerate portal token
app.post('/contacts/:clientId/regenerate', authenticate, requireAdmin, async (c) => {
  const clientId = c.req.param('clientId')

  const [foundClient] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)

  if (!foundClient) {
    return c.json({ error: 'Client not found' }, 404)
  }

  const portalToken = crypto.randomBytes(32).toString('hex')
  const portalTokenExp = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)

  await db
    .update(clients)
    .set({
      portalToken,
      portalTokenExp,
      updatedAt: new Date(),
    } as any)
    .where(eq(clients.id, clientId))

  const portalUrl = `${process.env.FRONTEND_URL || ''}/portal?token=${portalToken}`

  return c.json({
    success: true,
    portalUrl,
    expiresAt: portalTokenExp,
  })
})

// Send portal invite email
app.post('/contacts/:clientId/send-link', authenticate, requireAdmin, async (c) => {
  const clientId = c.req.param('clientId')

  const [foundClient] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)

  if (!foundClient) {
    return c.json({ error: 'Client not found' }, 404)
  }

  const email = foundClient.portalEmail || foundClient.email
  if (!email) {
    return c.json({ error: 'Client has no email address' }, 400)
  }

  if (!foundClient.portalEnabled || !foundClient.portalToken) {
    return c.json({ error: 'Portal access not enabled for this client' }, 400)
  }

  // Get agency info
  const [agency] = await db.select().from(agencies).limit(1)

  const portalUrl = `${process.env.FRONTEND_URL || ''}/portal?token=${foundClient.portalToken}`

  await emailService.sendPortalInvite(email, {
    contactName: `${foundClient.firstName} ${foundClient.lastName}`,
    companyName: agency?.name || '{{COMPANY_NAME}}',
    portalUrl,
  })

  return c.json({ success: true, sentTo: email })
})

// Get portal status for a client. Admin only: the answer carries the direct
// link, which opens the portal as this client.
app.get('/contacts/:clientId/status', authenticate, requireAdmin, async (c) => {
  const clientId = c.req.param('clientId')

  const [foundClient] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)

  if (!foundClient) {
    return c.json({ error: 'Client not found' }, 404)
  }

  return c.json({
    enabled: foundClient.portalEnabled,
    hasToken: !!foundClient.portalToken,
    expiresAt: foundClient.portalTokenExp,
    lastVisit: foundClient.lastPortalVisit,
    portalEmail: foundClient.portalEmail,
    portalUrl: foundClient.portalToken
      ? `${process.env.FRONTEND_URL || ''}/portal?token=${foundClient.portalToken}`
      : null,
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: INVITE PEOPLE TO A CLIENT'S PORTAL
// POST /api/portal/admin/invite
// Body: { clientId, invitees: [{ email, name }] }  (or the older single { clientId, email, name })
//
// Each email becomes its OWN login. Sending to an email that already has a login
// for this client regenerates its 48-hour link (lost invite, forgotten password);
// the old link stops working. An email already used for a DIFFERENT client is
// refused: the email is the login key.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/admin/invite', authenticate, requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({} as any))
  const { clientId, email, name } = body || {}
  const invitees: Array<{ email?: unknown; name?: unknown }> =
    Array.isArray(body?.invitees) && body.invitees.length ? body.invitees : (email ? [{ email, name }] : [])
  if (!clientId || invitees.length === 0) {
    return c.json({ error: 'clientId and at least one email are required' }, 400)
  }
  for (const inv of invitees) {
    if (!inv?.email || !EMAIL_RE.test(String(inv.email).trim())) {
      return c.json({ error: `Invalid email address: ${inv?.email || '(blank)'}` }, 400)
    }
  }

  const [foundClient] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, String(clientId)), eq(clients.isActive, true)))
    .limit(1)
  if (!foundClient) {
    return c.json({ error: 'Client not found or inactive' }, 404)
  }

  const clientName = `${foundClient.firstName} ${foundClient.lastName}`
  const [agency] = await db.select().from(agencies).limit(1)
  const results: any[] = []

  for (const inv of invitees) {
    const invEmail = normEmail(inv.email)
    const invName = inv.name ? String(inv.name).trim() || null : null

    const [existing] = await db
      .select({ id: clientPortalAccounts.id, clientId: clientPortalAccounts.clientId })
      .from(clientPortalAccounts)
      .where(eq(clientPortalAccounts.email, invEmail))
      .limit(1)
    if (existing && existing.clientId !== foundClient.id) {
      results.push({ email: invEmail, error: 'This email already has a portal account for a different client.' })
      continue
    }

    const inviteToken = newToken()
    const inviteExpiresAt = new Date(Date.now() + PORTAL_RULES.inviteHours * 60 * 60 * 1000)

    if (existing) {
      await db.update(clientPortalAccounts).set({
        ...(invName ? { displayName: invName } : {}),
        inviteToken,
        inviteExpiresAt,
        updatedAt: new Date(),
      }).where(eq(clientPortalAccounts.id, existing.id))
    } else {
      await db.insert(clientPortalAccounts).values({
        clientId: foundClient.id,
        email: invEmail,
        displayName: invName,
        inviteToken,
        inviteExpiresAt,
        portalEnabled: false, // switched on when they set a password
      })
    }

    const inviteUrl = setupUrl(inviteToken)
    // The record stands even if the email cannot go out: the office can copy the link.
    const mail = await delivered(emailService.sendPortalSetupInvite(invEmail, {
      contactName: invName || clientName,
      clientName,
      companyName: agency?.name || '{{COMPANY_NAME}}',
      setupUrl: inviteUrl,
    }))
    results.push({ email: invEmail, name: invName, inviteUrl, emailSent: mail.sent, emailError: mail.error, expiresAt: inviteExpiresAt })
  }

  const ok = results.filter((r) => !r.error)
  const failed = results.filter((r) => r.error)

  // Inviting someone turns the client's portal on, which includes the direct link
  // that signable-document emails carry.
  if (ok.length) {
    await ensureClientLink(foundClient.id, foundClient)
    if (!foundClient.portalEmail) {
      await db.update(clients).set({ portalEmail: ok[0].email, updatedAt: new Date() } as any).where(eq(clients.id, foundClient.id))
    }
  }

  return c.json({
    success: ok.length > 0,
    results,
    // The single-invite shape older screens read
    inviteUrl: ok[0]?.inviteUrl || null,
    emailSent: ok.length > 0 && ok.every((r) => r.emailSent),
    emailError: ok.find((r) => r.emailError)?.emailError || null,
    message: [
      ok.length ? `Invites created for ${ok.map((r) => r.email).join(', ')} (${clientName}).` : null,
      ok.some((r) => !r.emailSent) ? 'Some emails could not be sent — share those links manually.' : null,
      failed.length ? `Skipped: ${failed.map((r) => `${r.email} (${r.error})`).join('; ')}` : null,
    ].filter(Boolean).join(' '),
  })
})

// What one login's state is, in the words the screen shows.
const accountStatusSql = sql<string>`CASE
  WHEN ${clientPortalAccounts.inviteToken} IS NOT NULL AND ${clientPortalAccounts.inviteExpiresAt} > now() THEN 'invite_pending'
  WHEN ${clientPortalAccounts.inviteToken} IS NOT NULL AND (${clientPortalAccounts.inviteExpiresAt} IS NULL OR ${clientPortalAccounts.inviteExpiresAt} <= now()) THEN 'invite_expired'
  WHEN ${clientPortalAccounts.portalEnabled} = true THEN 'active'
  ELSE 'disabled' END`

// ADMIN: every login on one client's portal (one row per person)
app.get('/admin/clients/:clientId/accounts', authenticate, requireAdmin, async (c) => {
  const rows = await db
    .select({
      id: clientPortalAccounts.id,
      email: clientPortalAccounts.email,
      displayName: clientPortalAccounts.displayName,
      portalEnabled: clientPortalAccounts.portalEnabled,
      lastLogin: clientPortalAccounts.lastLogin,
      lockedUntil: clientPortalAccounts.lockedUntil,
      status: accountStatusSql,
    })
    .from(clientPortalAccounts)
    .where(eq(clientPortalAccounts.clientId, c.req.param('clientId')))
    .orderBy(clientPortalAccounts.createdAt)
  return c.json(rows)
})

// ADMIN: take ONE person's access away; the client's other logins are untouched
app.delete('/admin/accounts/:accountId', authenticate, requireAdmin, async (c) => {
  const rows = await db
    .delete(clientPortalAccounts)
    .where(eq(clientPortalAccounts.id, c.req.param('accountId')))
    .returning({ email: clientPortalAccounts.email })
  if (!rows.length) return c.json({ error: 'Account not found' }, 404)
  return c.json({ success: true, removed: rows[0].email })
})

// ADMIN: switch a client's whole portal on or off — every login and the direct link
app.put('/admin/clients/:clientId/toggle', authenticate, requireAdmin, async (c) => {
  const clientId = c.req.param('clientId')
  const { enabled } = await c.req.json().catch(() => ({} as any))
  if (typeof enabled !== 'boolean') return c.json({ error: 'enabled must be true or false' }, 400)

  await db
    .update(clientPortalAccounts)
    .set({ portalEnabled: enabled, updatedAt: new Date() })
    .where(eq(clientPortalAccounts.clientId, clientId))
  await db
    .update(clients)
    .set({ portalEnabled: enabled, updatedAt: new Date() } as any)
    .where(eq(clients.id, clientId))

  return c.json({ success: true })
})

// ADMIN: portal status for every active client
app.get('/admin/clients', authenticate, requireAdmin, async (c) => {
  const result: any = await db.execute(sql`
    SELECT
      c.id, c.first_name, c.last_name, c.phone, c.email, c.is_active,
      agg.portal_enabled,
      agg.portal_email,
      agg.last_login,
      agg.invite_expires_at,
      COALESCE(agg.account_count, 0)::int AS account_count,
      COALESCE(agg.portal_status, 'not_invited') AS portal_status
    FROM clients c
    LEFT JOIN LATERAL (
      SELECT
        bool_or(cpa.portal_enabled)                          AS portal_enabled,
        string_agg(cpa.email, ', ' ORDER BY cpa.created_at)  AS portal_email,
        MAX(cpa.last_login)                                  AS last_login,
        MAX(cpa.invite_expires_at)                           AS invite_expires_at,
        COUNT(*)                                             AS account_count,
        CASE
          WHEN bool_or(cpa.portal_enabled) THEN 'active'
          WHEN bool_or(cpa.invite_token IS NOT NULL AND cpa.invite_expires_at > now()) THEN 'invite_pending'
          WHEN bool_or(cpa.invite_token IS NOT NULL) THEN 'invite_expired'
          ELSE 'disabled'
        END AS portal_status
      FROM client_portal_accounts cpa
      WHERE cpa.client_id = c.id
      HAVING COUNT(*) > 0
    ) agg ON true
    WHERE c.is_active = true
    ORDER BY c.last_name, c.first_name
  `)
  return c.json(result.rows ?? result)
})

// ADMIN: put a notification in a client's portal
app.post('/admin/notify', authenticate, requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({} as any))
  const { clientId, type, title, message, relatedVisitId, relatedInvoiceId, relatedCaregiverId } = body || {}
  if (!clientId || !type || !title) {
    return c.json({ error: 'clientId, type, and title are required' }, 400)
  }
  const [found] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, String(clientId))).limit(1)
  if (!found) return c.json({ error: 'Client not found' }, 404)

  const [row] = await db.insert(clientNotifications).values({
    clientId: found.id,
    type: String(type),
    title: String(title),
    message: message ? String(message) : null,
    relatedVisitId: relatedVisitId ? String(relatedVisitId) : null,
    relatedInvoiceId: relatedInvoiceId ? String(relatedInvoiceId) : null,
    relatedCaregiverId: relatedCaregiverId ? String(relatedCaregiverId) : null,
  }).returning()
  return c.json(row, 201)
})

// ADMIN: see a client's portal exactly as they do ("View As" → Client Portal).
// A short-lived token marked as a preview. It is READ-ONLY: portalAuth refuses
// every write made with it, so an administrator cannot sign a document, send a
// message or pay as the client.
app.post('/admin/preview/:clientId', authenticate, requireAdmin, async (c) => {
  const user = c.get('user') as any
  const [found] = await db.select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName })
    .from(clients).where(eq(clients.id, c.req.param('clientId'))).limit(1)
  if (!found) return c.json({ error: 'Client not found' }, 404)

  try {
    await db.insert(auditLogs).values({
      userId: user.userId,
      action: 'ADMIN_IMPERSONATE_PORTAL',
      tableName: 'clients',
      recordId: found.id,
      newData: { impersonating: `${found.firstName} ${found.lastName}`, impersonatedBy: user.email } as any,
    } as any)
  } catch (err) {
    logger.error('[portal] audit write failed for portal preview', { error: (err as Error).message })
  }

  const token = jwt.sign(
    { role: 'client', clientId: found.id, firstName: found.firstName, lastName: found.lastName, impersonatedBy: user.email, impersonation: true },
    process.env.JWT_SECRET!,
    { expiresIn: `${PORTAL_RULES.previewHours}h` },
  )
  return c.json({
    token,
    user: { id: found.id, name: `${found.firstName} ${found.lastName}`, role: 'client', impersonatedBy: user.email, firstName: found.firstName, lastName: found.lastName },
  })
})

// =============================================
// PORTAL AUTH: Login with email + password
// =============================================

app.post('/login', async (c) => {
  const { email, password } = await c.req.json().catch(() => ({} as any))

  if (!email || !password) {
    return c.json({ error: 'Email and password are required' }, 400)
  }

  const [found] = await db
    .select({ account: clientPortalAccounts, client: clients })
    .from(clientPortalAccounts)
    .innerJoin(clients, eq(clientPortalAccounts.clientId, clients.id))
    .where(and(
      eq(clientPortalAccounts.email, normEmail(email)),
      eq(clientPortalAccounts.portalEnabled, true),
      eq(clients.isActive, true),
    ))
    .limit(1)

  if (!found) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }
  const { account, client } = found

  if (account.lockedUntil && new Date(account.lockedUntil) > new Date()) {
    return c.json({ error: 'Account temporarily locked. Please try again later.' }, 423)
  }

  if (!account.passwordHash) {
    return c.json({ error: 'Account setup not complete. Please check your invite email.' }, 401)
  }

  const valid = await Bun.password.verify(String(password), account.passwordHash)
  if (!valid) {
    // THIS person's counter only — a client can have several logins and one
    // relative's typos must not lock the others out.
    const failCount = (account.failedLoginCount || 0) + 1
    const lockedUntil = failCount >= PORTAL_RULES.maxFailedLogins
      ? new Date(Date.now() + PORTAL_RULES.lockMinutes * 60 * 1000)
      : null
    await db.update(clientPortalAccounts)
      .set({ failedLoginCount: failCount, lockedUntil, updatedAt: new Date() })
      .where(eq(clientPortalAccounts.id, account.id))
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  await db.update(clientPortalAccounts)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLogin: new Date(), updatedAt: new Date() })
    .where(eq(clientPortalAccounts.id, account.id))
  await db.update(clients)
    .set({ lastPortalVisit: new Date(), updatedAt: new Date() } as any)
    .where(eq(clients.id, client.id))

  // accountEmail says WHICH person is signed in; clientId is what they may see.
  const token = jwt.sign(
    { role: 'client', clientId: client.id, accountEmail: account.email, firstName: client.firstName, lastName: client.lastName },
    process.env.JWT_SECRET!,
    { expiresIn: `${PORTAL_RULES.sessionHours}h` },
  )

  return c.json({
    token,
    client: {
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      email: account.email,
    },
  })
})

// Exchange an emailed portal link token for a client session.
//
// The link in a portal invite carries the database token from
// clients.portalToken, not a JWT. The SPA speaks JWT everywhere else, so
// rather than teach every call two auth shapes, the link is redeemed once
// here for the same token /login issues.
app.post('/exchange', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const linkToken = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!linkToken) return c.json({ error: 'Missing link token' }, 400)

  const [foundClient] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.portalToken, linkToken), eq(clients.portalEnabled, true), eq(clients.isActive, true)))
    .limit(1)

  // Deliberately the same message for "no such token" and "portal disabled":
  // a link that does not work should not report which.
  if (!foundClient) {
    return c.json({ error: 'This link is no longer valid. Please contact your care coordinator.' }, 401)
  }
  if (foundClient.portalTokenExp && new Date() > new Date(foundClient.portalTokenExp)) {
    return c.json({ error: 'This link has expired. Please contact your care coordinator.' }, 401)
  }

  await db
    .update(clients)
    .set({ lastPortalVisit: new Date(), updatedAt: new Date() } as any)
    .where(eq(clients.id, foundClient.id))

  const token = jwt.sign(
    {
      clientId: foundClient.id,
      role: 'client',
      firstName: foundClient.firstName,
      lastName: foundClient.lastName,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '30d' },
  )

  return c.json({
    token,
    client: { id: foundClient.id, firstName: foundClient.firstName, lastName: foundClient.lastName },
  })
})

// Accept an invite (or a reset link) and set the password.
app.post('/set-password', async (c) => {
  const { token, password } = await c.req.json().catch(() => ({} as any))

  if (!token || !password) {
    return c.json({ error: 'Token and password are required' }, 400)
  }

  if (String(password).length < PORTAL_RULES.minPasswordLength) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }

  const [account] = await db
    .select({ id: clientPortalAccounts.id })
    .from(clientPortalAccounts)
    .where(and(
      eq(clientPortalAccounts.inviteToken, String(token)),
      sql`${clientPortalAccounts.inviteExpiresAt} > now()`,
    ))
    .limit(1)

  if (!account) {
    return c.json({ error: 'Invalid or expired invite link. Please contact your care coordinator.' }, 400)
  }

  const passwordHash = await Bun.password.hash(String(password), 'bcrypt')

  // The link is single-use. Proving you hold the email also clears a lockout.
  await db
    .update(clientPortalAccounts)
    .set({
      passwordHash,
      inviteToken: null,
      inviteExpiresAt: null,
      portalEnabled: true,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(clientPortalAccounts.id, account.id))

  return c.json({ success: true, message: 'Password set. You can now log in.' })
})

// Forgot password (self-service). Reuses the invite token and /portal/setup with a
// 1-hour link. Always the same answer, so nobody can find out whose email has an
// account by asking. Rate limited in index.ts.
app.post('/forgot-password', async (c) => {
  const { email } = await c.req.json().catch(() => ({} as any))
  if (!email) return c.json({ error: 'Email is required' }, 400)

  const generic = {
    success: true,
    message: 'If an account exists with that email, a password reset link has been sent. Please check your inbox.',
  }

  const [found] = await db
    .select({ id: clientPortalAccounts.id, email: clientPortalAccounts.email, displayName: clientPortalAccounts.displayName, firstName: clients.firstName, lastName: clients.lastName })
    .from(clientPortalAccounts)
    .innerJoin(clients, eq(clientPortalAccounts.clientId, clients.id))
    .where(and(
      eq(clientPortalAccounts.email, normEmail(email)),
      eq(clientPortalAccounts.portalEnabled, true),
      eq(clients.isActive, true),
    ))
    .limit(1)
  if (!found) return c.json(generic)

  const resetToken = newToken()
  await db.update(clientPortalAccounts)
    .set({ inviteToken: resetToken, inviteExpiresAt: new Date(Date.now() + PORTAL_RULES.resetHours * 60 * 60 * 1000), updatedAt: new Date() })
    .where(eq(clientPortalAccounts.id, found.id))

  const [agency] = await db.select().from(agencies).limit(1)
  const mail = await delivered(emailService.sendClientPortalPasswordReset(found.email, {
    contactName: found.displayName || `${found.firstName} ${found.lastName}`,
    companyName: agency?.name || '{{COMPANY_NAME}}',
    resetUrl: setupUrl(resetToken),
  }))
  if (!mail.sent) logger.warn('[portal] forgot-password email not sent', { error: mail.error })

  return c.json(generic)
})

// Generate portal access link (legacy compatibility). Admin only: the link opens
// the portal as the client.
app.post('/generate-link', authenticate, requireAdmin, async (c) => {
  const { clientId } = await c.req.json().catch(() => ({} as any))
  if (!clientId) return c.json({ error: 'clientId is required' }, 400)

  const portalToken = crypto.randomBytes(32).toString('hex')
  const portalTokenExp = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)

  const rows = await db
    .update(clients)
    .set({
      portalEnabled: true,
      portalToken,
      portalTokenExp,
      updatedAt: new Date(),
    } as any)
    .where(eq(clients.id, String(clientId)))
    .returning({ id: clients.id })
  if (!rows.length) return c.json({ error: 'Client not found' }, 404)

  const url = `${process.env.FRONTEND_URL || ''}/portal?token=${portalToken}`
  return c.json({ token: portalToken, url })
})

// =============================================
// PORTAL MIDDLEWARE: Validate token from header or JWT
// =============================================

async function portalAuth(c: Context, next: Next) {
  // Try x-portal-token header first (DB-stored token)
  const headerToken = c.req.header('x-portal-token')

  // Try Authorization header (JWT from login)
  const authHeader = c.req.header('authorization')
  const bearerToken = authHeader?.split(' ')[1]

  if (headerToken) {
    // DB-stored token auth
    const [foundClient] = await db
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.portalToken, headerToken),
          eq(clients.portalEnabled, true),
          eq(clients.isActive, true),
        )
      )
      .limit(1)

    if (!foundClient) {
      return c.json({ error: 'Invalid or expired portal link' }, 401)
    }

    if (foundClient.portalTokenExp && new Date() > new Date(foundClient.portalTokenExp)) {
      return c.json({ error: 'Portal link has expired. Please contact your care coordinator.' }, 401)
    }

    // Update last visit
    await db
      .update(clients)
      .set({ lastPortalVisit: new Date(), updatedAt: new Date() } as any)
      .where(eq(clients.id, foundClient.id))

    c.set('portalClientId', foundClient.id)
    c.set('portalClient', foundClient)
    await next()
    return
  }

  if (!bearerToken) return c.json({ error: 'Portal authentication required' }, 401)

  let decoded: any
  try {
    decoded = jwt.verify(bearerToken, process.env.JWT_SECRET!) as any
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
  if (decoded.role !== 'client' || !decoded.clientId) {
    return c.json({ error: 'Client access required' }, 403)
  }

  // An administrator's preview: the client must exist, and nothing may be changed.
  if (decoded.impersonation) {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      return c.json({ error: 'Portal preview is read-only' }, 403)
    }
    const [foundClient] = await db.select().from(clients).where(eq(clients.id, decoded.clientId)).limit(1)
    if (!foundClient) return c.json({ error: 'Client not found' }, 403)
    c.set('portalClientId', foundClient.id)
    c.set('portalClient', foundClient)
    c.set('portalPreview', true)
    await next()
    return
  }

  const [foundClient] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, decoded.clientId), eq(clients.isActive, true)))
    .limit(1)
  if (!foundClient) return c.json({ error: 'Portal access revoked or client inactive' }, 403)

  if (decoded.accountEmail) {
    // Signed in with a password: THAT person's login must still be on. Removing one
    // relative ends their access without waiting for the token to run out.
    const [account] = await db
      .select({ id: clientPortalAccounts.id, email: clientPortalAccounts.email, displayName: clientPortalAccounts.displayName, lastLogin: clientPortalAccounts.lastLogin })
      .from(clientPortalAccounts)
      .where(and(
        eq(clientPortalAccounts.clientId, foundClient.id),
        eq(clientPortalAccounts.email, normEmail(decoded.accountEmail)),
        eq(clientPortalAccounts.portalEnabled, true),
      ))
      .limit(1)
    if (!account) return c.json({ error: 'Portal access revoked or client inactive' }, 403)
    c.set('portalAccount', account)
  } else if (!foundClient.portalEnabled) {
    // Signed in through the direct link: the client's portal switch is that link's gate.
    return c.json({ error: 'Portal access disabled' }, 401)
  }

  // Update last visit
  await db
    .update(clients)
    .set({ lastPortalVisit: new Date(), updatedAt: new Date() } as any)
    .where(eq(clients.id, foundClient.id))

  c.set('portalClientId', foundClient.id)
  c.set('portalClient', foundClient)
  await next()
}

// =============================================
// PORTAL ROUTES: Token-based URL pattern
// =============================================

// Portal home: client profile + summary
app.get('/me', portalAuth, async (c) => {
  const client = c.get('portalClient') as any
  const account = c.get('portalAccount') as any
  const clientId = client.id

  // Visit count
  const [visitResult] = await db
    .select({ value: count() })
    .from(timeEntries)
    .where(and(eq(timeEntries.clientId, clientId), eq(timeEntries.isComplete, true)))

  // Upcoming visits
  const [upcomingResult] = await db
    .select({ value: count() })
    .from(schedules)
    .where(and(eq(schedules.clientId, clientId), eq(schedules.isActive, true)))

  // Outstanding balance
  const [balanceResult] = await db
    .select({ total: sql<string>`COALESCE(SUM(${invoices.total}), 0)` })
    .from(invoices)
    .where(
      and(
        eq(invoices.clientId, clientId),
        sql`${invoices.paymentStatus} IN ('pending', 'overdue')`
      )
    )

  // Unread notifications
  const [unreadResult] = await db
    .select({ value: count() })
    .from(clientNotifications)
    .where(and(eq(clientNotifications.clientId, clientId), eq(clientNotifications.isRead, false)))

  // Unread messages
  const unreadThreads = await db
    .select()
    .from(portalMessageThreads)
    .where(
      and(
        eq(portalMessageThreads.clientId, clientId),
        eq(portalMessageThreads.status, 'open'),
      )
    )

  const unreadMessageCount = unreadThreads.filter(t => {
    if (!t.clientLastReadAt) return true
    return new Date(t.lastMessageAt) > new Date(t.clientLastReadAt)
  }).length

  const [agency] = await db.select({ name: agencies.name, state: agencies.state, phone: agencies.phone }).from(agencies).limit(1)

  return c.json({
    id: client.id,
    first_name: client.firstName,
    last_name: client.lastName,
    date_of_birth: client.dateOfBirth,
    email: client.email,
    phone: client.phone,
    address: client.address,
    city: client.city,
    state: client.state,
    zip: client.zip,
    service_type: client.serviceType,
    start_date: client.startDate,
    // Which person is signed in (null for the direct link and for a preview)
    portal_email: account?.email || client.portalEmail || null,
    display_name: account?.displayName || null,
    last_login: account?.lastLogin || null,
    preview: !!c.get('portalPreview'),
    agency_name: agency?.name || null,
    agency_state: agency?.state || null,
    agency_phone: agency?.phone || null,
    summary: {
      totalVisits: visitResult.value,
      upcomingSchedules: upcomingResult.value,
      outstandingBalance: Number(balanceResult?.total || 0),
      unreadNotifications: unreadResult.value,
      unreadMessages: unreadMessageCount,
    },
  })
})

// The client's own notification switches. Each is a boolean; anything else for a
// key leaves it as it was.
app.put('/preferences', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const body = await c.req.json().catch(() => ({} as any))
  const keys = ['emailEnabled', 'portalEnabled', 'caregiverAlerts', 'scheduleAlerts', 'billingAlerts', 'assignmentAlerts'] as const
  const patch: Record<string, boolean> = {}
  for (const k of keys) if (typeof body?.[k] === 'boolean') patch[k] = body[k]

  await db.insert(clientNotificationPreferences)
    .values({ clientId, ...patch })
    .onConflictDoUpdate({ target: clientNotificationPreferences.clientId, set: { ...patch, updatedAt: new Date() } })
  return c.json({ success: true })
})

// Schedule (upcoming visits)
app.get('/visits', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const rows = await db.select({
    id: schedules.id,
    scheduled_date: schedules.effectiveDate,
    start_time: sql<string>`to_char(${schedules.startTime}, 'HH24:MI')`,
    end_time: sql<string>`to_char(${schedules.endTime}, 'HH24:MI')`,
    status: sql<string>`'scheduled'`,
    notes: schedules.notes,
    caregiver_first_name: users.firstName,
    caregiver_last_name: users.lastName,
    caregiver_phone: users.phone,
  })
    .from(schedules)
    .leftJoin(users, eq(schedules.caregiverId, users.id))
    .where(and(eq(schedules.clientId, clientId), eq(schedules.isActive, true)))
    .orderBy(schedules.effectiveDate)
  return c.json(rows)
})

// Visit history (paginated)
app.get('/history', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const limit = Math.min(parseInt(c.req.query('limit') || '') || 20, 50)
  const offset = Math.max(parseInt(c.req.query('offset') || '') || 0, 0)

  const rows = await db.select({
    id: timeEntries.id,
    caregiver_id: timeEntries.caregiverId,
    client_id: timeEntries.clientId,
    start_time: timeEntries.startTime,
    end_time: timeEntries.endTime,
    duration_minutes: timeEntries.durationMinutes,
    is_complete: timeEntries.isComplete,
    notes: timeEntries.notes,
    created_at: timeEntries.createdAt,
    caregiver_first_name: users.firstName,
    caregiver_last_name: users.lastName,
  })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.caregiverId, users.id))
    .where(and(eq(timeEntries.clientId, clientId), eq(timeEntries.isComplete, true)))
    .orderBy(desc(timeEntries.startTime))
    .limit(limit)
    .offset(offset)

  return c.json(rows)
})

// Invoices — the last 24, each with its lines in date order: the per-day hours
// breakdown the family checks the bill against.
app.get('/invoices', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const invoiceRows = await db.select()
    .from(invoices)
    .where(eq(invoices.clientId, clientId))
    .orderBy(desc(invoices.createdAt))
    .limit(24)

  const results = await Promise.all(invoiceRows.map(async (inv) => {
    const lineItems = await db.select({
      id: invoiceLineItems.id,
      serviceDate: invoiceLineItems.serviceDate,
      description: invoiceLineItems.description,
      hours: invoiceLineItems.hours,
      rate: invoiceLineItems.rate,
      amount: invoiceLineItems.amount,
    })
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, inv.id))
      .orderBy(sql`${invoiceLineItems.serviceDate} ASC NULLS LAST`, invoiceLineItems.createdAt)
    return { ...inv, lineItems }
  }))

  return c.json(results)
})

// Caregivers: everyone with an active assignment OR an active schedule for this
// client, so a client sees who comes even where no assignment row was ever made.
const servesClient = (caregiverId: string, clientId: string) => db.execute(sql`
  SELECT 1 FROM client_assignments
   WHERE caregiver_id = ${caregiverId} AND client_id = ${clientId} AND status = 'active'
  UNION
  SELECT 1 FROM schedules
   WHERE caregiver_id = ${caregiverId} AND client_id = ${clientId} AND is_active = true
     AND (status IS NULL OR status = 'active')
  LIMIT 1
`).then((r: any) => (r.rows ?? r).length > 0)

export const caregiversServingClient = async (clientId: string, withPhone: boolean) => {
  const r: any = await db.execute(sql`
    SELECT DISTINCT ON (u.id)
      COALESCE(ca.id, s.id)          AS assignment_id,
      ca.assignment_date,
      ca.hours_per_week,
      COALESCE(ca.status, 'active')  AS status,
      u.id                           AS caregiver_id,
      u.first_name, u.last_name,
      ${withPhone ? sql`u.phone` : sql`NULL::text`} AS phone,
      u.certifications
    FROM users u
    LEFT JOIN client_assignments ca
      ON ca.caregiver_id = u.id AND ca.client_id = ${clientId} AND ca.status = 'active'
    LEFT JOIN schedules s
      ON s.caregiver_id = u.id AND s.client_id = ${clientId} AND s.is_active = true
     AND (s.status IS NULL OR s.status = 'active')
    WHERE (ca.id IS NOT NULL OR s.id IS NOT NULL)
    ORDER BY u.id, ca.assignment_date DESC NULLS LAST
  `)
  return r.rows ?? r
}

// A caregiver's background checks, SUMMARY ONLY — never findings, notes, cost,
// reference numbers or identifiers — and only for a caregiver serving this client.
export const backgroundCheckSummary = async (caregiverId: string, clientId: string) => {
  if (!(await servesClient(caregiverId, clientId))) return null
  return db.select({
    id: backgroundChecks.id,
    checkType: backgroundChecks.checkType,
    provider: backgroundChecks.provider,
    status: backgroundChecks.status,
    initiatedDate: backgroundChecks.initiatedDate,
    expirationDate: backgroundChecks.expirationDate,
  })
    .from(backgroundChecks)
    .where(eq(backgroundChecks.caregiverId, caregiverId))
    .orderBy(desc(backgroundChecks.initiatedDate))
}

app.get('/caregivers', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  return c.json(await caregiversServingClient(clientId, true))
})

app.get('/caregivers/:caregiverId/background-checks', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const rows = await backgroundCheckSummary(c.req.param('caregiverId'), clientId)
  if (!rows) return c.json({ error: 'This caregiver is not assigned to you' }, 403)
  return c.json(rows)
})

// =============================================
// STRIPE PAYMENT
// =============================================

app.post('/invoices/:invoiceId/pay', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const invoiceId = c.req.param('invoiceId')

  if (!process.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Online payments are not configured' }, 400)
  }

  const [inv] = await db.select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.clientId, clientId)))
    .limit(1)

  if (!inv) {
    return c.json({ error: 'Invoice not found' }, 404)
  }

  if (inv.paymentStatus === 'paid') {
    return c.json({ error: 'Invoice already paid' }, 400)
  }

  const Stripe = (await import('stripe')).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' as any })

  const amountCents = Math.round(Number(inv.total) * 100)

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    metadata: {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientId,
    },
    description: `Invoice ${inv.invoiceNumber}`,
  })

  // Store the payment intent ID on the invoice
  await db
    .update(invoices)
    .set({ stripePaymentIntentId: paymentIntent.id, updatedAt: new Date() } as any)
    .where(eq(invoices.id, invoiceId))

  return c.json({
    clientSecret: paymentIntent.client_secret,
    amount: amountCents,
    invoiceNumber: inv.invoiceNumber,
  })
})

// =============================================
// INVOICE PDF
// =============================================

app.get('/invoices/:invoiceId/pdf', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const client = c.get('portalClient') as any
  const invoiceId = c.req.param('invoiceId')

  const [inv] = await db.select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.clientId, clientId)))
    .limit(1)

  if (!inv) {
    return c.json({ error: 'Invoice not found' }, 404)
  }

  const lineItems = await db.select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId))

  const [agency] = await db.select().from(agencies).limit(1)
  if (!agency) return c.json({ error: 'Agency not found' }, 404)

  const { generateInvoicePDF } = await import('../services/pdf.ts')
  const pdfBuffer = await generateInvoicePDF({ ...inv, lineItems }, agency, client)

  return new Response(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${inv.invoiceNumber}.pdf"`,
    },
  })
})

// =============================================
// CARE PLAN
// =============================================

app.get('/care-plan', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const client = c.get('portalClient') as any

  // Get authorizations
  const auths = await db.select()
    .from(authorizations)
    .where(and(eq(authorizations.clientId, clientId), eq(authorizations.status, 'active')))
    .orderBy(desc(authorizations.startDate))

  // Get emergency contacts
  const emergencyContacts = await db.select()
    .from(clientEmergencyContacts)
    .where(eq(clientEmergencyContacts.clientId, clientId))

  // Get assigned caregivers
  const assignedCaregivers = await db.select({
    id: clientAssignments.id,
    firstName: users.firstName,
    lastName: users.lastName,
    phone: users.phone,
    hoursPerWeek: clientAssignments.hoursPerWeek,
  })
    .from(clientAssignments)
    .innerJoin(users, eq(clientAssignments.caregiverId, users.id))
    .where(and(eq(clientAssignments.clientId, clientId), eq(clientAssignments.status, 'active')))

  return c.json({
    client: {
      firstName: client.firstName,
      lastName: client.lastName,
      dateOfBirth: client.dateOfBirth,
      gender: client.gender,
      address: client.address,
      city: client.city,
      state: client.state,
      zip: client.zip,
      phone: client.phone,
      serviceType: client.serviceType,
      medicalConditions: client.medicalConditions || [],
      allergies: client.allergies || [],
      medications: client.medications || [],
      notes: client.notes,
      insuranceProvider: client.insuranceProvider,
      primaryDiagnosisCode: client.primaryDiagnosisCode,
    },
    authorizations: auths.map(a => ({
      id: a.id,
      authNumber: a.authNumber,
      procedureCode: a.procedureCode,
      authorizedUnits: Number(a.authorizedUnits),
      usedUnits: Number(a.usedUnits),
      unitType: a.unitType,
      startDate: a.startDate,
      endDate: a.endDate,
      status: a.status,
      remainingUnits: Number(a.authorizedUnits) - Number(a.usedUnits),
    })),
    emergencyContacts,
    caregivers: assignedCaregivers,
  })
})

// =============================================
// MESSAGING
// =============================================

// List message threads
app.get('/messages', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string

  const threads = await db.select()
    .from(portalMessageThreads)
    .where(eq(portalMessageThreads.clientId, clientId))
    .orderBy(desc(portalMessageThreads.lastMessageAt))

  // Get last message for each thread
  const results = await Promise.all(threads.map(async (thread) => {
    const [lastMessage] = await db.select()
      .from(portalMessages)
      .where(eq(portalMessages.threadId, thread.id))
      .orderBy(desc(portalMessages.createdAt))
      .limit(1)

    const [msgCount] = await db
      .select({ value: count() })
      .from(portalMessages)
      .where(eq(portalMessages.threadId, thread.id))

    const hasUnread = !thread.clientLastReadAt ||
      new Date(thread.lastMessageAt) > new Date(thread.clientLastReadAt)

    return {
      ...thread,
      lastMessage: lastMessage || null,
      messageCount: msgCount.value,
      hasUnread,
    }
  }))

  return c.json(results)
})

// Create new message thread
app.post('/messages', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const client = c.get('portalClient') as any
  const { subject, body } = await c.req.json()

  if (!subject?.trim() || !body?.trim()) {
    return c.json({ error: 'Subject and message body are required' }, 400)
  }

  const [thread] = await db.insert(portalMessageThreads).values({
    clientId,
    subject: subject.trim(),
    lastMessageAt: new Date(),
    clientLastReadAt: new Date(),
  }).returning()

  const [message] = await db.insert(portalMessages).values({
    threadId: thread.id,
    senderType: 'client',
    senderName: `${client.firstName} ${client.lastName}`,
    body: body.trim(),
  }).returning()

  return c.json({ thread, message })
})

// Get thread messages
app.get('/messages/:threadId', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const threadId = c.req.param('threadId')

  const [thread] = await db.select()
    .from(portalMessageThreads)
    .where(and(eq(portalMessageThreads.id, threadId), eq(portalMessageThreads.clientId, clientId)))
    .limit(1)

  if (!thread) {
    return c.json({ error: 'Thread not found' }, 404)
  }

  const msgs = await db.select()
    .from(portalMessages)
    .where(eq(portalMessages.threadId, threadId))
    .orderBy(portalMessages.createdAt)

  return c.json({ thread, messages: msgs })
})

// Reply to thread
app.post('/messages/:threadId', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const client = c.get('portalClient') as any
  const threadId = c.req.param('threadId')
  const { body } = await c.req.json()

  if (!body?.trim()) {
    return c.json({ error: 'Message body is required' }, 400)
  }

  const [thread] = await db.select()
    .from(portalMessageThreads)
    .where(and(eq(portalMessageThreads.id, threadId), eq(portalMessageThreads.clientId, clientId)))
    .limit(1)

  if (!thread) {
    return c.json({ error: 'Thread not found' }, 404)
  }

  const [message] = await db.insert(portalMessages).values({
    threadId,
    senderType: 'client',
    senderName: `${client.firstName} ${client.lastName}`,
    body: body.trim(),
  }).returning()

  // Update thread timestamps
  await db
    .update(portalMessageThreads)
    .set({
      lastMessageAt: new Date(),
      clientLastReadAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(portalMessageThreads.id, threadId))

  return c.json(message)
})

// Mark thread as read
app.post('/messages/:threadId/read', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const threadId = c.req.param('threadId')

  await db
    .update(portalMessageThreads)
    .set({ clientLastReadAt: new Date(), updatedAt: new Date() })
    .where(and(eq(portalMessageThreads.id, threadId), eq(portalMessageThreads.clientId, clientId)))

  return c.json({ success: true })
})

// =============================================
// NOTIFICATIONS
// =============================================

app.get('/notifications', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string

  const rows = await db.select()
    .from(clientNotifications)
    .where(eq(clientNotifications.clientId, clientId))
    .orderBy(desc(clientNotifications.createdAt))
    .limit(50)

  return c.json(rows)
})

app.post('/notifications/:id/read', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const notifId = c.req.param('id')

  await db
    .update(clientNotifications)
    .set({ isRead: true })
    .where(and(eq(clientNotifications.id, notifId), eq(clientNotifications.clientId, clientId)))

  return c.json({ success: true })
})

// Also support PUT for backwards compat with existing frontend
app.put('/notifications/:id/read', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const notifId = c.req.param('id')

  await db
    .update(clientNotifications)
    .set({ isRead: true })
    .where(and(eq(clientNotifications.id, notifId), eq(clientNotifications.clientId, clientId)))

  return c.json({ success: true })
})

app.post('/notifications/read-all', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string

  await db
    .update(clientNotifications)
    .set({ isRead: true })
    .where(and(eq(clientNotifications.clientId, clientId), eq(clientNotifications.isRead, false)))

  return c.json({ success: true })
})

// Also support PUT for backwards compat
app.put('/notifications/read-all', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string

  await db
    .update(clientNotifications)
    .set({ isRead: true })
    .where(and(eq(clientNotifications.clientId, clientId), eq(clientNotifications.isRead, false)))

  return c.json({ success: true })
})

// =============================================
// PORTAL ROUTES: signable documents
// =============================================
// The client (or whoever holds their portal access) signs the agency's
// paperwork here. Staff-side sending and the certificate view are in
// routes/clientDocuments.ts.

const MAX_SIGNATURE_BYTES = 400_000

function signerIp(c: Context): string | null {
  const fwd = c.req.header('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim() || null
  return c.req.header('x-real-ip') || null
}

function documentFingerprint(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function validateSignatureInput(body: any): { ok: true; signerName: string } | { ok: false; error: string } {
  const signature = body?.signature
  const signerName = typeof body?.signedBy === 'string' ? body.signedBy.trim() : ''
  if (typeof signature !== 'string' || !signature.startsWith('data:image/')) {
    return { ok: false, error: 'Please draw your signature.' }
  }
  if (signature.length > MAX_SIGNATURE_BYTES) {
    return { ok: false, error: 'Signature image is too large.' }
  }
  if (!signerName) return { ok: false, error: 'Please type your full name to sign.' }
  if (body?.consent !== true) {
    return { ok: false, error: 'You must agree to sign electronically before signing.' }
  }
  return { ok: true, signerName }
}

// List this client's documents. Void ones are not shown — they were withdrawn.
app.get('/documents', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const rows = await db
    .select({
      id: clientDocuments.id,
      title: clientDocuments.title,
      status: clientDocuments.status,
      sentAt: clientDocuments.sentAt,
      signedAt: clientDocuments.signedAt,
      signedBy: clientDocuments.signedBy,
      declinedAt: clientDocuments.declinedAt,
    })
    .from(clientDocuments)
    .where(and(eq(clientDocuments.clientId, clientId), sql`${clientDocuments.status} <> 'void'`))
    .orderBy(desc(clientDocuments.sentAt))

  return c.json({ data: rows })
})

// Open one. Opening marks it viewed, which is part of the evidence trail.
app.get('/documents/:id', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const [doc] = await db
    .select()
    .from(clientDocuments)
    .where(and(eq(clientDocuments.id, c.req.param('id')), eq(clientDocuments.clientId, clientId)))
    .limit(1)

  if (!doc || doc.status === 'void') return c.json({ error: 'Document not found' }, 404)

  // An administrator's preview must not stamp the document as seen by the client.
  if (!doc.viewedAt && !c.get('portalPreview')) {
    await db
      .update(clientDocuments)
      .set({ viewedAt: new Date(), status: doc.status === 'sent' ? 'viewed' : doc.status, updatedAt: new Date() } as any)
      .where(eq(clientDocuments.id, doc.id))
  }

  return c.json(doc)
})

app.post('/documents/:id/sign', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const body = await c.req.json().catch(() => ({}))

  const validation = validateSignatureInput(body)
  if (!validation.ok) return c.json({ error: validation.error }, 400)

  const [doc] = await db
    .select()
    .from(clientDocuments)
    .where(and(eq(clientDocuments.id, c.req.param('id')), eq(clientDocuments.clientId, clientId)))
    .limit(1)

  if (!doc || doc.status === 'void') return c.json({ error: 'Document not found' }, 404)
  // Signing twice would overwrite the first signature's evidence.
  if (doc.status === 'signed') return c.json({ error: 'This document has already been signed' }, 400)

  const relationship = typeof body?.signerRelationship === 'string' && body.signerRelationship.trim()
    ? body.signerRelationship.trim().slice(0, 100)
    : 'Self'

  const now = new Date()
  // Hash the text that was actually on screen, so the signature is bound to
  // this wording and not to whatever the template says later.
  const hash = documentFingerprint({
    id: doc.id,
    title: doc.title,
    body: doc.body,
    clientId: doc.clientId,
    signedBy: validation.signerName,
    signedAt: now.toISOString(),
  })

  const [updated] = await db
    .update(clientDocuments)
    .set({
      status: 'signed',
      signedAt: now,
      signedBy: validation.signerName,
      signerRelationship: relationship,
      signedIp: signerIp(c),
      signedUserAgent: (c.req.header('user-agent') || '').slice(0, 500),
      signatureImage: body.signature,
      consentAt: now,
      documentHash: hash,
      updatedAt: now,
    } as any)
    .where(eq(clientDocuments.id, doc.id))
    .returning()

  try {
    await db.insert(auditLogs).values({
      userId: 'client:' + clientId,
      action: 'client_document.signed',
      tableName: 'client_documents',
      recordId: doc.id,
      newData: { title: doc.title, signedBy: validation.signerName, relationship, documentHash: hash } as any,
      ipAddress: signerIp(c),
    } as any)
  } catch (err) {
    // The signature is saved; a missing audit row must not undo it.
    logger.error('[portal] audit write failed for signed document', { error: (err as Error).message })
  }

  return c.json(updated)
})

app.post('/documents/:id/decline', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const body = await c.req.json().catch(() => ({}))
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 1000) : ''

  const [doc] = await db
    .select()
    .from(clientDocuments)
    .where(and(eq(clientDocuments.id, c.req.param('id')), eq(clientDocuments.clientId, clientId)))
    .limit(1)

  if (!doc || doc.status === 'void') return c.json({ error: 'Document not found' }, 404)
  if (doc.status === 'signed') return c.json({ error: 'This document has already been signed' }, 400)

  const [updated] = await db
    .update(clientDocuments)
    .set({ status: 'declined', declinedAt: new Date(), declineReason: reason || null, updatedAt: new Date() } as any)
    .where(eq(clientDocuments.id, doc.id))
    .returning()

  return c.json(updated)
})

export default app
