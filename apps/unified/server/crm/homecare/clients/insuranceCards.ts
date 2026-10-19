// Insurance card photos — front and back of a client's primary insurance card, kept on the client as base64 data URIs
// (~5 MB raw each). Office only. Moved from templates/crm-homecare/backend/src/routes/insuranceCards.ts.
//
//   GET /api/insurance-cards/:clientId?side=front|back   → { side, image, uploadedAt }
//   PUT /api/insurance-cards/:clientId                   { side, imageBase64 }  (null clears that side)
//
// Permissions: both were admin-only: care-clients:update (a caregiver does not hold it).
// Reply: uploaded_at is uploadedAt (camelCase).
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { clients } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { body, who } from './shared.ts'

export const MAX_CARD_CHARS = 7_000_000

export function createInsuranceCardRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d
  app.use('*', requirePermission('care-clients:update'))

  app.get('/:clientId', async (c) => {
    const { companyId } = who(c)
    const side = c.req.query('side') === 'back' ? 'back' : 'front'
    const [row] = await db.select({ front: clients.insuranceCardFront, back: clients.insuranceCardBack, uploadedAt: clients.insuranceCardUploadedAt })
      .from(clients).where(and(eq(clients.id, c.req.param('clientId')), eq(clients.companyId, companyId))).limit(1)
    if (!row) return fail(c, 404, 'Client not found')
    return one(c, { side, image: side === 'front' ? row.front : row.back, uploadedAt: row.uploadedAt })
  })

  app.put('/:clientId', async (c) => {
    const { user, companyId } = who(c)
    const { side, imageBase64 } = await body(c)
    if (!['front', 'back'].includes(side)) return fail(c, 400, 'side must be front or back')
    if (imageBase64 != null && !String(imageBase64).startsWith('data:image')) return fail(c, 400, 'imageBase64 must be a data URI (or null to clear)')
    if (imageBase64 && String(imageBase64).length > MAX_CARD_CHARS) return fail(c, 400, 'Image too large (max ~5MB raw)')
    const set = side === 'front' ? { insuranceCardFront: imageBase64 || null } : { insuranceCardBack: imageBase64 || null }
    const [row] = await db.update(clients).set({ ...set, insuranceCardUploadedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(clients.id, c.req.param('clientId')), eq(clients.companyId, companyId)))
      .returning({ id: clients.id, uploadedAt: clients.insuranceCardUploadedAt })
    if (!row) return fail(c, 404, 'Client not found')
    await core.careAudit.writeCareAudit(user, 'UPDATE', 'clients', row.id, { insuranceCard: side, cleared: !imageBase64 })
    return one(c, { success: true, side, cleared: !imageBase64, uploadedAt: row.uploadedAt })
  })

  return app
}
