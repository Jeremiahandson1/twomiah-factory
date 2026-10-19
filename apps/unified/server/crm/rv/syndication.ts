// Marketplace syndication: the dealer's available inventory as a feed for RV Trader, RVUSA, RVT.com, Cycle Trader, ATV
// Trader and Boat Trader — the dealer's own export (signed in), and a public per-dealer tokenised URL the marketplaces
// pull. The token lives on company.feedToken. Moved from templates/crm-rv/backend/src/routes/syndication.ts.
import { Hono } from 'hono'
import { eq, and, inArray, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { unit, company } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

// What the public marketplace feed lists: units a buyer can actually buy. A pending unit (a sale in progress) is not
// advertised; the dealer's own export can still include it explicitly with ?status=available,pending.
// (RV T19 M1: pending units still appeared in the public feed)
const LISTABLE = ['available']
const EXPORTABLE = ['available', 'pending']

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

function respondFeed(c: any, listings: Record<string, any>[], format: string) {
  if (format === 'csv') {
    return c.body(toCsv(listings), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="inventory-feed.csv"' })
  }
  if (format === 'xml') return c.body(toXml(listings), 200, { 'Content-Type': 'application/xml; charset=utf-8' })
  return one(c, { generatedAt: new Date().toISOString(), count: listings.length, listings })
}

function publicFeedUrl(c: any, token: string): string {
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || ''
  const proto = c.req.header('x-forwarded-proto') || 'https'
  return host ? `${proto}://${host}/api/public/feed/${token}/inventory.csv` : `/api/public/feed/${token}/inventory.csv`
}

function feedOf(db: any) {
  return async (companyId: string, statuses: string[]) => {
    const units = await db.select().from(unit)
      .where(and(eq(unit.companyId, companyId), inArray(unit.status, statuses.length ? statuses : LISTABLE)))
      .orderBy(desc(unit.updatedAt))
    return units.map(toListing)
  }
}

/** The dealer's own export and the feed token (signed in). */
export function createSyndicationRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const buildFeed = feedOf(db)
  const app = new Hono<AppEnv>()

  // GET /feed?format=json|csv|xml&status=available,pending
  app.get('/feed', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user')
    const format = (c.req.query('format') || 'json').toLowerCase()
    const statusParam = c.req.query('status')
    const statuses = statusParam ? statusParam.split(',').filter(s => EXPORTABLE.includes(s)) : LISTABLE
    return respondFeed(c, await buildFeed(u.companyId, statuses), format)
  })

  /**
   * THE FEED TOKEN IS ISSUED HERE, SO READING IT IS NOT A READ (T42): a GET that mints a credential when the company has
   * none asks contacts:update, as rotating one always has. The feed itself stays open to every seat.
   */
  app.get('/token', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user')
    const [comp] = await db.select().from(company).where(eq(company.id, u.companyId)).limit(1)
    if (!comp) return fail(c, 404, 'Company not found')
    let token = comp.feedToken
    if (!token) {
      token = createId()
      await db.update(company).set({ feedToken: token }).where(eq(company.id, comp.id))
    }
    const base = publicFeedUrl(c, token).replace(/\.csv$/, '')
    return one(c, { token, urls: { csv: base + '.csv', json: base + '.json', xml: base + '.xml' } })
  })

  // POST /token/rotate — a fresh token (the old URL stops working)
  app.post('/token/rotate', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user')
    const token = createId()
    await db.update(company).set({ feedToken: token }).where(eq(company.id, u.companyId))
    const base = publicFeedUrl(c, token).replace(/\.csv$/, '')
    return one(c, { token, urls: { csv: base + '.csv', json: base + '.json', xml: base + '.xml' } })
  })

  return app
}

/** The public feed the marketplaces pull by token: GET /:token/inventory.(csv|json|xml). No session. */
export function createPublicFeedRoutes(d: CrmDeps) {
  const { db } = d
  const buildFeed = feedOf(db)
  return new Hono().get('/:token/:file', async (c) => {
    const token = c.req.param('token')
    const file = c.req.param('file')
    if (!token) return fail(c, 400, 'Missing feed token')
    const [comp] = await db.select().from(company).where(eq(company.feedToken, token)).limit(1)
    if (!comp) return fail(c, 404, 'Invalid feed token')
    const ext = (file.split('.').pop() || 'json').toLowerCase()
    const format = ext === 'csv' ? 'csv' : ext === 'xml' ? 'xml' : 'json'
    return respondFeed(c, await buildFeed(comp.id, LISTABLE), format)
  })
}
