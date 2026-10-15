// Insurance card photos — front and back of a client's primary insurance card, kept on the client
// as base64 data URIs (~5 MB raw each). Office only.
//
//   GET /api/insurance-cards/:clientId?side=front|back   → { side, image, uploaded_at }
//   PUT /api/insurance-cards/:clientId                   { side, imageBase64 }  (null clears that side)
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { clients } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { writeCareAudit } from '../helpers/careAudit.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

export const MAX_CARD_CHARS = 7_000_000

app.get('/:clientId', async (c) => {
  const side = c.req.query('side') === 'back' ? 'back' : 'front'
  const [row] = await db.select({
    front: clients.insuranceCardFront, back: clients.insuranceCardBack, uploadedAt: clients.insuranceCardUploadedAt,
  }).from(clients).where(eq(clients.id, c.req.param('clientId'))).limit(1)
  if (!row) return c.json({ error: 'Client not found' }, 404)
  return c.json({ side, image: side === 'front' ? row.front : row.back, uploaded_at: row.uploadedAt })
})

app.put('/:clientId', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const { side, imageBase64 } = b || {}
  if (!['front', 'back'].includes(side)) return c.json({ error: 'side must be front or back' }, 400)
  if (imageBase64 != null && !String(imageBase64).startsWith('data:image')) {
    return c.json({ error: 'imageBase64 must be a data URI (or null to clear)' }, 400)
  }
  if (imageBase64 && String(imageBase64).length > MAX_CARD_CHARS) return c.json({ error: 'Image too large (max ~5MB raw)' }, 400)
  const set = side === 'front'
    ? { insuranceCardFront: imageBase64 || null }
    : { insuranceCardBack: imageBase64 || null }
  const [row] = await db.update(clients)
    .set({ ...set, insuranceCardUploadedAt: new Date(), updatedAt: new Date() })
    .where(eq(clients.id, c.req.param('clientId')))
    .returning({ id: clients.id, uploadedAt: clients.insuranceCardUploadedAt })
  if (!row) return c.json({ error: 'Client not found' }, 404)
  await writeCareAudit(c.get('user' as any), 'UPDATE', 'clients', row.id, { insuranceCard: side, cleared: !imageBase64 })
  return c.json({ success: true, side, cleared: !imageBase64, uploaded_at: row.uploadedAt })
})

export default app
