// Home care's client portal: the office's switches for it (/contacts/*, /admin/*) and the client's own pages, signed in
// by the portal's own logins. Moved from templates/crm-homecare/backend/src/routes/portal.ts.
//
// Who signs in: a client_portal_accounts row — one per PERSON, several per client (the client and each relative), each
// with its own email, password, lockout counter and invite/reset link. clientId is the authorisation scope; the account
// email in the token says which person it is. The older direct link (clients.portal_token, /portal?token=…) still
// works: it is redeemed once at /exchange for a session, and signable-document emails use it.
//
// Mounted at /api/portal IN FRONT OF the CRM's customer portal (server/modules/crm.ts composes the two for the
// home-care vertical): the CRM's portal lives at /p/:token/… and its staff switches at /contacts/:contactId/…; home
// care's switches at /contacts/:clientId/… answer first, because a home-care agency's customers are its clients.
// Nothing here is mounted with `use('*')`, so nothing reaches the CRM's paths.
//
// Changes from the template:
//   · permissions, not rank (RULEBOOK; packages/tenant-backend auth/permissions.ts): every office switch was
//     requireAdmin and is now a care-portal permission a caregiver does not hold — reads of the office's views and the
//     direct link: care-portal:update; invites and notices: care-portal:create; removing a login: care-portal:delete;
//   · every office read and write is scoped to the signed-in person's company; a portal session is scoped to its
//     client's company (the token carries companyId too; a token without one — issued before — is scoped by its client);
//   · replies through server/http/reply.ts: the lists are { data, pagination } and the keys are camelCase (RULEBOOK
//     §2/§3) — /me's first_name is firstName, /admin/clients' portal_status is portalStatus, a caregiver's caregiver_id
//     is caregiverId;
//   · the agency is the client's company row, not "the first agency".
import crypto from 'node:crypto'
import { Hono, type Context, type Next } from 'hono'
import jwt from 'jsonwebtoken'
import { documentLinkToken, documentLinkPath } from '@twomiah/tenant-backend'
import { and, asc, count, desc, eq, ne } from 'drizzle-orm'
import {
  clients, company, timeEntries, invoices, invoiceLineItems, clientEmergencyContacts, authorizations, user,
  clientNotifications, portalMessageThreads, portalMessages, clientDocuments, auditLogs, clientPortalAccounts,
  clientNotificationPreferences, backgroundChecks,
} from '../../../db/schema/index.ts'
import { fail, list, one, done, listAll } from '../../../http/reply.ts'
import { createRateLimiter } from '../../../http/guards.ts'
import type { AppEnv } from '../../../http/env.ts'
import { clientVisibleInvoiceSql } from '../../../data/homecareBilling.ts'
import { clientOccurrenceCount } from '../../../data/homecareCore.ts'
import {
  portalAccountStatusSql, portalInviteLiveSql, portalClientsOverview, clientOutstandingBalance,
  caregiversServingClient, servesClient,
} from '../../../data/homecarePortals.ts'
import { addDays } from '../core/agencyTime.ts'
import { generateInvoicePDF } from '../core/invoicePdf.ts'
import { cardPaymentsFor } from '../../cardPayments.ts'
import { visitInvoiceOwed } from '../billing/stripe.ts'
import { PORTAL_PREVIEW_READ_ONLY } from '../core/viewAsReadOnly.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'

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

/** What a portal request carries once portalAuth has run. */
export type PortalVars = {
  portalClientId: string
  portalCompanyId: string
  portalClient: typeof clients.$inferSelect
  portalAccount: { id: string; email: string; displayName: string | null; lastLogin: Date | null } | undefined
  portalPreview: boolean
}
export type PortalEnv = { Variables: AppEnv['Variables'] & PortalVars }

const frontendUrl = () => process.env.FRONTEND_URL || ''
const setupUrl = (token: string) => `${frontendUrl()}/portal/setup?token=${token}`
const directLink = (token: string) => `${frontendUrl()}/portal?token=${token}`
const EMAIL_RE = /^\S+@\S+\.\S+$/
const normEmail = (e: unknown) => String(e ?? '').trim().toLowerCase()
const newToken = () => crypto.randomBytes(32).toString('hex')
const DIRECT_LINK_DAYS = 90

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
  if (typeof signature !== 'string' || !signature.startsWith('data:image/')) return { ok: false, error: 'Please draw your signature.' }
  if (signature.length > MAX_SIGNATURE_BYTES) return { ok: false, error: 'Signature image is too large.' }
  if (!signerName) return { ok: false, error: 'Please type your full name to sign.' }
  if (body?.consent !== true) return { ok: false, error: 'You must agree to sign electronically before signing.' }
  return { ok: true, signerName }
}

/** A list that is the whole answer (no paging): one page holding every row. */
const all = <T,>(c: Context, rows: T[]) => listAll(c, rows)

/**
 * The portal's sign-in: the emailed link's token (x-portal-token), a password session, the direct link's session, or
 * an administrator's preview (read-only). Sets the client, its company and (for a password session) the person.
 */
export function createPortalAuth(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  return async function portalAuth(c: Context<PortalEnv>, next: Next) {
    const touch = (id: string) => db.update(clients).set({ lastPortalVisit: new Date(), updatedAt: new Date() } as any).where(eq(clients.id, id))
    const admit = async (found: typeof clients.$inferSelect, extra: { account?: PortalVars['portalAccount']; preview?: boolean } = {}) => {
      c.set('portalClientId', found.id)
      c.set('portalCompanyId', found.companyId)
      c.set('portalClient', found)
      c.set('portalAccount', extra.account)
      c.set('portalPreview', !!extra.preview)
      // A cancelled agency's portal is paused, like its staff CRM (core/portalLock.ts) — on every way in.
      const locked = await core.portalLock.refusePortalWhileLocked(c, found.companyId)
      if (locked) return locked
      await next()
    }

    // The emailed link's own token (clients.portal_token).
    const headerToken = c.req.header('x-portal-token')
    if (headerToken) {
      const [found] = await db.select().from(clients)
        .where(and(eq(clients.portalToken, headerToken), eq(clients.portalEnabled, true), eq(clients.isActive, true))).limit(1)
      if (!found) return fail(c, 401, 'Invalid or expired portal link')
      if (found.portalTokenExp && new Date() > new Date(found.portalTokenExp)) {
        return fail(c, 401, 'Portal link has expired. Please contact your care coordinator.')
      }
      await touch(found.id)
      return admit(found)
    }

    const bearerToken = c.req.header('authorization')?.split(' ')[1]
    if (!bearerToken) return fail(c, 401, 'Portal authentication required')
    let decoded: any
    try {
      decoded = jwt.verify(bearerToken, process.env.JWT_SECRET!)
    } catch {
      return fail(c, 401, 'Invalid or expired token')
    }
    if (decoded?.role !== 'client' || !decoded.clientId) return fail(c, 403, 'Client access required')
    const sameCompany = (row: { companyId: string } | undefined) => !!row && (!decoded.companyId || row.companyId === decoded.companyId)

    // An administrator's preview: the client must exist, and nothing may be changed.
    if (decoded.impersonation) {
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return fail(c, 403, PORTAL_PREVIEW_READ_ONLY, 'view_as_read_only')
      const [found] = await db.select().from(clients).where(eq(clients.id, String(decoded.clientId))).limit(1)
      if (!found || !sameCompany(found)) return fail(c, 403, 'Client not found')
      return admit(found, { preview: true })
    }

    const [found] = await db.select().from(clients)
      .where(and(eq(clients.id, String(decoded.clientId)), eq(clients.isActive, true))).limit(1)
    if (!found || !sameCompany(found)) return fail(c, 403, 'Portal access revoked or client inactive')

    let account: PortalVars['portalAccount']
    if (decoded.accountEmail) {
      // Signed in with a password: THAT person's login must still be on. Removing one relative ends their access
      // without waiting for the token to run out.
      ;[account] = await db
        .select({ id: clientPortalAccounts.id, email: clientPortalAccounts.email, displayName: clientPortalAccounts.displayName, lastLogin: clientPortalAccounts.lastLogin })
        .from(clientPortalAccounts)
        .where(and(
          eq(clientPortalAccounts.companyId, found.companyId),
          eq(clientPortalAccounts.clientId, found.id),
          eq(clientPortalAccounts.email, normEmail(decoded.accountEmail)),
          eq(clientPortalAccounts.portalEnabled, true),
        ))
        .limit(1)
      if (!account) return fail(c, 403, 'Portal access revoked or client inactive')
    } else if (!found.portalEnabled) {
      // Signed in through the direct link: the client's portal switch is that link's gate.
      return fail(c, 401, 'Portal access disabled')
    }
    await touch(found.id)
    return admit(found, { account })
  }
}

export function createClientPortalRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const app = new Hono<PortalEnv>()
  const portalAuth = createPortalAuth(core, d)
  const staff = (permission: string) => [d.authenticate, d.permissions.requirePermission(permission)] as const
  const signedIn = (c: Context<PortalEnv>) => c.get('user')

  /** One of the signed-in person's company's clients, or undefined. */
  const companyClient = async (companyId: string, clientId: string, activeOnly = false) => {
    const [row] = await db.select().from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId), ...(activeOnly ? [eq(clients.isActive, true)] : []))).limit(1)
    return row as typeof clients.$inferSelect | undefined
  }
  const agencyName = async (companyId: string) => {
    const [row] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    return row?.name || ''
  }

  // Ensure the client's direct-link credential (clients.portal_token) exists and is live. Signable-document emails
  // carry this link, so a client whose portal is switched on must have one.
  async function ensureClientLink(companyId: string, clientId: string, existing: { portalToken: string | null; portalTokenExp: Date | null }) {
    const live = existing.portalToken && (!existing.portalTokenExp || new Date(existing.portalTokenExp) > new Date())
    const set: Record<string, unknown> = { portalEnabled: true, updatedAt: new Date() }
    if (!live) {
      set.portalToken = newToken()
      set.portalTokenExp = new Date(Date.now() + DIRECT_LINK_DAYS * 24 * 60 * 60 * 1000)
    }
    await db.update(clients).set(set as any).where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
  }

  // ════ THE OFFICE ════════════════════════════════════════════════════════════════════════

  // Switch the direct link on for a client.
  app.post('/contacts/:clientId/enable', ...staff('care-portal:update'), async (c) => {
    const me = signedIn(c)
    const found = await companyClient(me.companyId, c.req.param('clientId')!)
    if (!found) return fail(c, 404, 'Client not found')
    const email = found.portalEmail || found.email
    if (!email) return fail(c, 400, 'Client must have an email (or portal email) to enable portal access')
    const portalToken = newToken()
    const portalTokenExp = new Date(Date.now() + DIRECT_LINK_DAYS * 24 * 60 * 60 * 1000)
    await db.update(clients).set({ portalEnabled: true, portalToken, portalTokenExp, portalEmail: email, updatedAt: new Date() } as any)
      .where(and(eq(clients.id, found.id), eq(clients.companyId, me.companyId)))
    return one(c, { success: true, portalUrl: directLink(portalToken), expiresAt: portalTokenExp })
  })

  // Switch a client's portal off — every way in: the direct link AND every person's login.
  app.post('/contacts/:clientId/disable', ...staff('care-portal:update'), async (c) => {
    const me = signedIn(c)
    const clientId = c.req.param('clientId')!
    await db.update(clients).set({ portalEnabled: false, portalToken: null, portalTokenExp: null, updatedAt: new Date() } as any)
      .where(and(eq(clients.id, clientId), eq(clients.companyId, me.companyId)))
    await db.update(clientPortalAccounts).set({ portalEnabled: false, updatedAt: new Date() })
      .where(and(eq(clientPortalAccounts.clientId, clientId), eq(clientPortalAccounts.companyId, me.companyId)))
    return done(c)
  })

  // A new direct link (the old one stops working).
  app.post('/contacts/:clientId/regenerate', ...staff('care-portal:update'), async (c) => {
    const me = signedIn(c)
    const found = await companyClient(me.companyId, c.req.param('clientId')!)
    if (!found) return fail(c, 404, 'Client not found')
    const portalToken = newToken()
    const portalTokenExp = new Date(Date.now() + DIRECT_LINK_DAYS * 24 * 60 * 60 * 1000)
    await db.update(clients).set({ portalToken, portalTokenExp, updatedAt: new Date() } as any)
      .where(and(eq(clients.id, found.id), eq(clients.companyId, me.companyId)))
    return one(c, { success: true, portalUrl: directLink(portalToken), expiresAt: portalTokenExp })
  })

  // Email the client their direct link.
  app.post('/contacts/:clientId/send-link', ...staff('care-portal:update'), async (c) => {
    const me = signedIn(c)
    const found = await companyClient(me.companyId, c.req.param('clientId')!)
    if (!found) return fail(c, 404, 'Client not found')
    const email = found.portalEmail || found.email
    if (!email) return fail(c, 400, 'Client has no email address')
    if (!found.portalEnabled || !found.portalToken) return fail(c, 400, 'Portal access not enabled for this client')
    await core.email.sendPortalInvite(email, {
      contactName: `${found.firstName} ${found.lastName}`,
      companyName: await agencyName(me.companyId),
      portalUrl: directLink(found.portalToken),
    })
    return one(c, { success: true, sentTo: email })
  })

  // A client's portal status. Office only: the answer carries the direct link, which opens the portal as this client.
  app.get('/contacts/:clientId/status', ...staff('care-portal:update'), async (c) => {
    const found = await companyClient(signedIn(c).companyId, c.req.param('clientId')!)
    if (!found) return fail(c, 404, 'Client not found')
    return one(c, {
      enabled: found.portalEnabled,
      hasToken: !!found.portalToken,
      expiresAt: found.portalTokenExp,
      lastVisit: found.lastPortalVisit,
      portalEmail: found.portalEmail,
      portalUrl: found.portalToken ? directLink(found.portalToken) : null,
    })
  })

  // Invite people to a client's portal: { clientId, invitees: [{ email, name }] } (or the older { clientId, email, name }).
  // Each email becomes its OWN login. Sending to an email that already has a login for this client regenerates its
  // 48-hour link (lost invite, forgotten password); the old link stops working. An email already used for a DIFFERENT
  // client is refused: the email is the login key.
  app.post('/admin/invite', ...staff('care-portal:create'), async (c) => {
    const me = signedIn(c)
    const body = await c.req.json().catch(() => ({} as any))
    const { clientId, email, name } = body || {}
    const invitees: Array<{ email?: unknown; name?: unknown }> =
      Array.isArray(body?.invitees) && body.invitees.length ? body.invitees : (email ? [{ email, name }] : [])
    if (!clientId || invitees.length === 0) return fail(c, 400, 'clientId and at least one email are required')
    for (const inv of invitees) {
      if (!inv?.email || !EMAIL_RE.test(String(inv.email).trim())) return fail(c, 400, `Invalid email address: ${inv?.email || '(blank)'}`)
    }
    const found = await companyClient(me.companyId, String(clientId), true)
    if (!found) return fail(c, 404, 'Client not found or inactive')

    const clientName = `${found.firstName} ${found.lastName}`
    const companyName = await agencyName(me.companyId)
    const results: any[] = []
    for (const inv of invitees) {
      const invEmail = normEmail(inv.email)
      const invName = inv.name ? String(inv.name).trim() || null : null
      // The login key: an email is one login across the database (the sign-in has no company to go on).
      const [existing] = await db.select({ id: clientPortalAccounts.id, clientId: clientPortalAccounts.clientId })
        .from(clientPortalAccounts).where(eq(clientPortalAccounts.email, invEmail)).limit(1)
      if (existing && existing.clientId !== found.id) {
        results.push({ email: invEmail, error: 'This email already has a portal account for a different client.' })
        continue
      }
      const inviteToken = newToken()
      const inviteExpiresAt = new Date(Date.now() + PORTAL_RULES.inviteHours * 60 * 60 * 1000)
      if (existing) {
        await db.update(clientPortalAccounts).set({ ...(invName ? { displayName: invName } : {}), inviteToken, inviteExpiresAt, updatedAt: new Date() })
          .where(and(eq(clientPortalAccounts.id, existing.id), eq(clientPortalAccounts.companyId, me.companyId)))
      } else {
        await db.insert(clientPortalAccounts).values({
          companyId: me.companyId,
          clientId: found.id,
          email: invEmail,
          displayName: invName,
          inviteToken,
          inviteExpiresAt,
          portalEnabled: false, // switched on when they set a password
        })
      }
      const inviteUrl = setupUrl(inviteToken)
      // The record stands even if the email cannot go out: the office can copy the link.
      const mail = await delivered(core.email.sendPortalSetupInvite(invEmail, { contactName: invName || clientName, clientName, companyName, setupUrl: inviteUrl }))
      results.push({ email: invEmail, name: invName, inviteUrl, emailSent: mail.sent, emailError: mail.error, expiresAt: inviteExpiresAt })
    }
    const ok = results.filter((r) => !r.error)
    const failed = results.filter((r) => r.error)
    // Inviting someone turns the client's portal on, which includes the direct link that signable-document emails carry.
    if (ok.length) {
      await ensureClientLink(me.companyId, found.id, found)
      if (!found.portalEmail) {
        await db.update(clients).set({ portalEmail: ok[0].email, updatedAt: new Date() } as any).where(and(eq(clients.id, found.id), eq(clients.companyId, me.companyId)))
      }
    }
    return one(c, {
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

  // Every login on one client's portal (one row per person).
  app.get('/admin/clients/:clientId/accounts', ...staff('care-portal:update'), async (c) => {
    const rows = await db.select({
      id: clientPortalAccounts.id,
      email: clientPortalAccounts.email,
      displayName: clientPortalAccounts.displayName,
      portalEnabled: clientPortalAccounts.portalEnabled,
      lastLogin: clientPortalAccounts.lastLogin,
      lockedUntil: clientPortalAccounts.lockedUntil,
      status: portalAccountStatusSql(),
    }).from(clientPortalAccounts)
      .where(and(eq(clientPortalAccounts.clientId, c.req.param('clientId')!), eq(clientPortalAccounts.companyId, signedIn(c).companyId)))
      .orderBy(clientPortalAccounts.createdAt)
    return all(c, rows)
  })

  // Take ONE person's access away; the client's other logins are untouched.
  app.delete('/admin/accounts/:accountId', ...staff('care-portal:delete'), async (c) => {
    const rows = await db.delete(clientPortalAccounts)
      .where(and(eq(clientPortalAccounts.id, c.req.param('accountId')!), eq(clientPortalAccounts.companyId, signedIn(c).companyId)))
      .returning({ email: clientPortalAccounts.email })
    if (!rows.length) return fail(c, 404, 'Account not found')
    return one(c, { success: true, removed: rows[0].email })
  })

  // Switch a client's whole portal on or off — every login and the direct link.
  app.put('/admin/clients/:clientId/toggle', ...staff('care-portal:update'), async (c) => {
    const me = signedIn(c)
    const clientId = c.req.param('clientId')!
    const { enabled } = await c.req.json().catch(() => ({} as any))
    if (typeof enabled !== 'boolean') return fail(c, 400, 'enabled must be true or false')
    await db.update(clientPortalAccounts).set({ portalEnabled: enabled, updatedAt: new Date() })
      .where(and(eq(clientPortalAccounts.clientId, clientId), eq(clientPortalAccounts.companyId, me.companyId)))
    await db.update(clients).set({ portalEnabled: enabled, updatedAt: new Date() } as any)
      .where(and(eq(clients.id, clientId), eq(clients.companyId, me.companyId)))
    return done(c)
  })

  // Portal status for every active client.
  app.get('/admin/clients', ...staff('care-portal:update'), async (c) => all(c, await portalClientsOverview(db, signedIn(c).companyId)))

  // Put a notification in a client's portal.
  app.post('/admin/notify', ...staff('care-portal:create'), async (c) => {
    const me = signedIn(c)
    const body = await c.req.json().catch(() => ({} as any))
    const { clientId, type, title, message, relatedVisitId, relatedInvoiceId, relatedCaregiverId } = body || {}
    if (!clientId || !type || !title) return fail(c, 400, 'clientId, type, and title are required')
    const found = await companyClient(me.companyId, String(clientId))
    if (!found) return fail(c, 404, 'Client not found')
    const [row] = await db.insert(clientNotifications).values({
      companyId: me.companyId,
      clientId: found.id,
      type: String(type),
      title: String(title),
      message: message ? String(message) : null,
      relatedVisitId: relatedVisitId ? String(relatedVisitId) : null,
      relatedInvoiceId: relatedInvoiceId ? String(relatedInvoiceId) : null,
      relatedCaregiverId: relatedCaregiverId ? String(relatedCaregiverId) : null,
    }).returning()
    return one(c, row, 201)
  })

  // See a client's portal exactly as they do ("View As" → Client Portal). A short-lived token marked as a preview. It
  // is READ-ONLY: portalAuth refuses every write made with it, so the office cannot sign a document, send a message or
  // pay as the client.
  app.post('/admin/preview/:clientId', ...staff('care-portal:update'), async (c) => {
    const me = signedIn(c)
    const found = await companyClient(me.companyId, c.req.param('clientId')!)
    if (!found) return fail(c, 404, 'Client not found')
    await core.careAudit.writeCareAudit(me, 'ADMIN_IMPERSONATE_PORTAL', 'clients', found.id, { impersonating: `${found.firstName} ${found.lastName}`, impersonatedBy: me.email })
    const token = jwt.sign(
      { role: 'client', clientId: found.id, companyId: me.companyId, firstName: found.firstName, lastName: found.lastName, impersonatedBy: me.email, impersonation: true },
      process.env.JWT_SECRET!,
      { expiresIn: `${PORTAL_RULES.previewHours}h` },
    )
    return one(c, {
      token,
      user: { id: found.id, name: `${found.firstName} ${found.lastName}`, role: 'client', impersonatedBy: me.email, firstName: found.firstName, lastName: found.lastName },
    })
  })

  // A new direct link (legacy compatibility). Office only: the link opens the portal as the client.
  app.post('/generate-link', ...staff('care-portal:update'), async (c) => {
    const me = signedIn(c)
    const { clientId } = await c.req.json().catch(() => ({} as any))
    if (!clientId) return fail(c, 400, 'clientId is required')
    const portalToken = newToken()
    const portalTokenExp = new Date(Date.now() + DIRECT_LINK_DAYS * 24 * 60 * 60 * 1000)
    const rows = await db.update(clients).set({ portalEnabled: true, portalToken, portalTokenExp, updatedAt: new Date() } as any)
      .where(and(eq(clients.id, String(clientId)), eq(clients.companyId, me.companyId)))
      .returning({ id: clients.id })
    if (!rows.length) return fail(c, 404, 'Client not found')
    return one(c, { token: portalToken, url: directLink(portalToken) })
  })

  // ════ SIGNING IN (public) ═══════════════════════════════════════════════════════════════

  app.post('/login', async (c) => {
    const { email, password } = await c.req.json().catch(() => ({} as any))
    if (!email || !password) return fail(c, 400, 'Email and password are required')
    // The email is the login key; the company is the login's.
    const [found] = await db.select({ account: clientPortalAccounts, client: clients })
      .from(clientPortalAccounts)
      .innerJoin(clients, and(eq(clientPortalAccounts.clientId, clients.id), eq(clients.companyId, clientPortalAccounts.companyId)))
      .where(and(eq(clientPortalAccounts.email, normEmail(email)), eq(clientPortalAccounts.portalEnabled, true), eq(clients.isActive, true)))
      .limit(1)
    if (!found) return fail(c, 401, 'Invalid credentials')
    const { account, client } = found
    if (account.lockedUntil && new Date(account.lockedUntil) > new Date()) {
      return fail(c, 423, 'Account temporarily locked. Please try again later.')
    }
    if (!account.passwordHash) return fail(c, 401, 'Account setup not complete. Please check your invite email.')
    const valid = await Bun.password.verify(String(password), account.passwordHash)
    if (!valid) {
      // THIS person's counter only — a client can have several logins and one relative's typos must not lock the
      // others out.
      const failCount = (account.failedLoginCount || 0) + 1
      const lockedUntil = failCount >= PORTAL_RULES.maxFailedLogins ? new Date(Date.now() + PORTAL_RULES.lockMinutes * 60 * 1000) : null
      await db.update(clientPortalAccounts).set({ failedLoginCount: failCount, lockedUntil, updatedAt: new Date() })
        .where(and(eq(clientPortalAccounts.id, account.id), eq(clientPortalAccounts.companyId, account.companyId)))
      return fail(c, 401, 'Invalid credentials')
    }
    await db.update(clientPortalAccounts).set({ failedLoginCount: 0, lockedUntil: null, lastLogin: new Date(), updatedAt: new Date() })
      .where(and(eq(clientPortalAccounts.id, account.id), eq(clientPortalAccounts.companyId, account.companyId)))
    await db.update(clients).set({ lastPortalVisit: new Date(), updatedAt: new Date() } as any)
      .where(and(eq(clients.id, client.id), eq(clients.companyId, client.companyId)))
    // accountEmail says WHICH person is signed in; clientId is what they may see.
    const token = jwt.sign(
      { role: 'client', clientId: client.id, companyId: client.companyId, accountEmail: account.email, firstName: client.firstName, lastName: client.lastName },
      process.env.JWT_SECRET!,
      { expiresIn: `${PORTAL_RULES.sessionHours}h` },
    )
    return one(c, { token, client: { id: client.id, firstName: client.firstName, lastName: client.lastName, email: account.email } })
  })

  // Exchange an emailed portal link token for a client session. The link carries clients.portal_token, not a JWT; it
  // is redeemed once here for the same kind of token /login issues.
  app.post('/exchange', async (c) => {
    const body = await c.req.json().catch(() => ({} as any))
    const linkToken = typeof body?.token === 'string' ? body.token.trim() : ''
    if (!linkToken) return fail(c, 400, 'Missing link token')
    const [found] = await db.select().from(clients)
      .where(and(eq(clients.portalToken, linkToken), eq(clients.portalEnabled, true), eq(clients.isActive, true))).limit(1)
    // Deliberately the same message for "no such token" and "portal disabled": a link that does not work should not
    // report which.
    if (!found) return fail(c, 401, 'This link is no longer valid. Please contact your care coordinator.')
    if (found.portalTokenExp && new Date() > new Date(found.portalTokenExp)) {
      return fail(c, 401, 'This link has expired. Please contact your care coordinator.')
    }
    await db.update(clients).set({ lastPortalVisit: new Date(), updatedAt: new Date() } as any)
      .where(and(eq(clients.id, found.id), eq(clients.companyId, found.companyId)))
    const token = jwt.sign(
      { clientId: found.id, companyId: found.companyId, role: 'client', firstName: found.firstName, lastName: found.lastName },
      process.env.JWT_SECRET!,
      { expiresIn: '30d' },
    )
    return one(c, { token, client: { id: found.id, firstName: found.firstName, lastName: found.lastName } })
  })

  // Accept an invite (or a reset link) and set the password.
  app.post('/set-password', async (c) => {
    const { token, password } = await c.req.json().catch(() => ({} as any))
    if (!token || !password) return fail(c, 400, 'Token and password are required')
    if (String(password).length < PORTAL_RULES.minPasswordLength) return fail(c, 400, 'Password must be at least 8 characters')
    const [account] = await db.select({ id: clientPortalAccounts.id, companyId: clientPortalAccounts.companyId }).from(clientPortalAccounts)
      .where(and(eq(clientPortalAccounts.inviteToken, String(token)), portalInviteLiveSql())).limit(1)
    if (!account) return fail(c, 400, 'Invalid or expired invite link. Please contact your care coordinator.')
    const passwordHash = await Bun.password.hash(String(password), 'bcrypt')
    // The link is single-use. Proving you hold the email also clears a lockout.
    await db.update(clientPortalAccounts).set({
      passwordHash, inviteToken: null, inviteExpiresAt: null, portalEnabled: true, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date(),
    }).where(and(eq(clientPortalAccounts.id, account.id), eq(clientPortalAccounts.companyId, account.companyId)))
    return done(c, 'Password set. You can now log in.')
  })

  // Forgot password (self-service). Reuses the invite token and /portal/setup with a 1-hour link. Always the same
  // answer, so nobody can find out whose email has an account by asking. 10 requests per 15 minutes per address (the
  // template's index.ts limit, here beside the route).
  app.post('/forgot-password', createRateLimiter(15 * 60 * 1000, 10), async (c) => {
    const { email } = await c.req.json().catch(() => ({} as any))
    if (!email) return fail(c, 400, 'Email is required')
    const generic = 'If an account exists with that email, a password reset link has been sent. Please check your inbox.'
    const [found] = await db.select({
      id: clientPortalAccounts.id, companyId: clientPortalAccounts.companyId, email: clientPortalAccounts.email,
      displayName: clientPortalAccounts.displayName, firstName: clients.firstName, lastName: clients.lastName,
    }).from(clientPortalAccounts)
      .innerJoin(clients, and(eq(clientPortalAccounts.clientId, clients.id), eq(clients.companyId, clientPortalAccounts.companyId)))
      .where(and(eq(clientPortalAccounts.email, normEmail(email)), eq(clientPortalAccounts.portalEnabled, true), eq(clients.isActive, true)))
      .limit(1)
    if (!found) return done(c, generic)
    const resetToken = newToken()
    await db.update(clientPortalAccounts)
      .set({ inviteToken: resetToken, inviteExpiresAt: new Date(Date.now() + PORTAL_RULES.resetHours * 60 * 60 * 1000), updatedAt: new Date() })
      .where(and(eq(clientPortalAccounts.id, found.id), eq(clientPortalAccounts.companyId, found.companyId)))
    const mail = await delivered(core.email.sendClientPortalPasswordReset(found.email, {
      contactName: found.displayName || `${found.firstName} ${found.lastName}`,
      companyName: await agencyName(found.companyId),
      resetUrl: setupUrl(resetToken),
    }))
    if (!mail.sent) d.logger.warn('[portal] forgot-password email not sent', { error: mail.error })
    return done(c, generic)
  })

  // ════ THE CLIENT'S PORTAL (portalAuth) ══════════════════════════════════════════════════

  // Portal home: the client's profile and summary.
  app.get('/me', portalAuth, async (c) => {
    const client = c.get('portalClient')
    const account = c.get('portalAccount')
    const companyId = c.get('portalCompanyId')
    const [visitResult] = await db.select({ value: count() }).from(timeEntries)
      .where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.clientId, client.id), eq(timeEntries.isComplete, true)))
    // Upcoming visits: the next four weeks' occurrences, through the one schedule engine (My Schedule lists the same).
    const tz = await core.time.timezone(companyId)
    const today = await core.time.today(companyId, tz)
    const upcoming = await clientOccurrenceCount(db, companyId, client.id, today, addDays(today, 27))
    const balance = await clientOutstandingBalance(db, companyId, client.id)
    const [unreadResult] = await db.select({ value: count() }).from(clientNotifications)
      .where(and(eq(clientNotifications.companyId, companyId), eq(clientNotifications.clientId, client.id), eq(clientNotifications.isRead, false)))
    const openThreads = await db.select().from(portalMessageThreads)
      .where(and(eq(portalMessageThreads.companyId, companyId), eq(portalMessageThreads.clientId, client.id), eq(portalMessageThreads.status, 'open')))
    const unreadMessages = openThreads.filter((t: any) => !t.clientLastReadAt || new Date(t.lastMessageAt as any) > new Date(t.clientLastReadAt)).length
    const [agency] = await db.select({ name: company.name, state: company.state, phone: company.phone }).from(company).where(eq(company.id, companyId)).limit(1)
    return one(c, {
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      dateOfBirth: client.dateOfBirth,
      email: client.email,
      phone: client.phone,
      address: client.address,
      city: client.city,
      state: client.state,
      zip: client.zip,
      serviceType: client.serviceType,
      startDate: client.startDate,
      // Which person is signed in (null for the direct link and for a preview)
      portalEmail: account?.email || client.portalEmail || null,
      displayName: account?.displayName || null,
      lastLogin: account?.lastLogin || null,
      preview: !!c.get('portalPreview'),
      agencyName: agency?.name || null,
      agencyState: agency?.state || null,
      agencyPhone: agency?.phone || null,
      // The portal prints instants (a visit's clock-in, a message, a signature) on the agency's clock, the same clock
      // as its visit times.
      agencyTimezone: tz,
      summary: {
        totalVisits: visitResult.value,
        upcomingSchedules: upcoming,
        outstandingBalance: balance,
        unreadNotifications: unreadResult.value,
        unreadMessages,
      },
    })
  })

  // The client's own notification switches. Each is a boolean; anything else for a key leaves it as it was.
  app.put('/preferences', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const body = await c.req.json().catch(() => ({} as any))
    const keys = ['emailEnabled', 'portalEnabled', 'caregiverAlerts', 'scheduleAlerts', 'billingAlerts', 'assignmentAlerts'] as const
    const patch: Record<string, boolean> = {}
    for (const k of keys) if (typeof body?.[k] === 'boolean') patch[k] = body[k]
    await db.insert(clientNotificationPreferences)
      .values({ companyId, clientId, ...patch })
      .onConflictDoUpdate({ target: clientNotificationPreferences.clientId, set: { ...patch, updatedAt: new Date() } })
    return done(c)
  })

  // Visit history: completed visits, newest first (?limit, at most 50; ?offset).
  app.get('/history', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const limit = Math.min(parseInt(c.req.query('limit') || '') || 20, 50)
    const offset = Math.max(parseInt(c.req.query('offset') || '') || 0, 0)
    const where = and(eq(timeEntries.companyId, companyId), eq(timeEntries.clientId, clientId), eq(timeEntries.isComplete, true))
    const rows = await db.select({
      id: timeEntries.id,
      caregiverId: timeEntries.caregiverId,
      clientId: timeEntries.clientId,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      durationMinutes: timeEntries.durationMinutes,
      isComplete: timeEntries.isComplete,
      notes: timeEntries.notes,
      createdAt: timeEntries.createdAt,
      caregiverFirstName: user.firstName,
      caregiverLastName: user.lastName,
    }).from(timeEntries)
      .leftJoin(user, eq(timeEntries.caregiverId, user.id))
      .where(where)
      .orderBy(desc(timeEntries.startTime))
      .limit(limit)
      .offset(offset)
    const [{ value: total }] = await db.select({ value: count() }).from(timeEntries).where(where)
    return list(c, rows, { page: Math.floor(offset / limit) + 1, limit, total: Number(total) })
  })

  // Invoices: the last 24 the family can see (released: sent, or paid in part or whole), each with its lines in date
  // order — the per-day hours breakdown the family checks the bill against.
  app.get('/invoices', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const invoiceRows = await db.select().from(invoices)
      .where(and(eq(invoices.companyId, companyId), eq(invoices.clientId, clientId), clientVisibleInvoiceSql()))
      .orderBy(desc(invoices.createdAt))
      .limit(24)
    const results = await Promise.all(invoiceRows.map(async (inv: typeof invoices.$inferSelect) => {
      const lineItems = await db.select({
        id: invoiceLineItems.id,
        serviceDate: invoiceLineItems.serviceDate,
        description: invoiceLineItems.description,
        hours: invoiceLineItems.hours,
        rate: invoiceLineItems.rate,
        amount: invoiceLineItems.amount,
      }).from(invoiceLineItems)
        .where(and(eq(invoiceLineItems.invoiceId, inv.id), eq(invoiceLineItems.companyId, companyId)))
        // ASC puts the undated lines last (Postgres sorts NULLs last in ascending order).
        .orderBy(asc(invoiceLineItems.serviceDate), invoiceLineItems.createdAt)
      // Pay: the invoice's own page (/d/<token>), the one its email links — it was /pay/<invoice id>.
      const { publicToken: _token, ...rest } = inv
      const owing = inv.paymentStatus !== 'paid'
      return { ...rest, lineItems, documentPath: owing ? documentLinkPath((await documentLinkToken(db, invoices, inv.id))!) : null }
    }))
    return all(c, results)
  })

  app.get('/caregivers', portalAuth, async (c) => {
    const companyId = c.get('portalCompanyId')
    return all(c, await caregiversServingClient(db, companyId, c.get('portalClientId'), await core.time.today(companyId), true))
  })

  app.get('/caregivers/:caregiverId/background-checks', portalAuth, async (c) => {
    const rows = await backgroundCheckSummary(c.get('portalCompanyId'), c.req.param('caregiverId')!, c.get('portalClientId'))
    if (!rows) return fail(c, 403, 'This caregiver is not assigned to you')
    return all(c, rows)
  })

  // The card or bank account that pays the invoices (row 22, care_autopay): the client sees what is on file, opens Stripe's own
  // page to save or replace it, or removes it. An administrator's preview may look but not change. 404 without the feature.
  const paymentsOff = async (c: Context<PortalEnv>) => (await d.features.isFeatureEnabled(c.get('portalCompanyId'), 'care_autopay')) ? null : fail(c, 404, 'Not found')
  app.get('/payment-method', portalAuth, async (c) => {
    const off = await paymentsOff(c); if (off) return off
    return one(c, await core.autopay.portalStatus(c.get('portalCompanyId'), c.get('portalClientId')))
  })
  app.post('/payment-method/setup', portalAuth, async (c) => {
    const off = await paymentsOff(c); if (off) return off
    if (c.get('portalPreview')) return fail(c, 403, 'A preview cannot change the payment method.')
    const b = await c.req.json().catch(() => ({} as any))
    const base = `${frontendUrl()}/portal`
    const out = await core.autopay.startSetup(c.get('portalCompanyId'), c.get('portalClientId'), { success: `${base}?saved=1`, cancel: `${base}?cancelled=1` }, null, { method: b?.method ? String(b.method) : 'card', by: 'client' })
    if ('problem' in out) return fail(c, out.status as any, out.problem, out.code)
    return one(c, out)
  })
  app.delete('/payment-method', portalAuth, async (c) => {
    const off = await paymentsOff(c); if (off) return off
    if (c.get('portalPreview')) return fail(c, 403, 'A preview cannot change the payment method.')
    if (!(await core.autopay.remove(c.get('portalCompanyId'), c.get('portalClientId')))) return fail(c, 404, 'There is no card or bank account on file.')
    return done(c)
  })

  // A payment on an invoice (Stripe): the client's own released, unpaid invoice.
  app.post('/invoices/:invoiceId/pay', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const invoiceId = c.req.param('invoiceId')!
    if (!process.env.STRIPE_SECRET_KEY) return fail(c, 400, 'Online payments are not configured')
    const [inv] = await db.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId), eq(invoices.clientId, clientId), clientVisibleInvoiceSql())).limit(1)
    if (!inv) return fail(c, 404, 'Invoice not found')
    if (inv.paymentStatus === 'paid') return fail(c, 400, 'Invoice already paid')
    // The agency's own account, and only when it takes cards (crm/cardPayments.ts) — this charged the platform's account,
    // and the whole total after a part payment.
    if (!(await cardPaymentsFor(d)(companyId).catch(() => false))) return fail(c, 400, 'This business does not take card payments online. Please contact them to pay another way.', 'payments_unavailable')
    const owed = visitInvoiceOwed(inv)
    if (owed <= 0) return fail(c, 400, 'This invoice has nothing left to pay.')
    const acct = await d.services.stripeService.connectedAccountFor(companyId)
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' as any })
    const amountCents = Math.round(owed * 100)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      metadata: { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, clientId },
      description: `Invoice ${inv.invoiceNumber}`,
    }, acct ? { stripeAccount: acct } : undefined)
    await db.update(invoices).set({ stripePaymentIntentId: paymentIntent.id, updatedAt: new Date() } as any)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
    return one(c, { clientSecret: paymentIntent.client_secret, amount: amountCents, invoiceNumber: inv.invoiceNumber })
  })

  app.get('/invoices/:invoiceId/pdf', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const invoiceId = c.req.param('invoiceId')!
    const [inv] = await db.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId), eq(invoices.clientId, clientId), clientVisibleInvoiceSql())).limit(1)
    if (!inv) return fail(c, 404, 'Invoice not found')
    const lineItems = await db.select().from(invoiceLineItems).where(and(eq(invoiceLineItems.invoiceId, invoiceId), eq(invoiceLineItems.companyId, companyId)))
    const [agency] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
    if (!agency) return fail(c, 404, 'Agency not found')
    const pdf = await generateInvoicePDF({ ...inv, lineItems }, agency, c.get('portalClient'))
    return c.body(new Uint8Array(pdf), 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${inv.invoiceNumber}.pdf"`,
    })
  })

  // The care plan: the client's details, active authorizations, emergency contacts, caregivers and medications.
  app.get('/care-plan', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const client = c.get('portalClient')
    const auths = await db.select().from(authorizations)
      .where(and(eq(authorizations.companyId, companyId), eq(authorizations.clientId, clientId), eq(authorizations.status, 'active')))
      .orderBy(desc(authorizations.startDate))
    const emergencyContacts = await db.select().from(clientEmergencyContacts)
      .where(and(eq(clientEmergencyContacts.companyId, companyId), eq(clientEmergencyContacts.clientId, clientId)))
    // The caregivers serving this client now — the same list as My Caregivers.
    const caregivers = (await caregiversServingClient(db, companyId, clientId, await core.time.today(companyId), true)).map((cg: any) => ({
      id: cg.caregiverId, firstName: cg.firstName, lastName: cg.lastName, phone: cg.phone, hoursPerWeek: cg.hoursPerWeek,
    }))
    const meds = await core.medications.medicationsOnFile(companyId, clientId, client.medications)
    return one(c, {
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
        // The Medications list, or (no rows) the client record's legacy note — core/medicationsOnFile.ts.
        medications: meds.lines,
        medicationsSource: meds.source,
        notes: client.notes,
        insuranceProvider: client.insuranceProvider,
        primaryDiagnosisCode: client.primaryDiagnosisCode,
      },
      authorizations: auths.map((a: typeof authorizations.$inferSelect) => ({
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
      caregivers,
    })
  })

  // ── Messages: the client's threads with the office (answered from /api/family-portal/admin/portal-threads) ──

  app.get('/messages', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const threads = await db.select().from(portalMessageThreads)
      .where(and(eq(portalMessageThreads.companyId, companyId), eq(portalMessageThreads.clientId, clientId)))
      .orderBy(desc(portalMessageThreads.lastMessageAt))
    const results = await Promise.all(threads.map(async (thread: typeof portalMessageThreads.$inferSelect) => {
      const [lastMessage] = await db.select().from(portalMessages)
        .where(and(eq(portalMessages.threadId, thread.id), eq(portalMessages.companyId, companyId)))
        .orderBy(desc(portalMessages.createdAt)).limit(1)
      const [msgCount] = await db.select({ value: count() }).from(portalMessages)
        .where(and(eq(portalMessages.threadId, thread.id), eq(portalMessages.companyId, companyId)))
      const hasUnread = !thread.clientLastReadAt || new Date(thread.lastMessageAt as any) > new Date(thread.clientLastReadAt)
      return { ...thread, lastMessage: lastMessage || null, messageCount: msgCount.value, hasUnread }
    }))
    return all(c, results)
  })

  // A new thread.
  app.post('/messages', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const client = c.get('portalClient')
    const { subject, body } = await c.req.json().catch(() => ({} as any))
    if (typeof subject !== 'string' || !subject.trim() || typeof body !== 'string' || !body.trim()) {
      return fail(c, 400, 'Subject and message body are required')
    }
    const [thread] = await db.insert(portalMessageThreads).values({
      companyId, clientId, subject: subject.trim(), lastMessageAt: new Date(), clientLastReadAt: new Date(),
    }).returning()
    const [message] = await db.insert(portalMessages).values({
      companyId, threadId: thread.id, senderType: 'client', senderName: `${client.firstName} ${client.lastName}`, body: body.trim(),
    }).returning()
    return one(c, { thread, message })
  })

  app.get('/messages/:threadId', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const threadId = c.req.param('threadId')!
    const [thread] = await db.select().from(portalMessageThreads)
      .where(and(eq(portalMessageThreads.id, threadId), eq(portalMessageThreads.companyId, companyId), eq(portalMessageThreads.clientId, clientId))).limit(1)
    if (!thread) return fail(c, 404, 'Thread not found')
    const msgs = await db.select().from(portalMessages)
      .where(and(eq(portalMessages.threadId, threadId), eq(portalMessages.companyId, companyId)))
      .orderBy(portalMessages.createdAt)
    return one(c, { thread, messages: msgs })
  })

  // A reply in a thread.
  app.post('/messages/:threadId', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const client = c.get('portalClient')
    const threadId = c.req.param('threadId')!
    const { body } = await c.req.json().catch(() => ({} as any))
    if (typeof body !== 'string' || !body.trim()) return fail(c, 400, 'Message body is required')
    const [thread] = await db.select().from(portalMessageThreads)
      .where(and(eq(portalMessageThreads.id, threadId), eq(portalMessageThreads.companyId, companyId), eq(portalMessageThreads.clientId, clientId))).limit(1)
    if (!thread) return fail(c, 404, 'Thread not found')
    const [message] = await db.insert(portalMessages).values({
      companyId, threadId, senderType: 'client', senderName: `${client.firstName} ${client.lastName}`, body: body.trim(),
    }).returning()
    await db.update(portalMessageThreads).set({ lastMessageAt: new Date(), clientLastReadAt: new Date(), updatedAt: new Date() })
      .where(and(eq(portalMessageThreads.id, threadId), eq(portalMessageThreads.companyId, companyId)))
    return one(c, message)
  })

  app.post('/messages/:threadId/read', portalAuth, async (c) => {
    await db.update(portalMessageThreads).set({ clientLastReadAt: new Date(), updatedAt: new Date() })
      .where(and(eq(portalMessageThreads.id, c.req.param('threadId')!), eq(portalMessageThreads.companyId, c.get('portalCompanyId')), eq(portalMessageThreads.clientId, c.get('portalClientId'))))
    return done(c)
  })

  // ── Notifications (the office's notices to the client) ──

  app.get('/notifications', portalAuth, async (c) => {
    const rows = await db.select().from(clientNotifications)
      .where(and(eq(clientNotifications.companyId, c.get('portalCompanyId')), eq(clientNotifications.clientId, c.get('portalClientId'))))
      .orderBy(desc(clientNotifications.createdAt))
      .limit(50)
    return all(c, rows)
  })

  const markRead = async (c: Context<PortalEnv>) => {
    await db.update(clientNotifications).set({ isRead: true })
      .where(and(eq(clientNotifications.id, c.req.param('id')!), eq(clientNotifications.companyId, c.get('portalCompanyId')), eq(clientNotifications.clientId, c.get('portalClientId'))))
    return done(c)
  }
  const markAllRead = async (c: Context<PortalEnv>) => {
    await db.update(clientNotifications).set({ isRead: true })
      .where(and(eq(clientNotifications.companyId, c.get('portalCompanyId')), eq(clientNotifications.clientId, c.get('portalClientId')), eq(clientNotifications.isRead, false)))
    return done(c)
  }
  // read-all before /:id/read, so "read-all" is never taken for an id. POST, and PUT for the older screens.
  app.post('/notifications/read-all', portalAuth, markAllRead)
  app.put('/notifications/read-all', portalAuth, markAllRead)
  app.post('/notifications/:id/read', portalAuth, markRead)
  app.put('/notifications/:id/read', portalAuth, markRead)

  // ── Signable documents: the client (or whoever holds their portal access) signs the agency's paperwork here.
  // Staff-side sending and the certificate view are the clients group's (routes/clientDocuments.ts). ──

  // This client's documents. Void ones are not shown — they were withdrawn.
  app.get('/documents', portalAuth, async (c) => {
    const rows = await db.select({
      id: clientDocuments.id,
      title: clientDocuments.title,
      status: clientDocuments.status,
      sentAt: clientDocuments.sentAt,
      signedAt: clientDocuments.signedAt,
      signedBy: clientDocuments.signedBy,
      declinedAt: clientDocuments.declinedAt,
    }).from(clientDocuments)
      .where(and(eq(clientDocuments.companyId, c.get('portalCompanyId')), eq(clientDocuments.clientId, c.get('portalClientId')), ne(clientDocuments.status, 'void')))
      .orderBy(desc(clientDocuments.sentAt))
    return all(c, rows)
  })

  const documentOf = async (c: Context<PortalEnv>) => {
    const [doc] = await db.select().from(clientDocuments)
      .where(and(eq(clientDocuments.id, c.req.param('id')!), eq(clientDocuments.companyId, c.get('portalCompanyId')), eq(clientDocuments.clientId, c.get('portalClientId')))).limit(1)
    return doc && doc.status !== 'void' ? doc as typeof clientDocuments.$inferSelect : null
  }

  // Open one. Opening marks it viewed, which is part of the evidence trail.
  app.get('/documents/:id', portalAuth, async (c) => {
    const doc = await documentOf(c)
    if (!doc) return fail(c, 404, 'Document not found')
    // An administrator's preview must not stamp the document as seen by the client.
    if (!doc.viewedAt && !c.get('portalPreview')) {
      await db.update(clientDocuments).set({ viewedAt: new Date(), status: doc.status === 'sent' ? 'viewed' : doc.status, updatedAt: new Date() } as any)
        .where(and(eq(clientDocuments.id, doc.id), eq(clientDocuments.companyId, doc.companyId)))
    }
    return one(c, doc)
  })

  app.post('/documents/:id/sign', portalAuth, async (c) => {
    const clientId = c.get('portalClientId')
    const companyId = c.get('portalCompanyId')
    const body = await c.req.json().catch(() => ({} as any))
    const validation = validateSignatureInput(body)
    if (!validation.ok) return fail(c, 400, validation.error)
    const doc = await documentOf(c)
    if (!doc) return fail(c, 404, 'Document not found')
    // Signing twice would overwrite the first signature's evidence.
    if (doc.status === 'signed') return fail(c, 400, 'This document has already been signed')
    const relationship = typeof body?.signerRelationship === 'string' && body.signerRelationship.trim() ? body.signerRelationship.trim().slice(0, 100) : 'Self'
    const now = new Date()
    // Hash the text that was actually on screen, so the signature is bound to this wording and not to whatever the
    // template says later.
    const hash = documentFingerprint({ id: doc.id, title: doc.title, body: doc.body, clientId: doc.clientId, signedBy: validation.signerName, signedAt: now.toISOString() })
    const [updated] = await db.update(clientDocuments).set({
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
    } as any).where(and(eq(clientDocuments.id, doc.id), eq(clientDocuments.companyId, companyId))).returning()
    try {
      await db.insert(auditLogs).values({
        companyId,
        userId: 'client:' + clientId,
        action: 'client_document.signed',
        tableName: 'client_documents',
        recordId: doc.id,
        newData: { title: doc.title, signedBy: validation.signerName, relationship, documentHash: hash } as any,
        ipAddress: signerIp(c),
      } as any)
    } catch (err) {
      // The signature is saved; a missing audit row must not undo it.
      d.logger.error('[portal] audit write failed for signed document', { error: (err as Error).message })
    }
    return one(c, updated)
  })

  app.post('/documents/:id/decline', portalAuth, async (c) => {
    const body = await c.req.json().catch(() => ({} as any))
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 1000) : ''
    const doc = await documentOf(c)
    if (!doc) return fail(c, 404, 'Document not found')
    if (doc.status === 'signed') return fail(c, 400, 'This document has already been signed')
    const [updated] = await db.update(clientDocuments).set({ status: 'declined', declinedAt: new Date(), declineReason: reason || null, updatedAt: new Date() } as any)
      .where(and(eq(clientDocuments.id, doc.id), eq(clientDocuments.companyId, doc.companyId))).returning()
    return one(c, updated)
  })

  // ── Who serves this client (shared with the family portal and the reschedule picker) ──

  /** A caregiver's background checks, SUMMARY ONLY — never findings, notes, cost or reference numbers — and only for a caregiver serving this client. */
  async function backgroundCheckSummary(companyId: string, caregiverId: string, clientId: string) {
    if (!(await servesClient(db, companyId, caregiverId, clientId, await core.time.today(companyId)))) return null
    return db.select({
      id: backgroundChecks.id,
      checkType: backgroundChecks.checkType,
      provider: backgroundChecks.provider,
      status: backgroundChecks.status,
      initiatedDate: backgroundChecks.initiatedDate,
      expirationDate: backgroundChecks.expirationDate,
    }).from(backgroundChecks)
      .where(and(eq(backgroundChecks.companyId, companyId), eq(backgroundChecks.caregiverId, caregiverId)))
      .orderBy(desc(backgroundChecks.initiatedDate))
  }

  return { router: app, portalAuth, backgroundCheckSummary }
}

export type ClientPortal = ReturnType<typeof createClientPortalRoutes>
