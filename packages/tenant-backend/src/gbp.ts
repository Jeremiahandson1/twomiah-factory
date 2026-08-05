// Google Business Profile — reviews inbox for the tenant's real-world listing.
//
// OAuth is brokered by the factory (one approved Google app; consent lands on
// the factory; tokens forward here via X-Factory-Key). This module stores the
// connection (single row — one listing per tenant in V1), refreshes tokens
// with the deploy-forwarded GOOGLE_CALENDAR_CLIENT_ID/SECRET (same Google app
// as calendar), and proxies the Business Profile APIs:
//   accounts:  mybusinessaccountmanagement.googleapis.com/v1/accounts
//   locations: mybusinessbusinessinformation.googleapis.com/v1/{acct}/locations
//   reviews:   mybusiness.googleapis.com/v4/{location}/reviews (list + reply)
// NOTE: Google gates these APIs behind an access application per Cloud
// project. Until approved, calls fail with quota/permission errors — surfaced
// verbatim to the admin UI rather than swallowed.
import { Hono } from 'hono'

export interface GbpDeps {
  db: any
  gbpConnectionTable: any
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

async function getConnection(deps: GbpDeps): Promise<any | null> {
  const [row] = await deps.db.select().from(deps.gbpConnectionTable).limit(1)
  return row || null
}

async function getValidToken(deps: GbpDeps): Promise<{ conn: any; accessToken: string } | null> {
  const conn = await getConnection(deps)
  if (!conn) return null
  let accessToken = conn.accessToken
  const expired = conn.expiresAt && new Date(conn.expiresAt).getTime() < Date.now() + 60_000
  if (expired) {
    if (!conn.refreshToken) return null
    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET
    if (!clientId || !clientSecret) return null
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: conn.refreshToken, grant_type: 'refresh_token' })
    const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    if (!res.ok) return null
    const t: any = await res.json()
    accessToken = t.access_token
    const { eq } = await import('drizzle-orm')
    await deps.db.update(deps.gbpConnectionTable)
      .set({ accessToken, expiresAt: new Date(Date.now() + (t.expires_in || 3600) * 1000), updatedAt: new Date() })
      .where(eq(deps.gbpConnectionTable.id, conn.id))
  }
  return { conn, accessToken }
}

async function gapi(accessToken: string, url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, { ...init, headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message || `Google API ${res.status}`)
  return data
}

// Factory-authenticated ingestion — the wrapper applies X-Factory-Key auth.
export function createGbpInternalRoutes(deps: GbpDeps): Hono {
  const app = new Hono()
  app.post('/store-tokens', async (c) => {
    try {
      const b = await c.req.json().catch(() => ({}))
      if (!b.accessToken) return c.json({ error: 'accessToken required' }, 400)
      const values = {
        externalEmail: b.externalAccountEmail || null,
        accessToken: b.accessToken,
        refreshToken: b.refreshToken || null,
        expiresAt: new Date(Date.now() + (b.expiresInSec || 3600) * 1000),
        updatedAt: new Date(),
      }
      const existing = await getConnection(deps)
      if (existing) {
        const { eq } = await import('drizzle-orm')
        await deps.db.update(deps.gbpConnectionTable).set(values).where(eq(deps.gbpConnectionTable.id, existing.id))
      } else {
        await deps.db.insert(deps.gbpConnectionTable).values(values)
      }
      return c.json({ ok: true })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })
  return app
}

// Admin routes — the wrapper applies tenant admin auth.
export function createGbpAdminRoutes(deps: GbpDeps): Hono {
  const app = new Hono()

  app.get('/status', async (c) => {
    const conn = await getConnection(deps)
    return c.json({
      connected: !!conn,
      email: conn?.externalEmail || null,
      locationName: conn?.locationName || null,
      locationTitle: conn?.locationTitle || null,
      needsLocation: !!conn && !conn.locationName,
    })
  })

  app.get('/connect-url', async (c) => {
    const factoryUrl = (process.env.FACTORY_URL || '').replace(/\/$/, '')
    const tenantId = process.env.TENANT_ID || ''
    if (!factoryUrl || !tenantId) return c.json({ error: 'Factory routing not configured on this tenant' }, 503)
    const user = c.get('user') as any
    const ret = c.req.query('return') || ''
    if (!ret) return c.json({ error: 'return required' }, 400)
    const url = factoryUrl + '/gbp/google/auth?' + new URLSearchParams({ tenant: tenantId, user: String(user?.userId || 'owner'), return: ret })
    return c.json({ url })
  })

  app.get('/locations', async (c) => {
    try {
      const t = await getValidToken(deps)
      if (!t) return c.json({ error: 'Not connected' }, 400)
      const accounts = await gapi(t.accessToken, 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts')
      const out: Array<{ accountName: string; locationName: string; title: string }> = []
      for (const acct of accounts?.accounts || []) {
        const locs = await gapi(t.accessToken, `https://mybusinessbusinessinformation.googleapis.com/v1/${acct.name}/locations?readMask=name,title&pageSize=100`)
        for (const l of locs?.locations || []) out.push({ accountName: acct.name, locationName: l.name, title: l.title || l.name })
      }
      return c.json({ locations: out })
    } catch (err: any) {
      return c.json({ error: err.message }, 502)
    }
  })

  app.post('/location', async (c) => {
    const b = await c.req.json().catch(() => ({}))
    if (!b.accountName || !b.locationName) return c.json({ error: 'accountName and locationName required' }, 400)
    const conn = await getConnection(deps)
    if (!conn) return c.json({ error: 'Not connected' }, 400)
    const { eq } = await import('drizzle-orm')
    await deps.db.update(deps.gbpConnectionTable)
      .set({ accountName: b.accountName, locationName: b.locationName, locationTitle: b.locationTitle || null, updatedAt: new Date() })
      .where(eq(deps.gbpConnectionTable.id, conn.id))
    return c.json({ ok: true })
  })

  app.get('/reviews', async (c) => {
    try {
      const t = await getValidToken(deps)
      if (!t?.conn?.locationName || !t?.conn?.accountName) return c.json({ error: 'Connect Google and choose a location first' }, 400)
      // v4 review path: accounts/{a}/locations/{l} — locationName from the v1
      // API is 'locations/{l}'; combine with the stored account.
      const locPath = `${t.conn.accountName}/${t.conn.locationName}`
      const data = await gapi(t.accessToken, `https://mybusiness.googleapis.com/v4/${locPath}/reviews?pageSize=50`)
      return c.json({
        averageRating: data?.averageRating ?? null,
        totalReviewCount: data?.totalReviewCount ?? 0,
        reviews: (data?.reviews || []).map((r: any) => ({
          name: r.name,
          reviewer: r.reviewer?.displayName || 'Anonymous',
          starRating: r.starRating,
          comment: r.comment || '',
          createTime: r.createTime,
          reply: r.reviewReply?.comment || null,
        })),
      })
    } catch (err: any) {
      return c.json({ error: err.message }, 502)
    }
  })

  app.post('/reviews/reply', async (c) => {
    try {
      const b = await c.req.json().catch(() => ({}))
      if (!b.reviewName || typeof b.comment !== 'string' || !b.comment.trim()) return c.json({ error: 'reviewName and comment required' }, 400)
      const t = await getValidToken(deps)
      if (!t) return c.json({ error: 'Not connected' }, 400)
      await gapi(t.accessToken, `https://mybusiness.googleapis.com/v4/${b.reviewName}/reply`, {
        method: 'PUT',
        body: JSON.stringify({ comment: b.comment.trim() }),
      })
      return c.json({ ok: true })
    } catch (err: any) {
      return c.json({ error: err.message }, 502)
    }
  })

  app.post('/disconnect', async (c) => {
    const conn = await getConnection(deps)
    if (conn) {
      const { eq } = await import('drizzle-orm')
      await deps.db.delete(deps.gbpConnectionTable).where(eq(deps.gbpConnectionTable.id, conn.id))
    }
    return c.json({ ok: true })
  })

  return app
}
