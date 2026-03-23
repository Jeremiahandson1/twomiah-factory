import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()

// Simple in-memory rate limiter for /track endpoint
const trackRateLimit = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW = 60_000 // 1 minute
const RATE_LIMIT_MAX = 60 // 60 requests per minute per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = trackRateLimit.get(ip)
  if (!entry || now > entry.resetAt) {
    trackRateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT_MAX
}

// Clean up rate limit map periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of trackRateLimit) {
    if (now > val.resetAt) trackRateLimit.delete(key)
  }
}, 5 * 60_000)

// Parse user agent into device/browser/os
function parseUserAgent(ua: string): { device: string; browser: string; os: string } {
  let device = 'desktop'
  if (/mobile|android.*mobile|iphone|ipod/i.test(ua)) device = 'mobile'
  else if (/tablet|ipad|android(?!.*mobile)/i.test(ua)) device = 'tablet'

  let browser = 'other'
  if (/edg\//i.test(ua)) browser = 'edge'
  else if (/chrome|crios/i.test(ua)) browser = 'chrome'
  else if (/firefox|fxios/i.test(ua)) browser = 'firefox'
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'safari'
  else if (/opera|opr/i.test(ua)) browser = 'opera'

  let os = 'other'
  if (/windows/i.test(ua)) os = 'windows'
  else if (/macintosh|mac os/i.test(ua)) os = 'macos'
  else if (/linux/i.test(ua) && !/android/i.test(ua)) os = 'linux'
  else if (/android/i.test(ua)) os = 'android'
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'ios'

  return { device, browser, os }
}

// POST /track — Track page view (NO AUTH - called by website)
app.post('/track', async (c) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown'
  if (isRateLimited(ip)) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }

  const trackSchema = z.object({
    page: z.string().min(1).max(2048),
    referrer: z.string().max(2048).optional(),
    userAgent: z.string().max(1024).optional(),
    sessionId: z.string().min(1).max(128),
    companyId: z.string().min(1),
    utm_source: z.string().max(256).optional(),
    utm_medium: z.string().max(256).optional(),
    utm_campaign: z.string().max(256).optional(),
  })

  let data: z.infer<typeof trackSchema>
  try {
    data = trackSchema.parse(await c.req.json())
  } catch {
    return c.json({ error: 'Invalid request body' }, 400)
  }

  const ua = data.userAgent || c.req.header('user-agent') || ''
  const parsed = parseUserAgent(ua)

  await db.execute(sql`
    INSERT INTO page_views(id, company_id, page, referrer, user_agent, session_id, ip_address, device, browser, os, utm_source, utm_medium, utm_campaign, created_at)
    VALUES (gen_random_uuid(), ${data.companyId}, ${data.page}, ${data.referrer || null}, ${ua}, ${data.sessionId}, ${ip}, ${parsed.device}, ${parsed.browser}, ${parsed.os}, ${data.utm_source || null}, ${data.utm_medium || null}, ${data.utm_campaign || null}, NOW())
  `)

  return c.json({ ok: true })
})

// All routes below require authentication
app.use('/*', authenticate)

// GET /overview — Analytics overview (manager+)
app.get('/overview', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const endDate = c.req.query('endDate') || new Date().toISOString().split('T')[0]

  const totalResult = await db.execute(sql`
    SELECT COUNT(*)::int as total_page_views,
           COUNT(DISTINCT session_id)::int as unique_sessions
    FROM page_views
    WHERE company_id = ${currentUser.companyId}
      AND created_at >= ${startDate}::date
      AND created_at < (${endDate}::date + INTERVAL '1 day')
  `)
  const totals = ((totalResult as any).rows || totalResult)?.[0]

  const topPagesResult = await db.execute(sql`
    SELECT page, COUNT(*)::int as views, COUNT(DISTINCT session_id)::int as unique_sessions
    FROM page_views
    WHERE company_id = ${currentUser.companyId}
      AND created_at >= ${startDate}::date
      AND created_at < (${endDate}::date + INTERVAL '1 day')
    GROUP BY page
    ORDER BY views DESC
    LIMIT 20
  `)

  const topReferrersResult = await db.execute(sql`
    SELECT referrer, COUNT(*)::int as views
    FROM page_views
    WHERE company_id = ${currentUser.companyId}
      AND referrer IS NOT NULL AND referrer != ''
      AND created_at >= ${startDate}::date
      AND created_at < (${endDate}::date + INTERVAL '1 day')
    GROUP BY referrer
    ORDER BY views DESC
    LIMIT 20
  `)

  const deviceResult = await db.execute(sql`
    SELECT device, COUNT(*)::int as count
    FROM page_views
    WHERE company_id = ${currentUser.companyId}
      AND created_at >= ${startDate}::date
      AND created_at < (${endDate}::date + INTERVAL '1 day')
    GROUP BY device
  `)
  const deviceRows = (deviceResult as any).rows || deviceResult
  const totalDeviceCount = deviceRows.reduce((sum: number, r: any) => sum + r.count, 0) || 1
  const deviceBreakdown: Record<string, number> = {}
  for (const row of deviceRows) {
    deviceBreakdown[row.device] = Math.round((row.count / totalDeviceCount) * 10000) / 100
  }

  const browserResult = await db.execute(sql`
    SELECT browser, COUNT(*)::int as count
    FROM page_views
    WHERE company_id = ${currentUser.companyId}
      AND created_at >= ${startDate}::date
      AND created_at < (${endDate}::date + INTERVAL '1 day')
    GROUP BY browser
    ORDER BY count DESC
  `)

  const utmResult = await db.execute(sql`
    SELECT utm_source, utm_medium, utm_campaign, COUNT(*)::int as views, COUNT(DISTINCT session_id)::int as unique_sessions
    FROM page_views
    WHERE company_id = ${currentUser.companyId}
      AND (utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL)
      AND created_at >= ${startDate}::date
      AND created_at < (${endDate}::date + INTERVAL '1 day')
    GROUP BY utm_source, utm_medium, utm_campaign
    ORDER BY views DESC
    LIMIT 20
  `)

  return c.json({
    totalPageViews: totals?.total_page_views || 0,
    uniqueSessions: totals?.unique_sessions || 0,
    topPages: (topPagesResult as any).rows || topPagesResult,
    topReferrers: (topReferrersResult as any).rows || topReferrersResult,
    deviceBreakdown,
    browserBreakdown: (browserResult as any).rows || browserResult,
    trafficSources: (utmResult as any).rows || utmResult,
  })
})

// GET /pages — Per-page analytics (paginated)
app.get('/pages', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const endDate = c.req.query('endDate') || new Date().toISOString().split('T')[0]
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  const dataResult = await db.execute(sql`
    SELECT page as path, COUNT(*)::int as views, COUNT(DISTINCT session_id)::int as unique_sessions,
           ROUND(AVG(time_on_page)::numeric, 1) as avg_time_on_page
    FROM page_views
    WHERE company_id = ${currentUser.companyId}
      AND created_at >= ${startDate}::date
      AND created_at < (${endDate}::date + INTERVAL '1 day')
    GROUP BY page
    ORDER BY views DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(DISTINCT page)::int as total
    FROM page_views
    WHERE company_id = ${currentUser.companyId}
      AND created_at >= ${startDate}::date
      AND created_at < (${endDate}::date + INTERVAL '1 day')
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number(((countResult as any).rows || countResult)?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// GET /referrers — Referrer analytics
app.get('/referrers', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const endDate = c.req.query('endDate') || new Date().toISOString().split('T')[0]
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  const dataResult = await db.execute(sql`
    SELECT referrer, COUNT(*)::int as views, COUNT(DISTINCT session_id)::int as unique_sessions
    FROM page_views
    WHERE company_id = ${currentUser.companyId}
      AND referrer IS NOT NULL AND referrer != ''
      AND created_at >= ${startDate}::date
      AND created_at < (${endDate}::date + INTERVAL '1 day')
    GROUP BY referrer
    ORDER BY views DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(DISTINCT referrer)::int as total
    FROM page_views
    WHERE company_id = ${currentUser.companyId}
      AND referrer IS NOT NULL AND referrer != ''
      AND created_at >= ${startDate}::date
      AND created_at < (${endDate}::date + INTERVAL '1 day')
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number(((countResult as any).rows || countResult)?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// GET /campaigns — UTM campaign performance
app.get('/campaigns', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const endDate = c.req.query('endDate') || new Date().toISOString().split('T')[0]
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  const dataResult = await db.execute(sql`
    SELECT utm_source, utm_medium, utm_campaign,
           COUNT(*)::int as views,
           COUNT(DISTINCT session_id)::int as unique_sessions
    FROM page_views
    WHERE company_id = ${currentUser.companyId}
      AND (utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL)
      AND created_at >= ${startDate}::date
      AND created_at < (${endDate}::date + INTERVAL '1 day')
    GROUP BY utm_source, utm_medium, utm_campaign
    ORDER BY views DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM (
      SELECT DISTINCT utm_source, utm_medium, utm_campaign
      FROM page_views
      WHERE company_id = ${currentUser.companyId}
        AND (utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL)
        AND created_at >= ${startDate}::date
        AND created_at < (${endDate}::date + INTERVAL '1 day')
    ) sub
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number(((countResult as any).rows || countResult)?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// GET /realtime — Real-time visitors (sessions in last 5 minutes)
app.get('/realtime', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT session_id, page, device, browser, os, referrer, utm_source, created_at
    FROM page_views
    WHERE company_id = ${currentUser.companyId}
      AND created_at >= NOW() - INTERVAL '5 minutes'
    ORDER BY created_at DESC
  `)

  const rows = (result as any).rows || result

  // Deduplicate to unique sessions with their latest page
  const sessionMap = new Map<string, any>()
  for (const row of rows) {
    if (!sessionMap.has(row.session_id)) {
      sessionMap.set(row.session_id, {
        sessionId: row.session_id,
        currentPage: row.page,
        device: row.device,
        browser: row.browser,
        os: row.os,
        referrer: row.referrer,
        utmSource: row.utm_source,
        lastSeen: row.created_at,
      })
    }
  }

  return c.json({
    activeVisitors: sessionMap.size,
    sessions: Array.from(sessionMap.values()),
  })
})

export default app
