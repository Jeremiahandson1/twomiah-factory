import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { referralSources } from '../../db/schema.ts'
import { eq, and, asc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/referral-sources
app.get('/', async (c) => {
  const { type } = c.req.query()
  const conditions: any[] = [eq(referralSources.isActive, true)]
  if (type) conditions.push(eq(referralSources.type, type))

  const rows = await db
    .select()
    .from(referralSources)
    .where(and(...conditions))
    .orderBy(asc(referralSources.name))

  return c.json(rows)
})

// The Referral Sources screen edits who refers clients: these fields only. A payer's billing and Sandata
// settings on the same row belong to /api/payers, so a body here can never rewrite payer_type, the Sandata
// codes, is_active or the id.
const REFERRAL_FIELDS = ['name', 'type', 'contactName', 'email', 'phone', 'address', 'city', 'state', 'zip', 'notes'] as const
function referralData(body: any): Record<string, any> {
  const data: Record<string, any> = {}
  for (const k of REFERRAL_FIELDS) if (body?.[k] !== undefined) data[k] = body[k] === null ? null : String(body[k]).trim() || null
  return data
}

// POST /api/referral-sources — office only (payers carry billing and Sandata EVV settings)
app.post('/', requireAdmin, async (c) => {
  const data = referralData(await c.req.json().catch(() => null))
  if (!data.name) return c.json({ error: 'Name is required' }, 400)
  const [row] = await db.insert(referralSources).values(data as any).returning()
  return c.json(row, 201)
})

// PUT /api/referral-sources/:id
app.put('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const data = referralData(await c.req.json().catch(() => null))
  if (data.name === null) return c.json({ error: 'Name is required' }, 400)
  const [row] = await db
    .update(referralSources)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(referralSources.id, id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// Delete was missing entirely — the UI's delete control 404'd. (M-14)
app.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const [row] = await db.delete(referralSources).where(eq(referralSources.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

export default app
