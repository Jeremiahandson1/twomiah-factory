import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { unit, company } from '../../db/schema.ts'
import { eq, and, inArray, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { createId } from '@paralleldrive/cuid2'

/**
 * Marketplace syndication — export available inventory as a normalized feed for
 * RV Trader, RVUSA, RVT.com, Cycle Trader, ATV Trader and Boat Trader. Two ways
 * to consume it:
 *   1. Authenticated pull/export (JSON/CSV/XML) for the dealer or their rep.
 *   2. A per-dealer **public tokenized feed URL** the marketplaces pull on a
 *      schedule: GET /api/public/feed/:token/inventory.(json|csv|xml).
 * The token lives on company.feedToken (rotatable).
 */

const LISTABLE = ['available', 'pending']

function toListing(u: any) {
  return {
    stockNumber: u.stockNumber || u.id,
    vin: u.vin || '',
    hin: u.hin || '',
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
    // marine
    beamFt: u.beamFt || '',
    draftFt: u.draftFt || '',
    hullMaterial: u.hullMaterial || '',
    engineType: u.engineType || '',
    engineCount: u.engineCount ?? '',
    engineHp: u.engineHp ?? '',
    fuelCapacityGal: u.fuelCapacityGal ?? '',
    maxPersons: u.maxPersons ?? '',
    trailerIncluded: u.trailerIncluded === true ? 'yes' : u.trailerIncluded === false ? 'no' : '',
    exteriorColor: u.exteriorColor || '',
    photoUrls: Array.isArray(u.photos) ? u.photos.join('|') : '',
    description: (u.description || '').replace(/[\r\n]+/g, ' ').trim(),
  }
}

function toCsv(rows: Record<string, any>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const esc = (v: any) => {
    let s = String(v ?? '')
    // Neutralize CSV formula injection — Excel/Sheets execute cells beginning
    // with = + - @ (or a leading tab/CR). Prefix with a single quote.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(',')]
  for (const r of rows) lines.push(headers.map(h => esc(r[h])).join(','))
  return lines.join('\n')
}

function xmlEscape(s: any): string {
  return String(s ?? '').replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch] as string))
}

function toXml(rows: Record<string, any>[]): string {
  const items = rows.map(r => {
    const fields = Object.entries(r).map(([k, v]) => `    <${k}>${xmlEscape(v)}</${k}>`).join('\n')
    return `  <listing>\n${fields}\n  </listing>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<inventory generatedAt="${new Date().toISOString()}" count="${rows.length}">\n${items}\n</inventory>\n`
}

async function buildFeed(companyId: string, statuses: string[]) {
  const units = await db.select().from(unit)
    .where(and(eq(unit.companyId, companyId), inArray(unit.status, statuses.length ? statuses : LISTABLE)))
    .orderBy(desc(unit.updatedAt))
  return units.map(toListing)
}

function respondFeed(c: any, listings: Record<string, any>[], format: string) {
  if (format === 'csv') {
    return c.body(toCsv(listings), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="inventory-feed.csv"' })
  }
  if (format === 'xml') {
    return c.body(toXml(listings), 200, { 'Content-Type': 'application/xml; charset=utf-8' })
  }
  return c.json({ generatedAt: new Date().toISOString(), count: listings.length, listings })
}

function publicFeedUrl(c: any, token: string): string {
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || ''
  const proto = c.req.header('x-forwarded-proto') || 'https'
  return host ? `${proto}://${host}/api/public/feed/${token}/inventory.csv` : `/api/public/feed/${token}/inventory.csv`
}

// ─── Authenticated dealer routes ─────────────────────────────────────────────
const app = new Hono()
app.use('*', authenticate)

// GET /syndication/feed?format=json|csv|xml&status=available,pending
app.get('/feed', requirePermission('contacts:read'), async (c) => {
  const user = c.get('user') as any
  const format = (c.req.query('format') || 'json').toLowerCase()
  const statusParam = c.req.query('status')
  const statuses = statusParam ? statusParam.split(',').filter(s => LISTABLE.includes(s)) : LISTABLE
  const listings = await buildFeed(user.companyId, statuses)
  return respondFeed(c, listings, format)
})

// GET /syndication/token — current public feed token + URLs (creates one if absent)
app.get('/token', requirePermission('contacts:read'), async (c) => {
  const user = c.get('user') as any
  let [comp] = await db.select().from(company).where(eq(company.id, user.companyId)).limit(1)
  if (!comp) return c.json({ error: 'Company not found' }, 404)
  let token = comp.feedToken
  if (!token) {
    token = createId()
    await db.update(company).set({ feedToken: token }).where(eq(company.id, comp.id))
  }
  const base = publicFeedUrl(c, token).replace(/\.csv$/, '')
  return c.json({ token, urls: { csv: base + '.csv', json: base + '.json', xml: base + '.xml' } })
})

// POST /syndication/token/rotate — issue a fresh token (invalidates the old URL)
app.post('/token/rotate', requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const token = createId()
  await db.update(company).set({ feedToken: token }).where(eq(company.id, user.companyId))
  const base = publicFeedUrl(c, token).replace(/\.csv$/, '')
  return c.json({ token, urls: { csv: base + '.csv', json: base + '.json', xml: base + '.xml' } })
})

export default app

// ─── Public feed (NO auth — marketplaces pull this). Mounted at /api/public/feed ──
export const syndicationPublic = new Hono()

syndicationPublic.get('/:token/:file', async (c) => {
  const token = c.req.param('token')
  const file = c.req.param('file') // inventory.csv | inventory.json | inventory.xml
  if (!token) return c.json({ error: 'Missing feed token' }, 400)
  const [comp] = await db.select().from(company).where(eq(company.feedToken, token)).limit(1)
  if (!comp) return c.json({ error: 'Invalid feed token' }, 404)
  const ext = (file.split('.').pop() || 'json').toLowerCase()
  const format = ext === 'csv' ? 'csv' : ext === 'xml' ? 'xml' : 'json'
  const listings = await buildFeed(comp.id, LISTABLE)
  return respondFeed(c, listings, format)
})
