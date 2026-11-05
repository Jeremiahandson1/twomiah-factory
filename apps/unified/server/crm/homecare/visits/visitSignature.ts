// /api/visit-signature — the client's signature on every visit (care_visit_signature, not ready), with a reason list for a client who
// cannot sign.
//
//   Phone:    GET /config                          { required, reasons }   evv:read
//   Office:   GET|PUT /settings { required }      whether a live clock-out waits for the signature (or a reason)   care-clients:update
//   The visit (the caregiver's own, or the office):
//             GET /visit/:timeEntryId              { required, reasons, signature }  what is recorded, and the reason list
//             PUT /visit/:timeEntryId { signature | reasonCode (+ note), savedAt? }   evv:update — record it (replaces an earlier one)
// Gated by the feature in the mount; replies follow RULEBOOK §3.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { timeEntries } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { NO_SIGNATURE_REASONS } from '../core/visitSignature.ts'
import { body, who, type ClientAccess } from '../clients/shared.ts'

export function createVisitSignatureRoutes(core: HomecareCore, d: CrmDeps, access: ClientAccess) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d
  const reasons = NO_SIGNATURE_REASONS.map((r) => ({ code: r.code, label: r.label }))

  const loadEntry = async (companyId: string, id: string) =>
    (await db.select({ id: timeEntries.id, clientId: timeEntries.clientId, caregiverId: timeEntries.caregiverId }).from(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId))).limit(1))[0]

  app.get('/settings', requirePermission('care-clients:update'), async (c) => {
    return one(c, { ...(await core.visitSignature.settings(who(c).companyId)), reasons })
  })
  app.put('/settings', requirePermission('care-clients:update'), async (c) => {
    const b = await body(c)
    if (b.required !== undefined && typeof b.required !== 'boolean') return fail(c, 400, 'Say whether the signature is required: on or off.', 'bad_required', { required: 'On or off' })
    return one(c, { ...(await core.visitSignature.setSettings(who(c).companyId, { required: b.required })), reasons })
  })

  // The phone asks this before any visit (and keeps the answer): is the signature required, and what reasons can be picked.
  app.get('/config', requirePermission('evv:read'), async (c) => {
    return one(c, { required: (await core.visitSignature.settings(who(c).companyId)).required, reasons })
  })

  app.get('/visit/:timeEntryId', requirePermission('care-clients:read'), async (c) => {
    const { user, companyId, me } = who(c)
    const entry = await loadEntry(companyId, c.req.param('timeEntryId')!)
    if (!entry) return fail(c, 404, 'Visit not found')
    if (entry.caregiverId !== me && !access.office(user)) return fail(c, 403, 'Not your shift')
    return one(c, { required: (await core.visitSignature.settings(companyId)).required, reasons, signature: await core.visitSignature.forVisit(companyId, entry.id) })
  })

  app.put('/visit/:timeEntryId', requirePermission('evv:update'), async (c) => {
    const { user, companyId, me } = who(c)
    const b = await body(c)
    const entry = await loadEntry(companyId, c.req.param('timeEntryId')!)
    if (!entry) return fail(c, 404, 'Visit not found')
    if (entry.caregiverId !== me && !access.office(user)) return fail(c, 403, 'Not your shift')
    const refused = await access.careWriteRefusal(c, entry.clientId)
    if (refused) return refused

    const res = await core.visitSignature.record(companyId, entry, me, b)
    if (!res.ok) return fail(c, 400, res.message, res.code, res.fields)
    return one(c, { signature: res.state })
  })

  return app
}
