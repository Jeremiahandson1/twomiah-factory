import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { remittanceBatches, remittanceLineItems, referralSources } from '../../db/schema.ts'
import { eq, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

app.get('/', async (c) => {
  const rows = await db.select({
    batch: remittanceBatches,
    payerName: referralSources.name,
  })
    .from(remittanceBatches)
    .leftJoin(referralSources, eq(remittanceBatches.payerId, referralSources.id))
    .orderBy(desc(remittanceBatches.createdAt))

  const batchIds = rows.map(r => r.batch.id)
  let lineItemsByBatch: Record<string, any[]> = {}

  if (batchIds.length > 0) {
    const { inArray } = await import('drizzle-orm')
    const items = await db.select().from(remittanceLineItems).where(inArray(remittanceLineItems.batchId, batchIds))
    items.forEach(li => {
      if (!lineItemsByBatch[li.batchId]) lineItemsByBatch[li.batchId] = []
      lineItemsByBatch[li.batchId].push(li)
    })
  }

  const result = rows.map(r => ({
    ...r.batch,
    payer: r.payerName ? { name: r.payerName } : null,
    lineItems: lineItemsByBatch[r.batch.id] || [],
  }))

  return c.json(result)
})

// GET /api/remittance/payers — payers are modeled as referral sources here.
// (The Remittance screen called this and 404'd, so it rendered empty.)
app.get('/payers', async (c) => {
  const rows = await db.select({ id: referralSources.id, name: referralSources.name, type: referralSources.type })
    .from(referralSources)
    .orderBy(referralSources.name)
  return c.json(rows)
})

// GET /api/remittance/payer-summary — remittance totals grouped by payer
app.get('/payer-summary', async (c) => {
  const rows = await db.select({
    batch: remittanceBatches,
    payerName: referralSources.name,
  })
    .from(remittanceBatches)
    .leftJoin(referralSources, eq(remittanceBatches.payerId, referralSources.id))

  const num = (v: any) => Number(v || 0)
  const byPayer: Record<string, { payerId: string | null; payerName: string; batches: number; totalPaid: number }> = {}
  for (const r of rows) {
    const key = r.batch.payerId || 'unassigned'
    if (!byPayer[key]) byPayer[key] = { payerId: r.batch.payerId ?? null, payerName: r.payerName || 'Unassigned', batches: 0, totalPaid: 0 }
    byPayer[key].batches++
    byPayer[key].totalPaid += num((r.batch as any).totalPaid ?? (r.batch as any).totalAmount)
  }
  return c.json(Object.values(byPayer).map(p => ({ ...p, totalPaid: Number(p.totalPaid.toFixed(2)) })))
})

app.post('/', async (c) => {
  const { lineItems: lineItemsData, ...data } = await c.req.json()
  const user = c.get('user')

  const [batch] = await db.insert(remittanceBatches).values({
    ...data,
    createdById: user.userId,
  }).returning()

  let createdLineItems: any[] = []
  if (lineItemsData && lineItemsData.length > 0) {
    createdLineItems = await db.insert(remittanceLineItems)
      .values(lineItemsData.map((li: any) => ({ ...li, batchId: batch.id })))
      .returning()
  }

  return c.json({ ...batch, lineItems: createdLineItems }, 201)
})

app.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [batch] = await db.update(remittanceBatches)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(remittanceBatches.id, id))
    .returning()

  return c.json(batch)
})

export default app
