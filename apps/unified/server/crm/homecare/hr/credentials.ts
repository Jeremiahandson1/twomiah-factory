// /api/credentials — the credential tracking screens (care_cert_reminders, not ready): a search across every caregiver's
// credentials, the agency's reminder settings (lead times, email, and whether an expired credential blocks a shift), and the
// credentials kept for clients. Gated by the feature in the mount, and by care-hr permissions on every action.
import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { clientCredential, clients } from '../../../db/schema/index.ts'
import { searchCredentials } from '../../../data/homecareCertReminders.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { CERT_LEAD_CHOICES } from '../core/certReminders.ts'
import { body, companyOf, dayOrNull, idOf } from './shared.ts'

export function createCredentialsRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions

  // GET /api/credentials/search?type=&caregiverId=&expired=true&withinDays=30&status=&page=&limit=
  app.get('/search', requirePermission('care-hr:read'), async (c) => {
    const companyId = companyOf(c)
    const q = c.req.query()
    const page = Math.max(1, Number(q.page) || 1)
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50))
    const within = q.withinDays === undefined || q.withinDays === '' ? undefined : Number(q.withinDays)
    if (within !== undefined && (!Number.isInteger(within) || within < 0 || within > 3650)) return fail(c, 400, 'withinDays must be a whole number of days, 0 to 3650.', 'bad_within_days', { withinDays: 'Enter a number of days' })
    const today = await core.time.today(companyId)
    const { rows, total } = await searchCredentials(d.db, companyId, today, {
      type: q.type?.trim() || undefined, caregiverId: q.caregiverId || undefined, expired: q.expired === 'true',
      withinDays: within, status: q.status || undefined, limit, offset: (page - 1) * limit,
    })
    return list(c, rows.map((r: any) => ({ ...r, state: r.daysLeft == null ? 'no_expiry' : r.daysLeft < 0 ? 'expired' : r.daysLeft <= 30 ? 'expiring_soon' : 'ok' })), { page, limit, total })
  })

  // GET /api/credentials/settings — the agency's choices (and the lead times it may pick from)
  app.get('/settings', requirePermission('care-hr:read'), async (c) => {
    return one(c, { ...(await core.certReminders.settings(companyOf(c))), leadChoices: [...CERT_LEAD_CHOICES] })
  })

  // PUT /api/credentials/settings { leadDays?, email?, blockExpired? }
  app.put('/settings', requirePermission('care-hr:update'), async (c) => {
    const b = await body(c)
    if (b.leadDays !== undefined) {
      const ok = Array.isArray(b.leadDays) && b.leadDays.length > 0 && b.leadDays.every((n: unknown) => (CERT_LEAD_CHOICES as readonly number[]).includes(Number(n)))
      if (!ok) return fail(c, 400, 'Pick one or more of 90, 60, 30, 14 and 0 days.', 'bad_lead_days', { leadDays: 'Pick from 90, 60, 30, 14, 0' })
    }
    const next = await core.certReminders.setSettings(companyOf(c), { leadDays: b.leadDays, email: b.email, blockExpired: b.blockExpired })
    return one(c, { ...next, leadChoices: [...CERT_LEAD_CHOICES] })
  })

  // ── Credentials kept for clients (HR / compliance records: care-hr, not the caregiver's care-clients) ───────────
  // GET /api/credentials/clients?clientId=
  app.get('/clients', requirePermission('care-hr:read'), async (c) => {
    const companyId = companyOf(c)
    const clientId = c.req.query('clientId')
    const rows = await d.db.select({
      id: clientCredential.id, clientId: clientCredential.clientId, credentialType: clientCredential.credentialType, issuingBody: clientCredential.issuingBody,
      issueDate: clientCredential.issueDate, expiryDate: clientCredential.expiryDate, documentUrl: clientCredential.documentUrl, status: clientCredential.status,
      clientFirstName: clients.firstName, clientLastName: clients.lastName,
    }).from(clientCredential).innerJoin(clients, eq(clients.id, clientCredential.clientId))
      .where(and(eq(clientCredential.companyId, companyId), clientId ? eq(clientCredential.clientId, clientId) : undefined))
      .orderBy(desc(clientCredential.createdAt)).limit(500)
    return list(c, rows, { page: 1, limit: 500, total: rows.length })
  })

  // POST /api/credentials/clients { clientId, credentialType, expiryDate?, issueDate?, issuingBody?, documentUrl? }
  app.post('/clients', requirePermission('care-hr:update'), async (c) => {
    const companyId = companyOf(c)
    const b = await body(c)
    if (!b.clientId || !String(b.credentialType || '').trim()) return fail(c, 400, 'clientId and credentialType are required', undefined, { credentialType: 'Say what the credential is' })
    const [cl] = await d.db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, String(b.clientId)), eq(clients.companyId, companyId))).limit(1)
    if (!cl) return fail(c, 404, 'Client not found')
    const expiry = b.expiryDate ? dayOrNull(b.expiryDate) : null
    if (b.expiryDate && !expiry) return fail(c, 400, 'expiryDate must be YYYY-MM-DD', undefined, { expiryDate: 'Use year-month-day' })
    const [row] = await d.db.insert(clientCredential).values({
      companyId, clientId: cl.id, credentialType: String(b.credentialType).trim(), issuingBody: b.issuingBody || null,
      issueDate: dayOrNull(b.issueDate), expiryDate: expiry, documentUrl: b.documentUrl || null, status: b.status || 'active',
    }).returning()
    return one(c, row, 201)
  })

  // DELETE /api/credentials/clients/:id
  app.delete('/clients/:id', requirePermission('care-hr:update'), async (c) => {
    const [row] = await d.db.delete(clientCredential)
      .where(and(eq(clientCredential.id, idOf(c)), eq(clientCredential.companyId, companyOf(c)))).returning({ id: clientCredential.id })
    if (!row) return fail(c, 404, 'Credential not found')
    return done(c)
  })

  return app
}
