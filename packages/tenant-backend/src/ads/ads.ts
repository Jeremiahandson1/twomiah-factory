// Twomiah Ads — ONE implementation for every CRM (vendored into each template as ../shared).
//
// Two halves:
//   /api/ads/*                        — the Ads page. Signed-in, gated on the tenant's `paid_ads` feature and on role
//                                       permissions. Campaign data lives in the Twomiah Ads service
//                                       (ADS_URL, default https://twomiah-ads.onrender.com); this router passes the
//                                       page's calls through with the tenant's key (ADS_API_KEY, set by the Factory
//                                       when it registers the tenant) and never exposes that key to the browser.
//                                       A/B landing-page experiments are stored in the tenant's own database.
//   /api/public/ads-experiments/*     — called by the tenant's premium website (scripts/ab.js on another origin):
//                                       sticky variant assignment + conversion events. Anonymous by design.
//
// Before: the page read /api/ads/performance, /campaigns and /pending-approvals, which returned hard-coded empty mock
// data with an in-memory "approval" store; its Settings tab and campaign wizard called /api/ads/auth/*, /photos,
// /templates, /campaigns/preview and /campaigns/launch — routes that did not exist in the CRM, so every one 404'd
// ("Save as Draft" also called launch). Experiments were read and written for "the first company in the table",
// PATCH had no company scope, and any signed-in role could create or change them.
//
// Spend safety — anything that can start or change real ad spend needs the `ads:spend` permission (owner/admin) AND an
// explicit `confirmSpend: true` in the body; launch additionally requires a saved business profile (the service takes
// the monthly budget from it). The upstream request body is rebuilt from validated fields — nothing else is forwarded.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, desc, sql, inArray } from 'drizzle-orm'

export interface AdsTables { company: any; adsExperiment: any; adsExperimentAssignment: any; adsExperimentConversion: any }
export interface AdsDeps {
  db: any
  tables: AdsTables
  authenticate: any
  requirePermission: (permission: string) => any
  /** process.env by default: ADS_URL (service base URL), ADS_API_KEY (this tenant's key on the service). */
  env?: Record<string, string | undefined>
  /** Injected for tests. */
  fetch?: typeof fetch
  /** Feature id the whole router is gated on. Default 'paid_ads'. */
  feature?: string
  /** Registers this tenant with Twomiah Ads through the Factory when it has no key yet (POST /connect). */
  connector?: AdsConnector
}
export interface AdsPublicDeps { db: any; tables: AdsTables }
export interface AdsConnectorDeps {
  /** process.env by default — the same object the ads client reads ADS_API_KEY / ADS_URL from. */
  env?: Record<string, string | undefined>
  /** Tenant → Factory call: registers the tenant with Twomiah Ads (or returns the key its Render service already
   *  holds), stores ADS_URL + ADS_API_KEY on the Render backend, and returns the key. Nothing is launched. */
  registerWithFactory: () => Promise<{ apiKey?: string; adsUrl?: string; created?: boolean }>
  feature?: string
  log?: (message: string) => void
}
export interface AdsConnector {
  ensure: () => Promise<{ configured: true; created: boolean }>
  onFeaturesChanged: (features: unknown) => void
}

export const ADS_PLATFORMS = ['google', 'meta', 'tiktok'] as const
export const ADS_OBJECTIVES = ['leads', 'traffic', 'awareness'] as const
/** Platforms a tenant connects with its own account (Google runs under Twomiah's manager account — nothing to connect). */
export const ADS_CONNECT_PLATFORMS = ['meta', 'tiktok', 'lsa'] as const
export const EXPERIMENT_STATUSES = ['draft', 'running', 'completed', 'archived'] as const
export const DEFAULT_ADS_URL = 'https://twomiah-ads.onrender.com'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const clampInt = (v: unknown, min: number, max: number, dflt: number) => { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt }
const zodError = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')

export class AdsUpstreamError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message) }
}

/** Server-side client for the Twomiah Ads service. The key is read per call so a Render env change needs no code path. */
export function createAdsClient(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch) {
  const base = () => String(env.ADS_URL || DEFAULT_ADS_URL).replace(/\/+$/, '')
  const key = () => String(env.ADS_API_KEY || '').trim()
  return {
    configured: () => !!key(),
    async call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<any> {
      let res: Response
      try {
        res = await fetchImpl(base() + path, {
          method,
          headers: { Authorization: `ApiKey ${key()}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
          // The service can be cold (free-tier spin-up ~50 s); a launch generates creatives before it answers.
          signal: AbortSignal.timeout(method === 'GET' ? 60_000 : 120_000),
        })
      } catch {
        throw new AdsUpstreamError(502, 'Twomiah Ads did not respond. Try again in a minute.')
      }
      const text = await res.text()
      let data: any = null
      try { data = text ? JSON.parse(text) : null } catch { data = null }
      if (res.ok) return data
      if (res.status === 401) throw new AdsUpstreamError(502, "Twomiah Ads did not accept this account's API key.")
      // The operator sees a sentence about THIS app, never the upstream's payload: the ad-copy failure arrived as
      // `{"type":"error","error":{"type":"authentication_error","message":"API key is invalid."}}` and was shown
      // verbatim in the dialog — a provider's credential error is not something a landscaper can act on, and a raw
      // upstream body can carry internals. The full body is logged for us instead. (Landscaping T21 H1)
      const raw = typeof data?.error === 'string' ? data.error : typeof data?.error?.message === 'string' ? data.error.message : typeof data?.message === 'string' ? data.message : ''
      const plain = raw.trim()
      const safe = plain && plain.length <= 200 && !/[{}[\]]|api[\s_-]?key|authentication|credential|token|bearer/i.test(plain) ? plain : ''
      const msg = safe
        ? `Twomiah Ads: ${safe}`
        : res.status >= 500 || !safe
          ? 'Twomiah Ads could not complete that request. Nothing was charged — try again in a few minutes, and contact support if it keeps happening.'
          : `Twomiah Ads returned HTTP ${res.status}.`
      if (!safe) console.error('[Ads] upstream error', { path, status: res.status, body: text.slice(0, 500) })
      throw new AdsUpstreamError(res.status === 400 || res.status === 404 || res.status === 409 ? res.status : 502, msg, safe ? data?.details : undefined)
    },
  }
}

// ── request bodies ─────────────────────────────────────────────────────────────
const platformsSchema = z.array(z.enum(ADS_PLATFORMS)).min(1).max(3).refine((a) => new Set(a).size === a.length, 'platforms must be unique')
const previewSchema = z.object({ platforms: platformsSchema.optional(), objective: z.enum(ADS_OBJECTIVES).optional() })
const launchSchema = z.object({
  platforms: platformsSchema,
  objective: z.enum(ADS_OBJECTIVES),
  campaignName: z.string().trim().min(1).max(200).optional(),
  google_campaign_type: z.enum(['SEARCH', 'PERFORMANCE_MAX']).optional(),
  confirmSpend: z.literal(true, { errorMap: () => ({ message: 'Launching starts real ad spend: send confirmSpend: true' }) }),
})
const confirmSchema = z.object({ confirmSpend: z.literal(true, { errorMap: () => ({ message: 'This changes live ad spend: send confirmSpend: true' }) }) })
const profileSchema = z.object({
  business_name: z.string().trim().min(1).max(200),
  industry: z.string().trim().min(1).max(100),
  services: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  geo_targets: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  monthly_budget_cents: z.number().int().min(1000, 'Monthly budget must be at least $10').max(100000000),
  website_url: z.union([z.string().trim().url().max(500), z.literal('')]).optional(),
  phone: z.string().trim().max(30).optional(),
  unique_value_prop: z.string().trim().max(500).optional(),
  brand_voice: z.string().trim().max(50).optional(),
})
const modeSchema = z.object({ mode: z.enum(['managed', 'connected']) })
const accountSchema = z.object({ accountId: z.string().trim().min(1).max(100) })
const pageSchema = z.object({ pageId: z.string().trim().min(1).max(100) })
const variantSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_-]{1,20}$/, 'variant key: lowercase letters, digits, - or _').optional(),
  label: z.string().trim().min(1).max(60),
  trafficPercent: z.number().min(0).max(100).optional(),
})
const pathSchema = z.string().trim().max(300).regex(/^\/[^\s?#]*$/, 'path must start with / and contain no spaces, ? or #')
const experimentCreateSchema = z.object({ name: z.string().trim().min(1).max(120), path: pathSchema, variants: z.array(variantSchema).min(2).max(4) })
const experimentPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(EXPERIMENT_STATUSES).optional(),
  winnerKey: z.string().trim().max(20).nullable().optional(),
})

/** Keys a..d when missing, unique; traffic normalised to whole percents that sum to exactly 100. */
export function normaliseVariants(input: Array<{ key?: string; label: string; trafficPercent?: number }>) {
  const keys = input.map((v, i) => v.key || String.fromCharCode(97 + i))
  if (new Set(keys).size !== keys.length) return { error: 'variant keys must be unique' as const }
  const raw = input.map((v) => Math.max(0, Number(v.trafficPercent ?? 0)))
  const total = raw.reduce((s, n) => s + n, 0)
  const pct = total > 0 ? raw.map((n) => Math.floor((n / total) * 100)) : raw.map(() => Math.floor(100 / input.length))
  pct[pct.length - 1] += 100 - pct.reduce((s, n) => s + n, 0)
  return { variants: input.map((v, i) => ({ key: keys[i], label: v.label, trafficPercent: pct[i] })) }
}

/**
 * Connects a tenant that has paid_ads on but no ADS_API_KEY. The Factory only registered tenants with Twomiah Ads at
 * first deploy, so a tenant that switched Ads on later stayed "not connected" forever. ensure() asks the Factory to
 * register this tenant (or hand back the key its Render service already holds), keeps the key in this process so the
 * page works immediately (the Factory also writes it to Render, so it survives a restart), and never runs twice at once.
 */
export function createAdsConnector(deps: AdsConnectorDeps): AdsConnector {
  const env = deps.env || process.env
  const feature = deps.feature || 'paid_ads'
  const log = deps.log || ((m: string) => console.log(m))
  let inflight: Promise<{ configured: true; created: boolean }> | null = null
  const ensure = () => {
    if (String(env.ADS_API_KEY || '').trim()) return Promise.resolve({ configured: true as const, created: false })
    if (!inflight) {
      inflight = (async () => {
        try {
          const r = await deps.registerWithFactory()
          const key = String(r?.apiKey || '').trim()
          if (!key) throw new AdsUpstreamError(502, 'The Factory did not return a Twomiah Ads key.')
          env.ADS_API_KEY = key
          if (r?.adsUrl) env.ADS_URL = r.adsUrl
          return { configured: true as const, created: !!r?.created }
        } finally { inflight = null }
      })()
    }
    return inflight
  }
  // Called after every feature save (owner Settings › Features and the Factory's sync). No-op when Ads is off or a key exists.
  const onFeaturesChanged = (features: unknown) => {
    if (!Array.isArray(features) || !features.includes(feature) || String(env.ADS_API_KEY || '').trim()) return
    ensure()
      .then((r) => log(`[Ads] ${feature} is on — Twomiah Ads ${r.created ? 'registration created' : 'key already on record'}`))
      .catch((e: any) => log(`[Ads] ${feature} is on but connecting Twomiah Ads failed: ${e?.message || e}`))
  }
  return { ensure, onFeaturesChanged }
}

export function createAdsRoutes(deps: AdsDeps) {
  const { db, tables: t, authenticate, requirePermission } = deps
  const env = deps.env || process.env
  const feature = deps.feature || 'paid_ads'
  const ads = createAdsClient(env, deps.fetch || fetch)
  const app = new Hono()

  app.use('*', authenticate)
  // The owner's Settings › Features switch. Hiding Ads in the sidebar used to leave every /api/ads route open.
  const featureCache = new Map<string, { at: number; list: string[] }>()
  app.use('*', async (c, next) => {
    const u = c.get('user') as any
    if (!u?.companyId) return c.json({ error: 'Authentication required' }, 401)
    const hit = featureCache.get(u.companyId)
    let list = hit && Date.now() - hit.at < 15_000 ? hit.list : null
    if (!list) {
      const [co] = await db.select({ enabledFeatures: t.company.enabledFeatures }).from(t.company).where(eq(t.company.id, u.companyId)).limit(1)
      list = Array.isArray(co?.enabledFeatures) ? (co.enabledFeatures as string[]) : []
      featureCache.set(u.companyId, { at: Date.now(), list })
    }
    if (!list.includes(feature)) return c.json({ error: 'Ads is not enabled for your account.', code: 'FEATURE_NOT_ENABLED', feature }, 403)
    await next()
  })

  const body = async (c: any) => { try { return await c.req.json() } catch { return {} } }
  const upstream = async (c: any, fn: () => Promise<any>) => {
    if (!ads.configured()) return c.json({ error: 'Twomiah Ads is not connected for this account yet.', code: 'ADS_NOT_CONFIGURED' }, 409)
    try { return c.json(await fn()) } catch (e) {
      if (e instanceof AdsUpstreamError) return c.json({ error: e.message, ...(e.details ? { details: e.details } : {}) }, e.status as any)
      throw e
    }
  }
  const badId = (c: any) => c.json({ error: 'Invalid id' }, 400)

  // ── connection + account ────────────────────────────────────────────────────
  app.get('/overview', requirePermission('ads:read'), async (c) => {
    if (!ads.configured()) return c.json({ configured: false })
    return upstream(c, async () => {
      const [mode, conn, profile, balance] = await Promise.all([
        ads.call('GET', '/auth/mode'), ads.call('GET', '/auth/connect-url/all'), ads.call('GET', '/profile'), ads.call('GET', '/billing/balance'),
      ])
      return {
        configured: true,
        mode: mode?.mode || 'managed',
        // connect URLs are not sent here — only the settings endpoint (ads:settings) hands one out
        platforms: (Array.isArray(conn?.platforms) ? conn.platforms : []).map((p: any) => ({
          platform: p.platform, mode: p.mode, connected: !!p.connected, accountId: p.account_id || null,
          billingLinked: p.billing_linked ?? null, hasPageId: p.has_page_id ?? null, tokenExpired: !!p.token_expired, requiresAction: p.requires_action || null,
        })),
        profile: profile?.profile || null,
        balanceCents: Number(balance?.balance_cents || 0),
      }
    })
  })
  // Owner/admin "Connect Twomiah Ads" for a tenant with Ads on but no key (switched on after its first deploy).
  // Registers the account only — no campaign, no spend.
  app.post('/connect', requirePermission('ads:settings'), async (c) => {
    if (ads.configured()) return c.json({ configured: true, created: false })
    if (!deps.connector) return c.json({ error: 'Connecting Twomiah Ads is not available on this server.' }, 501)
    try { return c.json(await deps.connector.ensure()) } catch (e: any) {
      return c.json({ error: `Could not connect Twomiah Ads: ${e?.message || 'unknown error'}` }, (e instanceof AdsUpstreamError ? e.status : 502) as any)
    }
  })
  app.get('/profile', requirePermission('ads:read'), (c) => upstream(c, async () => ({ profile: (await ads.call('GET', '/profile'))?.profile || null })))
  app.put('/profile', requirePermission('ads:settings'), async (c) => {
    const parsed = profileSchema.safeParse(await body(c))
    if (!parsed.success) return c.json({ error: zodError(parsed.error) }, 400)
    return upstream(c, () => ads.call('POST', '/profile', parsed.data))
  })
  app.put('/mode', requirePermission('ads:settings'), async (c) => {
    const parsed = modeSchema.safeParse(await body(c))
    if (!parsed.success) return c.json({ error: 'mode must be "managed" or "connected"' }, 400)
    return upstream(c, () => ads.call('PUT', '/auth/mode', { mode: parsed.data.mode }))
  })
  const connectPlatform = (c: any) => { const p = c.req.param('platform'); return (ADS_CONNECT_PLATFORMS as readonly string[]).includes(p) ? p : null }
  app.get('/platforms/:platform/connect-url', requirePermission('ads:settings'), (c) => {
    const p = connectPlatform(c); if (!p) return c.json({ error: 'Unknown platform' }, 400)
    return upstream(c, async () => ({ url: (await ads.call('GET', `/auth/connect-url/${p}`))?.url || null }))
  })
  app.post('/platforms/:platform/account', requirePermission('ads:settings'), async (c) => {
    const p = connectPlatform(c); if (!p) return c.json({ error: 'Unknown platform' }, 400)
    const parsed = accountSchema.safeParse(await body(c))
    if (!parsed.success) return c.json({ error: 'accountId is required' }, 400)
    return upstream(c, () => ads.call('POST', `/auth/${p}/account`, { accountId: parsed.data.accountId }))
  })
  app.post('/platforms/meta/page', requirePermission('ads:settings'), async (c) => {
    const parsed = pageSchema.safeParse(await body(c))
    if (!parsed.success) return c.json({ error: 'pageId is required' }, 400)
    return upstream(c, () => ads.call('POST', '/auth/meta/page', { pageId: parsed.data.pageId }))
  })
  app.delete('/platforms/:platform', requirePermission('ads:settings'), (c) => {
    const p = connectPlatform(c); if (!p) return c.json({ error: 'Unknown platform' }, 400)
    return upstream(c, () => ads.call('DELETE', `/auth/${p}`))
  })
  app.get('/billing/ledger', requirePermission('ads:read'), (c) => upstream(c, () => ads.call('GET', `/billing/ledger?limit=${clampInt(c.req.query('limit'), 1, 200, 50)}`)))

  // ── performance + campaigns ─────────────────────────────────────────────────
  app.get('/dashboard', requirePermission('ads:read'), (c) => upstream(c, () => ads.call('GET', `/dashboard?days=${clampInt(c.req.query('days'), 1, 365, 30)}`)))
  app.get('/campaigns', requirePermission('ads:read'), (c) => upstream(c, () => ads.call('GET', '/campaigns')))
  app.post('/campaigns/preview', requirePermission('ads:spend'), async (c) => {
    // Generates AI ad copy on the service (no ad spend, but it costs generation) — owner/admin only.
    const parsed = previewSchema.safeParse(await body(c))
    if (!parsed.success) return c.json({ error: zodError(parsed.error) }, 400)
    return upstream(c, () => ads.call('POST', '/campaigns/preview', { platforms: parsed.data.platforms, objective: parsed.data.objective }))
  })
  app.post('/campaigns/launch', requirePermission('ads:spend'), async (c) => {
    const parsed = launchSchema.safeParse(await body(c))
    if (!parsed.success) return c.json({ error: zodError(parsed.error), code: parsed.error.issues.some((i) => i.path[0] === 'confirmSpend') ? 'CONFIRM_SPEND_REQUIRED' : undefined }, 400)
    return upstream(c, async () => {
      const profile = (await ads.call('GET', '/profile'))?.profile
      if (!profile || !Number(profile.monthly_budget_cents)) throw new AdsUpstreamError(400, 'Save the business profile with a monthly budget in Ads › Settings before launching.')
      const { platforms, objective, campaignName, google_campaign_type } = parsed.data
      return ads.call('POST', '/campaigns/launch', { platforms, objective, campaignName, google_campaign_type })
    })
  })
  app.get('/campaigns/:id', requirePermission('ads:read'), (c) => {
    const id = c.req.param('id'); if (!UUID_RE.test(id)) return badId(c)
    return upstream(c, () => ads.call('GET', `/campaigns/${id}`))
  })
  app.post('/campaigns/:id/pause', requirePermission('ads:update'), (c) => {
    const id = c.req.param('id'); if (!UUID_RE.test(id)) return badId(c)
    return upstream(c, () => ads.call('POST', `/campaigns/${id}/pause`))
  })
  app.post('/campaigns/:id/resume', requirePermission('ads:spend'), async (c) => {
    const id = c.req.param('id'); if (!UUID_RE.test(id)) return badId(c)
    const parsed = confirmSchema.safeParse(await body(c))
    if (!parsed.success) return c.json({ error: 'Resuming starts spending again: send confirmSpend: true', code: 'CONFIRM_SPEND_REQUIRED' }, 400)
    return upstream(c, () => ads.call('POST', `/campaigns/${id}/resume`))
  })

  // ── AI recommendations ──────────────────────────────────────────────────────
  app.get('/recommendations', requirePermission('ads:read'), (c) => {
    const status = ['pending', 'executed', 'all'].includes(String(c.req.query('status'))) ? String(c.req.query('status')) : 'pending'
    return upstream(c, () => ads.call('GET', `/dashboard/recommendations?status=${status}`))
  })
  app.post('/recommendations/:id/dismiss', requirePermission('ads:update'), (c) => {
    const id = c.req.param('id'); if (!UUID_RE.test(id)) return badId(c)
    return upstream(c, () => ads.call('POST', `/dashboard/recommendations/${id}/dismiss`))
  })
  app.post('/recommendations/:id/execute', requirePermission('ads:spend'), async (c) => {
    const id = c.req.param('id'); if (!UUID_RE.test(id)) return badId(c)
    const parsed = confirmSchema.safeParse(await body(c))
    if (!parsed.success) return c.json({ error: 'Applying a recommendation changes live campaigns: send confirmSpend: true', code: 'CONFIRM_SPEND_REQUIRED' }, 400)
    return upstream(c, () => ads.call('POST', `/dashboard/recommendations/${id}/execute`))
  })

  // ── A/B landing-page experiments (tenant database) ──────────────────────────
  const E = t.adsExperiment, A = t.adsExperimentAssignment, V = t.adsExperimentConversion
  const hydrate = async (rows: any[]) => {
    if (!rows.length) return []
    const ids = rows.map((r) => r.id)
    const [assign, conv] = await Promise.all([
      db.select({ experimentId: A.experimentId, key: A.variantKey, n: sql<number>`count(*)::int` }).from(A).where(inArray(A.experimentId, ids)).groupBy(A.experimentId, A.variantKey),
      db.select({ experimentId: V.experimentId, key: V.variantKey, n: sql<number>`count(*)::int` }).from(V).where(inArray(V.experimentId, ids)).groupBy(V.experimentId, V.variantKey),
    ])
    const count = (list: any[], id: string, key: string) => Number(list.find((r) => r.experimentId === id && r.key === key)?.n || 0)
    return rows.map((r) => ({ ...r, variants: ((r.variants as any[]) || []).map((v) => ({ ...v, assignments: count(assign, r.id, v.key), conversions: count(conv, r.id, v.key) })) }))
  }
  const own = async (c: any) => {
    const [row] = await db.select().from(E).where(and(eq(E.id, c.req.param('id')), eq(E.companyId, (c.get('user') as any).companyId))).limit(1)
    return row || null
  }
  const runningOnPath = async (companyId: string, path: string, exceptId?: string) => {
    const rows = await db.select({ id: E.id }).from(E).where(and(eq(E.companyId, companyId), eq(E.path, path), eq(E.status, 'running')))
    return rows.some((r: any) => r.id !== exceptId)
  }

  app.get('/experiments', requirePermission('ads:read'), async (c) => {
    const rows = await db.select().from(E).where(eq(E.companyId, (c.get('user') as any).companyId)).orderBy(desc(E.createdAt))
    return c.json({ experiments: await hydrate(rows) })
  })
  app.post('/experiments', requirePermission('ads:update'), async (c) => {
    const parsed = experimentCreateSchema.safeParse(await body(c))
    if (!parsed.success) return c.json({ error: zodError(parsed.error) }, 400)
    const norm = normaliseVariants(parsed.data.variants)
    if ('error' in norm) return c.json({ error: norm.error }, 400)
    const companyId = (c.get('user') as any).companyId
    // The website asks "which experiment runs on this path?" — two running on one path would split nothing cleanly.
    if (await runningOnPath(companyId, parsed.data.path)) return c.json({ error: 'Another test is already running on this page. Complete or archive it first.' }, 409)
    const [created] = await db.insert(E).values({ companyId, name: parsed.data.name, path: parsed.data.path, variants: norm.variants, status: 'running', startedAt: new Date() }).returning()
    return c.json({ experiment: (await hydrate([created]))[0] }, 201)
  })
  app.patch('/experiments/:id', requirePermission('ads:update'), async (c) => {
    const row = await own(c)
    if (!row) return c.json({ error: 'Not found' }, 404)
    const parsed = experimentPatchSchema.safeParse(await body(c))
    if (!parsed.success) return c.json({ error: zodError(parsed.error) }, 400)
    const p = parsed.data
    const patch: Record<string, any> = { updatedAt: new Date() }
    if (p.name !== undefined) patch.name = p.name
    if (p.winnerKey !== undefined) {
      if (p.winnerKey !== null && !((row.variants as any[]) || []).some((v) => v.key === p.winnerKey)) return c.json({ error: 'winnerKey must be one of this test\'s variant keys' }, 400)
      patch.winnerKey = p.winnerKey
    }
    if (p.status !== undefined && p.status !== row.status) {
      if (p.status === 'running') {
        if (await runningOnPath(row.companyId, row.path, row.id)) return c.json({ error: 'Another test is already running on this page.' }, 409)
        patch.startedAt = row.startedAt || new Date(); patch.endedAt = null
      }
      if (p.status === 'completed' || p.status === 'archived') patch.endedAt = row.endedAt || new Date()
      patch.status = p.status
    }
    const [updated] = await db.update(E).set(patch).where(and(eq(E.id, row.id), eq(E.companyId, row.companyId))).returning()
    return c.json({ experiment: (await hydrate([updated]))[0] })
  })
  app.delete('/experiments/:id', requirePermission('ads:update'), async (c) => {
    const row = await own(c)
    if (!row) return c.json({ error: 'Not found' }, 404)
    // Children first, explicitly: the FK cascade exists where drizzle push created the tables, but a table created by the
    // additive boot reconcile may not carry the foreign key.
    await db.delete(V).where(eq(V.experimentId, row.id))
    await db.delete(A).where(eq(A.experimentId, row.id))
    await db.delete(E).where(and(eq(E.id, row.id), eq(E.companyId, row.companyId)))
    return c.json({ success: true })
  })

  return app
}

/** Premium-website A/B endpoints. Mount at /api/public/ads-experiments with an open CORS policy (the site is another origin). */
export function createAdsPublicRoutes(deps: AdsPublicDeps) {
  const { db, tables: t } = deps
  const E = t.adsExperiment, A = t.adsExperimentAssignment, V = t.adsExperimentConversion
  const app = new Hono()
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : '')
  const read = async (c: any) => { try { const j = await c.req.json(); return j && typeof j === 'object' ? j : {} } catch { return {} } }

  // Sticky variant for a visitor on a path.
  app.post('/assign', async (c) => {
    const b = await read(c)
    const path = str(b.path, 300), visitorId = str(b.visitorId, 100)
    if (!path || !visitorId) return c.json({ variant: null })
    const [exp] = await db.select().from(E).where(and(eq(E.path, path), eq(E.status, 'running'))).orderBy(desc(E.startedAt)).limit(1)
    if (!exp) return c.json({ variant: null })
    const [existing] = await db.select({ variantKey: A.variantKey }).from(A).where(and(eq(A.experimentId, exp.id), eq(A.visitorId, visitorId))).limit(1)
    if (existing) return c.json({ experimentId: exp.id, variant: existing.variantKey })
    const variants = ((exp.variants as any[]) || []).filter((v) => v && typeof v.key === 'string')
    if (!variants.length) return c.json({ variant: null })
    const total = variants.reduce((s, v) => s + Math.max(0, Number(v.trafficPercent) || 0), 0)
    let chosen = variants[0]
    if (total > 0) { let pick = Math.random() * total; for (const v of variants) { pick -= Math.max(0, Number(v.trafficPercent) || 0); if (pick < 0) { chosen = v; break } } }
    else chosen = variants[Math.floor(Math.random() * variants.length)]
    await db.insert(A).values({ experimentId: exp.id, variantKey: chosen.key, visitorId })
    return c.json({ experimentId: exp.id, variant: chosen.key })
  })

  // One conversion per visitor + event type while the test runs (a resubmitted form no longer counts twice).
  app.post('/convert', async (c) => {
    const b = await read(c)
    const experimentId = str(b.experimentId, 100), visitorId = str(b.visitorId, 100)
    const eventType = /^[a-z_]{1,30}$/.test(String(b.eventType || '')) ? String(b.eventType) : 'lead'
    if (!experimentId || !visitorId) return c.json({ ok: false })
    const [exp] = await db.select({ id: E.id }).from(E).where(and(eq(E.id, experimentId), eq(E.status, 'running'))).limit(1)
    if (!exp) return c.json({ ok: false })
    const [ass] = await db.select({ variantKey: A.variantKey }).from(A).where(and(eq(A.experimentId, experimentId), eq(A.visitorId, visitorId))).limit(1)
    if (!ass) return c.json({ ok: false })
    const [dup] = await db.select({ id: V.id }).from(V).where(and(eq(V.experimentId, experimentId), eq(V.visitorId, visitorId), eq(V.eventType, eventType))).limit(1)
    if (!dup) await db.insert(V).values({ experimentId, variantKey: ass.variantKey, visitorId, eventType, targetId: str(b.targetId, 100) || null })
    return c.json({ ok: true })
  })

  return app
}
