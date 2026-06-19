import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { unit } from '../../db/schema.ts'
import { eq, and, inArray, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

/**
 * Marketplace syndication — export available inventory as a normalized feed
 * for RV Trader, RVUSA, RVT.com, Cycle Trader and ATV Trader. Most marketplaces
 * ingest a JSON or CSV/tab feed; we generate the listing rows here. (Wiring a
 * tokenized public pull URL per dealer is a follow-up that needs a feed-token
 * column; for now the feed is generated on demand for the authenticated dealer
 * to export or hand to their marketplace rep.)
 */

const app = new Hono()
app.use('*', authenticate)

// Only list-able statuses go out to marketplaces.
const LISTABLE = ['available', 'pending']

function toListing(u: any) {
  return {
    stockNumber: u.stockNumber || u.id,
    vin: u.vin || '',
    condition: u.condition || 'used',
    category: u.category,
    rvClass: u.rvClass || '',
    towableType: u.towableType || '',
    year: u.year || '',
    make: u.make || '',
    model: u.modelName || '',
    trim: u.trim || '',
    price: u.internetPrice || u.listedPrice || '',
    msrp: u.msrp || '',
    lengthFt: u.lengthFt || '',
    sleeps: u.sleeps ?? '',
    slideOuts: u.slideOuts ?? '',
    engineCc: u.engineCc ?? '',
    hours: u.hours ?? '',
    mileage: u.mileage ?? '',
    exteriorColor: u.exteriorColor || '',
    photoUrls: Array.isArray(u.photos) ? u.photos.join('|') : '',
    description: (u.description || '').replace(/[\r\n]+/g, ' ').trim(),
  }
}

function toCsv(rows: Record<string, any>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const esc = (v: any) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(',')]
  for (const r of rows) lines.push(headers.map(h => esc(r[h])).join(','))
  return lines.join('\n')
}

// GET /syndication/feed?format=json|csv&status=available,pending
app.get('/feed', requirePermission('contacts:read'), async (c) => {
  const user = c.get('user') as any
  const format = (c.req.query('format') || 'json').toLowerCase()
  const statusParam = c.req.query('status')
  const statuses = statusParam ? statusParam.split(',').filter(s => LISTABLE.includes(s)) : LISTABLE

  const units = await db.select().from(unit)
    .where(and(eq(unit.companyId, user.companyId), inArray(unit.status, statuses.length ? statuses : LISTABLE)))
    .orderBy(desc(unit.updatedAt))

  const listings = units.map(toListing)

  if (format === 'csv') {
    return new Response(toCsv(listings), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="inventory-feed.csv"',
      },
    })
  }

  return c.json({ generatedAt: new Date().toISOString(), count: listings.length, listings })
})

export default app
